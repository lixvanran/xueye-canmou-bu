"""Tier Router - 根据复杂度选 LLM 档位
v0.9.5: 重写 — 之前缩进错导致 classify_and_route 不在 class 内
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from app.core.config import settings
from app.agent.routing.classifier import (
    ComplexityClassifier,
    ClassificationResult,
    get_classifier,
)
from app.agent.routing.model_whitelist import (
    MODEL_WHITELIST,
    DEFAULT_TIER_MODELS,
    is_model_allowed,
)

logger = logging.getLogger(__name__)


@dataclass
class TierInfo:
    """一档模型的完整信息"""
    primary: str
    fallback: list[str]
    description: str
    tier_label: str  # "low" | "medium" | "high"


# 默认档位定义 (用户 2026-08-11 拍板)
DEFAULT_TIERS = {
    "low": TierInfo(
        primary=DEFAULT_TIER_MODELS["low"],
        fallback=[m for m in MODEL_WHITELIST["low"] if m != DEFAULT_TIER_MODELS["low"]],
        description="闲聊 / 简单查询 / 1-2 步任务",
        tier_label="low",
    ),
    "medium": TierInfo(
        primary=DEFAULT_TIER_MODELS["medium"],
        fallback=[m for m in MODEL_WHITELIST["medium"] if m != DEFAULT_TIER_MODELS["medium"]],
        description="标准问答 / 多步推理",
        tier_label="medium",
    ),
    "high": TierInfo(
        primary=DEFAULT_TIER_MODELS["high"],
        fallback=[m for m in MODEL_WHITELIST["high"] if m != DEFAULT_TIER_MODELS["high"]],
        description="复杂规划 / 深度推理 (需开启 high 模式)",
        tier_label="high",
    ),
}


def _read_user_pref(key: str, default: str) -> str:
    """从 DB 读用户偏好, 找不到或不在白名单就 return default

    v0.9.5: 单例延迟读 — 失败只 return default, 不抛错
    """
    try:
        from app.db.database import SessionLocal, UserPreferenceORM
        db = SessionLocal()
        try:
            row = db.query(UserPreferenceORM).filter_by(
                user_id=1, key=key
            ).first()
            if row and row.value:
                model = row.value if isinstance(row.value, str) else str(row.value)
                tier = key.replace("model_", "")
                if is_model_allowed(tier, model):
                    return model
                else:
                    logger.warning(
                        f"User pref {key}={model} not in whitelist, fallback to default"
                    )
        finally:
            db.close()
    except Exception as e:
        logger.debug(f"Read user pref {key} failed (table not ready?): {e}")
    return default


def _build_fallback(tier: str, primary: str) -> list[str]:
    """从白名单构建 fallback 链 (排除 primary)"""
    return [m for m in MODEL_WHITELIST[tier] if m != primary]


def _load_tiers_from_db() -> dict[str, TierInfo]:
    """从 DB 读档位配置 — 模块级函数, 供 TierRouter 和 /api/diagnose 共用"""
    return {
        "low": TierInfo(
            primary=_read_user_pref("model_low", DEFAULT_TIER_MODELS["low"]),
            fallback=_build_fallback("low", _read_user_pref("model_low", DEFAULT_TIER_MODELS["low"])),
            description=DEFAULT_TIERS["low"].description,
            tier_label="low",
        ),
        "medium": TierInfo(
            primary=_read_user_pref("model_medium", DEFAULT_TIER_MODELS["medium"]),
            fallback=_build_fallback("medium", _read_user_pref("model_medium", DEFAULT_TIER_MODELS["medium"])),
            description=DEFAULT_TIERS["medium"].description,
            tier_label="medium",
        ),
        "high": TierInfo(
            primary=_read_user_pref("model_high", DEFAULT_TIER_MODELS["high"]),
            fallback=_build_fallback("high", _read_user_pref("model_high", DEFAULT_TIER_MODELS["high"])),
            description=DEFAULT_TIERS["high"].description,
            tier_label="high",
        ),
    }


class TierRouter:
    """档位路由器
    - 内部维护 3 档配置
    - 提供 classify_and_route() 一步到位: 分类 + 选模型
    - 支持 force_tier 调试覆盖 (需要环境变量开关)
    """

    def __init__(self, classifier: Optional[ComplexityClassifier] = None):
        self.classifier = classifier
        # v0.9.5: 改 — __init__ 时不读 DB (避免 import 时序问题)
        # 延迟到 classify_and_route 第一次调用时读
        self.tiers = self._load_default_tiers()
        # 是否允许客户端强制档位 (默认禁用, 防止成本攻击)
        self.allow_force_tier = os.environ.get("ZHAANG_DEBUG_FORCE_TIER") == "1"
        logger.info(
            f"TierRouter ready: low={self.tiers['low'].primary}, "
            f"medium={self.tiers['medium'].primary}, "
            f"high={self.tiers['high'].primary} "
            f"(force_tier={'enabled' if self.allow_force_tier else 'disabled'})"
        )

    def _load_default_tiers(self) -> dict[str, TierInfo]:
        """加载白名单默认值 (不读 DB)"""
        return {
            "low": TierInfo(
                primary=DEFAULT_TIER_MODELS["low"],
                fallback=_build_fallback("low", DEFAULT_TIER_MODELS["low"]),
                description=DEFAULT_TIERS["low"].description,
                tier_label="low",
            ),
            "medium": TierInfo(
                primary=DEFAULT_TIER_MODELS["medium"],
                fallback=_build_fallback("medium", DEFAULT_TIER_MODELS["medium"]),
                description=DEFAULT_TIERS["medium"].description,
                tier_label="medium",
            ),
            "high": TierInfo(
                primary=DEFAULT_TIER_MODELS["high"],
                fallback=_build_fallback("high", DEFAULT_TIER_MODELS["high"]),
                description=DEFAULT_TIERS["high"].description,
                tier_label="high",
            ),
        }

    def get_tier(self, complexity: str) -> TierInfo:
        """获取某档配置 (兼容大小写 / 拼写错误)"""
        c = (complexity or "medium").strip().lower()
        if c in ("low", "easy", "simple", "l"):
            return self.tiers["low"]
        if c in ("high", "hard", "complex", "h"):
            return self.tiers["high"]
        return self.tiers["medium"]

    def get_model_for_complexity(self, complexity: str) -> tuple[str, list[str], TierInfo]:
        """返回 (primary_model, fallback_chain, tier_info)"""
        tier = self.get_tier(complexity)
        return tier.primary, tier.fallback, tier

    def all_models(self) -> list[str]:
        """所有档位用到的模型 (去重) — 给前端调试用"""
        seen = set()
        out = []
        for t in self.tiers.values():
            for m in [t.primary] + t.fallback:
                if m not in seen:
                    seen.add(m)
                    out.append(m)
        return out

    async def classify_and_route(
        self,
        user_message: str,
        history: Optional[list] = None,
        deep_thinking: bool = False,
        force_tier: Optional[str] = None,
        tier_mode: str = "normal",  # v0.1.7+: 快速 / 常规 / 高级 三档
    ) -> dict:
        """一步到位: 分类 + 选模型

        v0.9.5: 第一次调用时从 DB 读用户偏好 (避免 __init__ 时 DB 还没建好的时序问题)
        v0.9.3: 每次重新读 DB (用户改设置立刻生效)

        v0.1.7+: tier_mode 模式
        - speed: 跳过 classifier, 强制 low tier (但 Agent 仍可调工具)
        - normal: 正常 classifier + 不允许 high tier (cap to medium)
        - advanced: 正常 classifier + 允许 high tier
        """
        # 第一次调用时尝试从 DB 加载
        if self.tiers["low"].primary == DEFAULT_TIER_MODELS["low"]:
            # 还在用默认值, 尝试从 DB 读
            try:
                self.tiers = _load_tiers_from_db()
            except Exception as e:
                logger.debug(f"DB load skipped: {e}")

        # v0.1.7+: speed 模式 — 跳过 classifier, 直接 low tier
        if tier_mode == "speed":
            tier = self.get_tier("low")
            return {
                "complexity": "low",
                "primary_model": tier.primary,
                "fallback_models": tier.fallback,
                "tier_info": tier,
                "classification": ClassificationResult(
                    complexity="low", category="speed_mode", confidence=1.0,
                    reason="快速模式: 跳过分级路由, 直接用 low 模型 (但 Agent 仍可调工具)",
                    model_used="forced_speed", fallback=False,
                ),
            }

        # 强制档位 (调试用)
        if force_tier and self.allow_force_tier:
            tier = self.get_tier(force_tier)
            return {
                "complexity": force_tier,
                "primary_model": tier.primary,
                "fallback_models": tier.fallback,
                "tier_info": tier,
                "classification": ClassificationResult(
                    complexity=force_tier, category="forced", confidence=1.0,
                    reason="forced by client", model_used="forced", fallback=False,
                ),
            }

        # 跑分类 (这个无论如何都要跑, 拿到 task_complexity)
        cls = self.classifier or get_classifier()
        result = await cls.classify(user_message, history)
        task_complexity = result.complexity  # low / medium / high

        # v0.8.0: high 触发规则 = deep_thinking AND complexity=high
        if deep_thinking and task_complexity == "high":
            tier = self.get_tier("high")
            return {
                "complexity": "high",
                "primary_model": tier.primary,
                "fallback_models": tier.fallback,
                "tier_info": tier,
                "classification": ClassificationResult(
                    complexity="high", category="deep_thinking+high", confidence=1.0,
                    reason=f"deep_thinking=ON AND classifier=high (满足 high 双条件)",
                    model_used="forced", fallback=False,
                ),
            }

        # v0.8.0: 跳闸 — 任何未走 high 的情况, 上限 mid
        # v0.9.8: 改 — classifier 分 high 时, **仍然用 high tier** (只是不显示 reasoning)
        # 之前降级 medium 会让好问题用便宜模型, 体验更差
        # deep_thinking 只是 "额外显示 thinking" 开关, 不应影响主模型选择
        # v0.1.7+: tier_mode=normal 时, cap 到 medium (不允许 high)
        target_complexity = task_complexity
        if tier_mode == "normal" and target_complexity == "high":
            target_complexity = "medium"
            reason_suffix = " [常规模式: cap 到 medium, 不允许 high]"
        elif target_complexity == "high" and not deep_thinking:
            reason_suffix = " [high 模型; 深度思考未开, 不显示 reasoning]"
        elif deep_thinking and target_complexity in ("low", "medium"):
            reason_suffix = ""
        else:
            reason_suffix = ""

        tier = self.get_tier(target_complexity)
        return {
            "complexity": target_complexity,
            "primary_model": tier.primary,
            "fallback_models": tier.fallback,
            "tier_info": tier,
            "classification": ClassificationResult(
                complexity=target_complexity,
                category=result.category,
                confidence=result.confidence,
                reason=result.reason + reason_suffix,
                model_used=result.model_used,
                fallback=result.fallback,
            ),
        }

    @staticmethod
    def get_current_routing() -> dict:
        """v0.9.5: 共享给 /api/diagnose 显示用 (不读 .env, 只读 DB)"""
        return _load_tiers_from_db()


# ===== 单例 =====

_router_singleton: Optional[TierRouter] = None


def get_tier_router() -> TierRouter:
    global _router_singleton
    if _router_singleton is None:
        _router_singleton = TierRouter()
    return _router_singleton


async def classify_and_route(
    user_message: str,
    history: Optional[list] = None,
    deep_thinking: bool = False,
    force_tier: Optional[str] = None,
) -> dict:
    """便捷函数: 一步到位"""
    return await get_tier_router().classify_and_route(
        user_message, history, deep_thinking, force_tier,
    )
