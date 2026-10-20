"""Settings API - v0.9.1 新增
- GET/PUT 模型选择 (low/mid/high 档)
- GET API 状态 + OpenRouter 余额/消费
"""
import logging
import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db, UserPreferenceORM
from app.core.config import settings
from app.agent.routing.model_whitelist import (
    get_whitelist,
    get_default_tier_models,
    describe_active,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["系统设置"])


# ===== Pydantic schemas =====

class ModelSelection(BaseModel):
    """用户对三档模型的选择"""
    low: str
    medium: str
    high: str


class ModelSettings(BaseModel):
    """完整的模型设置 (含每档可选列表)"""
    whitelist: dict  # { low: [...], medium: [...], high: [...] }
    defaults: dict   # { low: ..., medium: ..., high: ... }
    current: ModelSelection


class UsageResponse(BaseModel):
    """LLM 余额/消费 (OpenRouter 才有余额, 其他 provider 走 message 提示)"""
    ok: bool
    email: Optional[str] = None
    is_free_tier: Optional[bool] = None
    limit: Optional[float] = None          # 总额度 ($)
    limit_remaining: Optional[float] = None  # 剩余额度 ($)
    usage: Optional[float] = None         # 已用 ($)
    error: Optional[str] = None
    error_code: Optional[int] = None      # v1.2.4: 透传 HTTP 状态码
    message: Optional[str] = None         # v1.2.4: 非 OpenRouter 时的说明


# ===== 工具函数 =====

def _get_pref(db: Session, user_id: int, key: str, default=None):
    """读一个用户偏好"""
    row = db.query(UserPreferenceORM).filter_by(user_id=user_id, key=key).first()
    if row and row.value is not None:
        return row.value
    return default


def _set_pref(db: Session, user_id: int, key: str, value):
    """写一个用户偏好 (upsert)"""
    row = db.query(UserPreferenceORM).filter_by(user_id=user_id, key=key).first()
    if row:
        row.value = value
    else:
        row = UserPreferenceORM(user_id=user_id, key=key, value=value)
        db.add(row)
    db.commit()
    return row


def _validate_model_in_whitelist(tier: str, model: str) -> None:
    """校验模型在当前 provider 白名单内, 不在就 raise

    v1.2.4: 白名单按 provider 走 (openrouter / minimax / deepseek / 智谱 / 硅基流动),
    不再写死 OpenRouter 的 model id。
    """
    if tier not in ("low", "medium", "high"):
        raise HTTPException(400, f"未知档位: {tier}")
    allowed = get_whitelist(tier)
    if model not in allowed:
        provider = describe_active()["provider_label"]
        raise HTTPException(
            400,
            f"模型 {model} 不在 {tier} 档白名单内 (当前服务商: {provider}). "
            f"允许: {', '.join(allowed)}"
        )


# ===== API 端点 =====

@router.get("/models", response_model=ModelSettings)
async def get_model_settings(user_id: int = 1, db: Session = Depends(get_db)):
    """获取模型设置: 白名单 + 默认 + 当前选择"""
    current = {
        "low": _get_pref(db, user_id, "model_low", get_default_tier_models()["low"]),
        "medium": _get_pref(db, user_id, "model_medium", get_default_tier_models()["medium"]),
        "high": _get_pref(db, user_id, "model_high", get_default_tier_models()["high"]),
    }
    return ModelSettings(
        whitelist={t: get_whitelist(t) for t in ("low", "medium", "high")},
        defaults=get_default_tier_models(),
        current=ModelSelection(**current),
    )


@router.put("/models")
async def update_model_settings(
    selection: ModelSelection,
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    """更新用户的三档模型选择

    每个模型必须在该档的白名单内, 否则 400
    """
    # 校验
    for tier, model in [
        ("low", selection.low),
        ("medium", selection.medium),
        ("high", selection.high),
    ]:
        _validate_model_in_whitelist(tier, model)

    # 写入
    _set_pref(db, user_id, "model_low", selection.low)
    _set_pref(db, user_id, "model_medium", selection.medium)
    _set_pref(db, user_id, "model_high", selection.high)

    logger.info(
        f"User {user_id} updated models: low={selection.low}, "
        f"medium={selection.medium}, high={selection.high}"
    )
    return {
        "success": True,
        "message": "模型设置已更新, 下次对话生效",
        "current": selection.dict(),
    }


@router.get("/usage", response_model=UsageResponse)
async def get_usage():
    """查询 LLM 余额/消费

    v1.2.4: 校验端点跟随 LLM_BASE_URL —— OpenRouter 系能拿到余额/账号;
    其他 provider 查不到余额, 返回 ok=True + 提示"该服务商不提供余额查询"。
    """
    if not settings.LLM_API_KEY:
        return UsageResponse(ok=False, error="LLM_API_KEY 未设置, 无法查询余额")

    from app.agent.llm.provider_check import check_llm_credentials
    try:
        chk = await check_llm_credentials(settings.LLM_API_KEY, settings.LLM_BASE_URL)
        if not chk["ok"]:
            return UsageResponse(
                ok=False,
                error=chk.get("error") or chk.get("hint"),
                error_code=chk.get("error_code"),
            )
        acct = chk.get("account") or {}
        if not acct:
            # 非 OpenRouter: 鉴权通过, 但查不到余额 —— 这不是错误
            return UsageResponse(
                ok=True,
                error=None,
                message="该服务商不提供余额查询 (鉴权已通过)",
            )
        return UsageResponse(
            ok=True,
            email=acct.get("email"),
            is_free_tier=acct.get("is_free_tier"),
            limit=acct.get("limit"),
            limit_remaining=acct.get("limit_remaining"),
            usage=acct.get("usage"),
        )
    except Exception as e:
        logger.error(f"Usage query error: {e}")
        return UsageResponse(ok=False, error=str(e))


@router.get("/status")
async def get_status(db: Session = Depends(get_db)):
    """简化的系统状态 (前端系统设置页用)

    返回: key 是否设置, 基础 URL, 当前模型选择
    """
    return {
        "llm_api_key_set": bool(settings.LLM_API_KEY),
        "llm_api_key_prefix": (settings.LLM_API_KEY[:12] + "...") if settings.LLM_API_KEY else None,
        "llm_base_url": settings.LLM_BASE_URL,
        "embedding_provider": getattr(settings, "embedding_provider", "unknown"),
        "tts_enabled": True,  # v0.9.8: browser web speech always available
        "current_models": {
            "low": _get_pref(db, 1, "model_low", get_default_tier_models()["low"]),
            "medium": _get_pref(db, 1, "model_medium", get_default_tier_models()["medium"]),
            "high": _get_pref(db, 1, "model_high", get_default_tier_models()["high"]),
        },
    }
