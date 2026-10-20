"""工程稳定性回归测试 (v1.2.4)

覆盖这一轮修的 6 类问题, 每一条都是"看起来在正常工作、实际没通"的类型:

1. TOOLS schema 与 TOOL_REGISTRY 漂移  → AI 调不到某个工具 (日程 5 个就这么丢的)
2. key 校验硬编码 OpenRouter            → 换服务商被误判成 key 无效
3. 白名单与 base_url 脱节               → 换 provider 全部 400
4. config.TIER_MODEL_* 是死配置         → 用户改 .env 静默无效
5. provider 识别错误                    → 用了别家模型名
6. think 块泄漏 / 失败谎报成功          → (v1.2.3 已在 test_v123_regression.py 覆盖)

跑法: cd backend && ../.venv/bin/python -m pytest tests -v
"""
import asyncio
import inspect
import re
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.agent.prompts.tools import TOOLS  # noqa: E402
from app.agent.routing.model_whitelist import (  # noqa: E402
    PROVIDER_PROFILES,
    detect_provider,
    get_default_tier_models,
    get_whitelist,
    is_model_allowed,
    resolve_tier_models,
)


# ===== 1. TOOLS ↔ TOOL_REGISTRY 一致性 =====

def test_registry_and_schema_agree():
    """注册的每个工具都必须在 LLM 看得见的 schema 里, 且一一对应

    v1.2.3 的 bug: 5 个日程工具注册了但没进 schema ⇒ AI 永远调不到日程。
    """
    from app.agent.tools.registry import TOOL_REGISTRY

    declared = {t["function"]["name"] for t in TOOLS}
    registered = set(TOOL_REGISTRY)

    missing = registered - declared
    extra = declared - registered

    assert not missing, f"注册了但 LLM 调不到: {sorted(missing)}"
    assert not extra, f"schema 有但没注册 (LLM 调了必炸): {sorted(extra)}"
    assert len(declared) == len(TOOLS), "TOOLS 里有重名工具"


def test_schedule_tools_are_visible_to_llm():
    """5 个日程工具必须在 schema 里 —— 这是 v1.2.3 丢的那批"""
    declared = {t["function"]["name"] for t in TOOLS}
    for name in (
        "create_schedule",
        "list_schedule",
        "update_schedule",
        "delete_schedule",
        "suggest_schedule",
    ):
        assert name in declared, f"{name} 没进 LLM schema — AI 调不到"


def test_tool_schemas_are_wellformed():
    """每个 schema 都要有 type/function/name/parameters, 且 parameters 是 object"""
    for t in TOOLS:
        assert t.get("type") == "function", f"{t} 的 type 不对"
        fn = t.get("function", {})
        assert fn.get("name"), f"schema 缺 name: {t}"
        params = fn.get("parameters")
        assert isinstance(params, dict), f"{fn['name']} 缺 parameters"
        assert params.get("type") == "object", f"{fn['name']} parameters.type 必须是 object"
        for pname, pdef in (params.get("properties") or {}).items():
            assert "type" in pdef, f"{fn['name']}.{pname} 缺 type"
        for req in params.get("required", []):
            assert req in (params.get("properties") or {}), (
                f"{fn['name']} required 里的 {req} 不在 properties 中"
            )


def test_tools_selfcheck_helper_runs():
    """自检函数本身能跑通 (不是摆设)"""
    from app.agent.prompts.tools import _assert_tools_match_registry

    _assert_tools_match_registry()  # 不抛异常 = 通过


# ===== 2. provider 识别 =====

@pytest.mark.parametrize(
    "base_url,expect",
    [
        ("https://openrouter.ai/api/v1", "openrouter"),
        ("https://api.minimaxi.com/v1", "minimax"),
        ("https://api.minimax.chat/v1", "minimax"),
        ("https://api.deepseek.com/v1", "deepseek"),
        ("https://open.bigmodel.cn/api/paas/v4", "zhipu"),
        ("https://api.siliconflow.cn/v1", "siliconflow"),
        ("https://api.openai.com/v1", "openai"),
    ],
)
def test_detect_provider(base_url, expect):
    assert detect_provider(base_url) == expect


def test_detect_provider_unknown_falls_back_to_openrouter():
    """认不出的 base_url 回落 openrouter (向后兼容, 不炸)

    注意: detect_provider(None) 的语义是"用 settings.LLM_BASE_URL",
    不是"未知" —— 所以这里不拿 None 当未知用例。
    """
    from app.core.config import settings

    assert detect_provider("https://my-proxy.internal/v1") == "openrouter"
    assert detect_provider("") == "openrouter"
    assert detect_provider("not-a-url") == "openrouter"
    # None = 跟随 settings, 不是"未知"
    assert detect_provider(None) == detect_provider(settings.LLM_BASE_URL)


def test_every_profile_has_complete_shape():
    """每个 provider 配置结构完整, 不然换 provider 会 KeyError"""
    for name, prof in PROVIDER_PROFILES.items():
        assert prof.get("label"), f"{name} 缺 label"
        assert prof.get("base_url_markers"), f"{name} 缺 base_url_markers"
        for tier in ("low", "medium", "high"):
            models = prof["tiers"].get(tier)
            assert models, f"{name}.{tier} 白名单为空"
            assert all(isinstance(m, str) and m for m in models), f"{name}.{tier} 有空模型名"
            assert prof["defaults"].get(tier) in models, (
                f"{name}.{tier} 默认模型 {prof['defaults'].get(tier)} 不在自己的白名单里"
            )


def test_openrouter_profile_unchanged():
    """OpenRouter 的白名单必须与 v1.2.3 逐条一致 (老用户行为不能变)"""
    prof = PROVIDER_PROFILES["openrouter"]
    assert prof["defaults"]["low"] == "minimax/minimax-m2.7"
    assert prof["defaults"]["medium"] == "minimax/minimax-m3"
    assert prof["defaults"]["high"] == "minimax/minimax-m3"
    assert "minimax/minimax-m2.7" in prof["tiers"]["low"]
    assert "x-ai/grok-4.20-multi-agent" in prof["tiers"]["high"]
    assert len(prof["tiers"]["low"]) == 5
    assert len(prof["tiers"]["medium"]) == 5
    assert len(prof["tiers"]["high"]) == 7


# ===== 3. 白名单跟随 base_url (换 provider 不再全 400) =====

def test_whitelist_follows_base_url():
    """同一档位, 不同 provider 给不同的模型 id —— 这正是原来会全 400 的点"""
    or_wl = get_whitelist("low", "https://openrouter.ai/api/v1")
    mm_wl = get_whitelist("low", "https://api.minimaxi.com/v1")
    assert "minimax/minimax-m2.7" in or_wl
    assert "MiniMax-M2.7" in mm_wl
    # OpenRouter 的写法不能出现在 MiniMax 白名单里
    assert not any(m.startswith("minimax/") for m in mm_wl), (
        f"MiniMax 白名单里混进了 OpenRouter 风格 id: {mm_wl}"
    )


def test_resolved_models_belong_to_whitelist():
    """resolve 出来的 primary 必须在自己的白名单里, 否则第一枪就 400"""
    for base in [
        "https://openrouter.ai/api/v1",
        "https://api.minimaxi.com/v1",
        "https://api.deepseek.com/v1",
        "https://open.bigmodel.cn/api/paas/v4",
        "https://api.siliconflow.cn/v1",
        "https://api.openai.com/v1",
    ]:
        for tier in ("low", "medium", "high"):
            primary, fallback = resolve_tier_models(tier, base)
            wl = get_whitelist(tier, base)
            assert primary in wl, f"{base} {tier}: primary {primary} 不在白名单"
            assert all(m in wl for m in fallback), f"{base} {tier}: fallback 有不在白名单的"
            assert primary not in fallback, f"{base} {tier}: primary 混进了 fallback"


def test_is_model_allowed_is_provider_aware():
    assert is_model_allowed("low", "minimax/minimax-m2.7", "https://openrouter.ai/api/v1")
    assert not is_model_allowed("low", "minimax/minimax-m2.7", "https://api.minimaxi.com/v1")
    assert is_model_allowed("low", "MiniMax-M2.7", "https://api.minimaxi.com/v1")


# ===== 4. TIER_MODEL_* 不再是死配置 =====

def test_tier_model_override_is_honored(monkeypatch):
    """settings.TIER_MODEL_* 设了就要生效 —— 之前改了 .env 静默无效"""
    from app.core import config as config_mod

    monkeypatch.setattr(config_mod.settings, "TIER_MODEL_LOW", "my-custom-model", raising=False)
    primary, fallback = resolve_tier_models("low", "https://openrouter.ai/api/v1")
    assert primary == "my-custom-model", (
        f"TIER_MODEL_LOW 没生效 (拿到 {primary}) —— 这就是之前的死配置 bug"
    )
    assert "my-custom-model" not in fallback


def test_tier_model_empty_uses_provider_default(monkeypatch):
    """没设就走 provider 默认"""
    from app.core import config as config_mod

    for attr in ("TIER_MODEL_LOW", "TIER_MODEL_MEDIUM", "TIER_MODEL_HIGH"):
        monkeypatch.setattr(config_mod.settings, attr, "", raising=False)
    defaults = get_default_tier_models("https://api.minimaxi.com/v1")
    assert defaults["low"] == "MiniMax-M2.7"
    assert defaults["medium"] == "MiniMax-M3"


def test_config_defaults_are_empty():
    """config.py 里 TIER_MODEL_* 默认必须是空串, 否则没法区分"没设"和"设了" """
    from app.core.config import Settings

    s = Settings()
    assert s.TIER_MODEL_LOW == ""
    assert s.TIER_MODEL_MEDIUM == ""
    assert s.TIER_MODEL_HIGH == ""


# ===== 5. key 校验跟随 base_url =====

def test_provider_check_uses_base_url_not_hardcoded():
    """源码里不能再有写死的 openrouter 校验端点 (除 provider_check 自己的实现)"""
    offenders = []
    for py in (BACKEND_DIR / "app").rglob("*.py"):
        if py.name == "provider_check.py":
            continue
        text = py.read_text(encoding="utf-8")
        # 只看真正的请求目标, 不看注释/文档字符串
        for m in re.finditer(r'"(https://openrouter\.ai/api/v1/auth/key)"', text):
            line_no = text[: m.start()].count("\n") + 1
            ctx = text.splitlines()[line_no - 1]
            if ctx.strip().startswith("#") or ctx.strip().startswith('"') or ctx.strip().startswith("'"):
                continue
            offenders.append(f"{py.relative_to(BACKEND_DIR)}:{line_no}")
    assert not offenders, f"还有硬编码的 OpenRouter 校验端点: {offenders}"


def test_provider_check_detects_openrouter():
    """OpenRouter 系走 /auth/key, 拿到账号信息"""
    from app.agent.llm.provider_check import check_llm_credentials

    class _Resp:
        status_code = 200

        def json(self):
            return {"data": {"email": "a@b.c", "limit": 10, "limit_remaining": 5}}

    class _Client:
        def __init__(self):
            self.gets = []

        async def get(self, url, headers=None, **kw):
            self.gets.append(url)
            return _Resp()

        async def aclose(self):
            pass

    c = _Client()
    res = asyncio.run(check_llm_credentials("sk-test", "https://openrouter.ai/api/v1", client=c))
    assert res["ok"] is True
    assert res["method"] == "auth_key"
    assert res["account"]["email"] == "a@b.c"
    assert c.gets and c.gets[0].endswith("/auth/key")


def test_provider_check_uses_chat_probe_for_other_providers():
    """非 OpenRouter → 用极小 chat 请求探测, 不再误报 key 无效"""
    from app.agent.llm.provider_check import check_llm_credentials

    class _Resp:
        status_code = 200
        text = "{}"

        def json(self):
            return {}

    class _Client:
        def __init__(self):
            self.posts = []

        async def post(self, url, headers=None, json=None, **kw):
            self.posts.append((url, json))
            return _Resp()

        async def get(self, *a, **kw):
            raise AssertionError("非 OpenRouter 不该调 /auth/key")

        async def aclose(self):
            pass

    c = _Client()
    res = asyncio.run(check_llm_credentials("sk-test", "https://api.minimaxi.com/v1", client=c))
    assert res["ok"] is True
    assert res["method"] == "chat_probe"
    assert c.posts, "应该发了 chat 探测请求"
    url, body = c.posts[0]
    assert url.endswith("/chat/completions")
    assert body["model"] == "MiniMax-M3", "探测模型名该跟 provider 对得上"
    assert body["max_tokens"] == 1, "探测请求不该烧 token"


def test_provider_check_reports_401_as_invalid():
    """401 必须报"key 无效", 不能报"端点不支持查账号" """
    from app.agent.llm.provider_check import check_llm_credentials

    class _Resp:
        status_code = 401
        text = '{"error":{"message":"bad key"}}'

        def json(self):
            return {"error": {"message": "bad key"}}

    class _Client:
        async def post(self, url, headers=None, json=None, **kw):
            return _Resp()

        async def get(self, *a, **kw):
            return _Resp()

        async def aclose(self):
            pass

    res = asyncio.run(check_llm_credentials("sk-bad", "https://api.minimaxi.com/v1", client=_Client()))
    assert res["ok"] is False
    assert res["error_code"] == 401
    assert res["hint"], "失败时必须给下一步提示"


def test_provider_check_treats_model_error_as_key_ok():
    """400 + 提到 model ⇒ 鉴权已通过, 只是探测模型名这个 provider 不认"""
    from app.agent.llm.provider_check import check_llm_credentials

    class _Resp:
        status_code = 400
        text = '{"error":{"message":"unknown model gpt-4o-mini"}}'

        def json(self):
            return {"error": {"message": "unknown model"}}

    class _Client:
        async def post(self, url, headers=None, json=None, **kw):
            return _Resp()

        async def get(self, *a, **kw):
            return _Resp()

        async def aclose(self):
            pass

    res = asyncio.run(check_llm_credentials("sk-ok", "https://api.minimaxi.com/v1", client=_Client()))
    assert res["ok"] is True, "鉴权通过了就不该报 key 无效"


def test_provider_check_empty_key():
    from app.agent.llm.provider_check import check_llm_credentials

    res = asyncio.run(check_llm_credentials("", "https://openrouter.ai/api/v1"))
    assert res["ok"] is False
    assert "LLM_API_KEY" in (res["error"] or "")


# ===== 6. 日程工具签名与 schema 对齐 =====

def test_schedule_tool_schemas_match_implementations():
    """schema 里的参数必须是实现里真有的参数

    少一个 → LLM 传了实现接不住 (TypeError); 多一个 → LLM 永远调不到那个功能。
    """
    from app.agent.tools import schedule as sched_mod
    from app.agent.tools.registry import TOOL_REGISTRY

    schema_by_name = {t["function"]["name"]: t for t in TOOLS}

    for name in (
        "create_schedule",
        "list_schedule",
        "update_schedule",
        "delete_schedule",
        "suggest_schedule",
    ):
        fn = TOOL_REGISTRY[name]
        sig = inspect.signature(fn)
        params = sig.parameters
        # 实现接不住的参数 (除了框架注入的 user_id)
        accepted = {k for k in params if k != "user_id"}
        props = set(schema_by_name[name]["function"]["parameters"].get("properties") or {})

        missing = props - accepted
        assert not missing, f"{name}: schema 里的 {sorted(missing)} 实现接不住 (LLM 一调就 TypeError)"

        for req in schema_by_name[name]["function"]["parameters"].get("required", []):
            assert req in accepted, f"{name}: required 参数 {req} 实现里没有"


def test_style_prompt_mentions_schedule_tools():
    """prompt 里要教 AI 什么时候用日程 —— 只给 schema 不给指引, AI 照样不会用"""
    style = (BACKEND_DIR / "app" / "agent" / "prompts" / "style.py").read_text(encoding="utf-8")
    assert "suggest_schedule" in style, "style.py 没提 suggest_schedule, AI 不知道要用"
    assert "list_schedule" in style, "style.py 没提 list_schedule"
    assert "create_schedule" in style, "style.py 没提 create_schedule"


def test_no_dead_tool_reference_in_comments():
    """注释里提到的工具必须真的存在 (add_mistake 在 v1.2.2 就被删了, 但注释还在)"""
    from app.agent.tools.registry import TOOL_REGISTRY

    llm_runner = (BACKEND_DIR / "app" / "agent" / "pipeline" / "llm_runner.py").read_text(encoding="utf-8")
    for tool_name in re.findall(r"\b([a-z_]+)\b(?=[^\n]*工作流|add_)", llm_runner):
        pass
    # 明确点名检查历史上踩过的坑
    if "add_mistake" in llm_runner:
        assert "add_mistake" in TOOL_REGISTRY, (
            "llm_runner 注释提到 add_mistake, 但该工具在 v1.2.2 已删除 — "
            "注释会误导后来的人以为错题自动入库还活着"
        )
