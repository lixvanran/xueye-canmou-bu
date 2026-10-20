"""LLM 服务商适配 — key 校验 / 账号信息 (v1.2.4)

背景
----
v1.2.3 之前, 三处 key 校验都写死 `https://openrouter.ai/api/v1/auth/key`:
- `main.py:self_check_openrouter()`  (启动自检)
- `main.py:/api/diagnose`             (系统诊断)
- `api_key.py:POST /api/settings/api-key/test`  (设置页"测当前 key")

结果: 只要把 `LLM_BASE_URL` 指向别的 OpenAI 兼容端点 (MiniMax 直连 / DeepSeek /
智谱 / 硅基流动), **key 明明是好的, 启动却报 "401 User not found"** ——
用户会去白折腾自己的 key。

v1.2.4: 校验端点跟着 `LLM_BASE_URL` 走。
- OpenRouter 系 → 继续用 `/auth/key` (能拿到余额/账号, 信息最全)
- 其他 provider → 退化成"发一个极小的 chat 请求"来验 (不烧钱, 不看账号信息)
- 认不出的 base_url → 走 chat 探测 (通用)

设计原则: **拿不到账号信息 ≠ key 无效**。任何 provider 下, key 不可用都必须
报"key 无效", 而不是"这个端点不支持查账号"。
"""
from typing import Dict, Optional

import httpx

# 极小的探测请求 —— 确认 key 能不能调通, 1 个 token 就够
_PROBE_MODEL = "gpt-4o-mini"
_PROBE_BODY = {
    "model": None,  # 由调用方填
    "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 1,
}


def _is_openrouter(base_url: str) -> bool:
    return "openrouter.ai" in (base_url or "").lower()


def _probe_model_for(base_url: str) -> str:
    """探测请求用哪个模型名 —— 尽量用便宜的小模型, 认不出就用 gpt-4o-mini"""
    b = (base_url or "").lower()
    if "minimaxi.com" in b or "minimax.chat" in b:
        return "MiniMax-M3"
    if "deepseek.com" in b:
        return "deepseek-chat"
    if "bigmodel.cn" in b:
        return "glm-4-flash"
    if "siliconflow" in b:
        return "Qwen/Qwen2.5-7B-Instruct"
    return _PROBE_MODEL


async def check_llm_credentials(
    api_key: str,
    base_url: str,
    timeout: float = 15.0,
    client: Optional[httpx.AsyncClient] = None,
) -> Dict:
    """校验 LLM key / base_url 组合是否可用

    Returns:
        {
          "ok": bool,
          "provider": "openrouter" | "generic",
          "method": "auth_key" | "chat_probe",
          "error": str | None,
          "error_code": int | None,
          "account": {...} | None,   # 仅 OpenRouter 有
          "hint": str,               # 给用户看的下一步
        }
    """
    if not api_key:
        return {
            "ok": False,
            "provider": "unknown",
            "method": "none",
            "error": "LLM_API_KEY 未设置",
            "error_code": None,
            "account": None,
            "hint": "编辑 backend/.env, 在 LLM_API_KEY= 后面填上 key, 保存后重启 启动.bat",
        }

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout)
    try:
        if _is_openrouter(base_url):
            r = await http.get(
                f"{(base_url or 'https://openrouter.ai/api/v1').rstrip('/')}/auth/key",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if r.status_code == 200:
                data = r.json().get("data", {})
                return {
                    "ok": True,
                    "provider": "openrouter",
                    "method": "auth_key",
                    "error": None,
                    "error_code": None,
                    "account": {
                        "email": data.get("email"),
                        "is_free_tier": data.get("is_free_tier"),
                        "limit": data.get("limit"),
                        "limit_remaining": data.get("limit_remaining"),
                        "usage": data.get("usage"),
                        "rate_limit": data.get("rate_limit"),
                    },
                    "hint": "✓ OpenRouter key 有效",
                }
            if r.status_code == 401:
                return {
                    "ok": False,
                    "provider": "openrouter",
                    "method": "auth_key",
                    "error": r.json().get("error", {}).get("message", "401 Unauthorized"),
                    "error_code": 401,
                    "account": None,
                    "hint": (
                        "OpenRouter 不认这个 key。\n"
                        "1) 去 https://openrouter.ai/keys 看列表里有没有它\n"
                        "2) 没有 → Create 一个新的, 复制完整 key 贴到 .env\n"
                        "3) 有但失败 → 它已被 disable, 重新 Create"
                    ),
                }
            return {
                "ok": False,
                "provider": "openrouter",
                "method": "auth_key",
                "error": f"HTTP {r.status_code}: {r.text[:200]}",
                "error_code": r.status_code,
                "account": None,
                "hint": "OpenRouter 校验端点返回异常, 检查网络/代理",
            }

        # 其他 provider: 用最小 chat 请求探测 (只花 1 个 token)
        body = dict(_PROBE_BODY)
        body["model"] = _probe_model_for(base_url)
        url = f"{(base_url or '').rstrip('/')}/chat/completions"
        r = await http.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
        if r.status_code == 200:
            return {
                "ok": True,
                "provider": "generic",
                "method": "chat_probe",
                "error": None,
                "error_code": None,
                "account": None,
                "hint": f"✓ key 可用 (已用 {body['model']} 探测)",
            }
        if r.status_code in (401, 403):
            return {
                "ok": False,
                "provider": "generic",
                "method": "chat_probe",
                "error": f"HTTP {r.status_code}: {r.text[:200]}",
                "error_code": r.status_code,
                "account": None,
                "hint": (
                    "这个服务商不认这个 key。\n"
                    f"1) 确认 LLM_BASE_URL={base_url} 是对的\n"
                    "2) 去对应服务商后台确认 key 有效 / 有余额\n"
                    "3) 改完保存, 重启 启动.bat"
                ),
            }
        if r.status_code == 400 and "model" in r.text.lower():
            # key 是好的, 只是探测用的模型名这个 provider 不认
            return {
                "ok": True,
                "provider": "generic",
                "method": "chat_probe",
                "error": None,
                "error_code": 400,
                "account": None,
                "hint": (
                    "✓ key 有效 (探测模型名该服务商不认, 但鉴权已通过)\n"
                    f"请把档位模型改成该服务商的写法 — 见 backend/app/agent/routing/model_whitelist.py"
                ),
            }
        return {
            "ok": False,
            "provider": "generic",
            "method": "chat_probe",
            "error": f"HTTP {r.status_code}: {r.text[:200]}",
            "error_code": r.status_code,
            "account": None,
            "hint": "校验请求异常, 检查 base_url 是否完整 (要带 /v1) 以及网络连通性",
        }
    except Exception as e:
        return {
            "ok": False,
            "provider": "generic",
            "method": "chat_probe",
            "error": f"{type(e).__name__}: {e}",
            "error_code": None,
            "account": None,
            "hint": "连不上 LLM 服务商, 检查网络/代理/防火墙",
        }
    finally:
        if owns_client:
            await http.aclose()
