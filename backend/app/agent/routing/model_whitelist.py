"""模型白名单 - provider 感知版 (v1.2.4)

历史
----
- v0.9.1: 严格白名单, 只有一份, 全是 OpenRouter 风格的 model id
  (minimax/minimax-m3 / z-ai/glm-5 / meta-llama/llama-3.1-8b-instruct ...)
- v1.2.4 修两个真问题:
  1) **白名单与 base_url 脱节** — 把 LLM_BASE_URL 换成任何非 OpenRouter 的
     OpenAI 兼容端点 (MiniMax 直连 / DeepSeek / 智谱 / 硅基流动),
     17 个 model id 全部 400, 整条链死。
     现在按 base_url 识别 provider, 各 provider 用自己的 model id 写法。
  2) **config.py 的 TIER_MODEL_LOW/MEDIUM/HIGH 是死配置** ——
     tier_router 只认本文件的 MODEL_WHITELIST / DEFAULT_TIER_MODELS,
     从不读 settings.TIER_MODEL_*。用户在 .env 里改档位模型**静默无效**。
     现在 TIER_MODEL_* 作为"显式覆盖"生效: 设了就覆盖, 没设走 provider 默认。

兼容性
------
- 默认 provider = openrouter, 白名单内容与 v1.2.3 **逐条相同** ⇒ 现有用户行为不变。
- 认不出的 base_url 一律回落 openrouter 并打 warning (兼容各种 OpenRouter 代理)。
"""
from typing import Dict, List, Optional, Tuple

from app.core.config import settings


# ===== provider 配置 =====

PROVIDER_PROFILES: Dict[str, Dict] = {
    "openrouter": {
        "label": "OpenRouter",
        # base_url 里出现这些片段就判定为该 provider
        "base_url_markers": ["openrouter.ai"],
        "tiers": {
            "low": [
                "minimax/minimax-m2.7",              # minimaxM2.7 (默认 low)
                "qwen/qwen-2.5-7b-instruct",        # 千问 7b
                "deepseek/deepseek-chat-v3.1",       # deepseek V3
                "google/gemini-2.5-flash",           # Gemini 2.5 Flash
                "meta-llama/llama-3.1-8b-instruct",  # Llama 3.1 8B
            ],
            "medium": [
                "minimax/minimax-m3",                # minimaxM3 (默认 medium)
                "z-ai/glm-5",                        # GLM 5
                "deepseek/deepseek-v4-flash",        # deepseek V4-Flash
                "anthropic/claude-haiku-4.5",       # Claude Haiku 4.5
                "openai/gpt-4.1-mini",               # GPT-4.1 mini
            ],
            "high": [
                "minimax/minimax-m3",                # minimaxM3 (默认 high)
                "x-ai/grok-4.20-multi-agent",        # grok 4.20 multi-agent 顶配
                "z-ai/glm-5.2",                      # GLM 5.2 顶配
                "deepseek/deepseek-v4-pro",          # deepseek V4-Pro 顶配
                "anthropic/claude-sonnet-4.5",      # Claude Sonnet 4.5
                "openai/gpt-5",                      # GPT-5
                "google/gemini-2.5-pro",             # Gemini 2.5 Pro
            ],
        },
        "defaults": {
            "low": "minimax/minimax-m2.7",
            "medium": "minimax/minimax-m3",
            "high": "minimax/minimax-m3",
        },
    },
    "minimax": {
        "label": "MiniMax 直连",
        "base_url_markers": ["api.minimaxi.com", "api.minimax.chat"],
        "tiers": {
            "low": ["MiniMax-M2.7", "MiniMax-M3"],
            "medium": ["MiniMax-M3", "MiniMax-M2.7"],
            "high": ["MiniMax-M3"],
        },
        "defaults": {"low": "MiniMax-M2.7", "medium": "MiniMax-M3", "high": "MiniMax-M3"},
    },
    "deepseek": {
        "label": "DeepSeek 直连",
        "base_url_markers": ["api.deepseek.com"],
        "tiers": {
            "low": ["deepseek-chat"],
            "medium": ["deepseek-chat", "deepseek-reasoner"],
            "high": ["deepseek-reasoner", "deepseek-chat"],
        },
        "defaults": {"low": "deepseek-chat", "medium": "deepseek-chat", "high": "deepseek-reasoner"},
    },
    "zhipu": {
        "label": "智谱 GLM 直连",
        "base_url_markers": ["open.bigmodel.cn"],
        "tiers": {
            "low": ["glm-4-flash"],
            "medium": ["glm-4-flash", "glm-4-plus"],
            "high": ["glm-4-plus", "glm-4-air"],
        },
        "defaults": {"low": "glm-4-flash", "medium": "glm-4-plus", "high": "glm-4-plus"},
    },
    "siliconflow": {
        "label": "硅基流动",
        "base_url_markers": ["siliconflow.cn", "siliconflow.com"],
        "tiers": {
            "low": ["Qwen/Qwen2.5-7B-Instruct"],
            "medium": ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
            "high": ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
        },
        "defaults": {
            "low": "Qwen/Qwen2.5-7B-Instruct",
            "medium": "Qwen/Qwen2.5-72B-Instruct",
            "high": "deepseek-ai/DeepSeek-V3",
        },
    },
    "openai": {
        "label": "OpenAI 直连",
        "base_url_markers": ["api.openai.com"],
        "tiers": {
            "low": ["gpt-4o-mini"],
            "medium": ["gpt-4.1-mini", "gpt-4o-mini"],
            "high": ["gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
        },
        "defaults": {"low": "gpt-4o-mini", "medium": "gpt-4.1-mini", "high": "gpt-4o"},
    },
}

DEFAULT_PROVIDER = "openrouter"

# 档位展示信息 (前端用)
TIER_LABELS: Dict[str, str] = {
    "low": "low (闲聊 / 简单查询)",
    "medium": "medium (标准问答)",
    "high": "high (复杂规划 / 深度推理)",
}


# ===== provider 识别 =====

def detect_provider(base_url: Optional[str] = None) -> str:
    """按 base_url 识别 provider, 认不出就回落 openrouter (向后兼容)"""
    b = (base_url if base_url is not None else settings.LLM_BASE_URL or "").lower()
    for name, prof in PROVIDER_PROFILES.items():
        for marker in prof["base_url_markers"]:
            if marker in b:
                return name
    return DEFAULT_PROVIDER


def active_profile(base_url: Optional[str] = None) -> Dict:
    """当前生效的 provider 配置"""
    return PROVIDER_PROFILES[detect_provider(base_url)]


# ===== 解析 (向后兼容的旧 API) =====

def get_whitelist(tier: str, base_url: Optional[str] = None) -> List[str]:
    """某档位在当前 provider 下的可用模型列表"""
    prof = active_profile(base_url)
    tiers = prof["tiers"]
    if tier not in tiers:
        tier = "medium"
    return list(tiers[tier])


def get_default_tier_models(base_url: Optional[str] = None) -> Dict[str, str]:
    """各档位默认主模型"""
    prof = active_profile(base_url)
    defaults = prof["defaults"]
    return {t: defaults.get(t, get_whitelist(t, base_url)[0]) for t in ("low", "medium", "high")}


def _override_for(tier: str) -> Optional[str]:
    """读 config 的 TIER_MODEL_{TIER} 显式覆盖 (没设 = None)"""
    raw = {
        "low": settings.TIER_MODEL_LOW,
        "medium": settings.TIER_MODEL_MEDIUM,
        "high": settings.TIER_MODEL_HIGH,
    }.get(tier, "")
    raw = (raw or "").strip()
    return raw or None


def resolve_tier_models(tier: str, base_url: Optional[str] = None) -> Tuple[str, List[str]]:
    """解析某档位 → (primary, fallback 链)

    优先级:
    1. config.TIER_MODEL_{TIER} 显式设置 → 直接当 primary
    2. provider 默认值
    fallback 链 = 当前 provider 该档位白名单里除 primary 外的全部
    """
    base = base_url if base_url is not None else settings.LLM_BASE_URL
    prof = active_profile(base)
    tiers = prof["tiers"]
    tier_list = list(tiers.get(tier) or tiers["medium"])
    primary = _override_for(tier) or prof["defaults"].get(tier) or tier_list[0]
    fallback = [m for m in tier_list if m != primary]
    return primary, fallback


def is_model_allowed(tier: str, model: str, base_url: Optional[str] = None) -> bool:
    """校验模型是否在该档白名单内 (当前 provider)"""
    return model in get_whitelist(tier, base_url)


def describe_active(base_url: Optional[str] = None) -> Dict:
    """给 /api/diagnose 用 — 描述当前 provider / 档位 / 白名单"""
    base = base_url if base_url is not None else settings.LLM_BASE_URL
    provider = detect_provider(base)
    prof = PROVIDER_PROFILES[provider]
    defaults = get_default_tier_models(base)
    resolved = {t: resolve_tier_models(t, base) for t in ("low", "medium", "high")}
    return {
        "provider": provider,
        "provider_label": prof["label"],
        "base_url": base,
        "whitelist": {t: get_whitelist(t, base) for t in ("low", "medium", "high")},
        "defaults": defaults,
        "resolved": {t: {"primary": resolved[t][0], "fallback": resolved[t][1]} for t in resolved},
        "overrides": {
            t: (_override_for(t) or "")
            for t in ("low", "medium", "high")
        },
    }
