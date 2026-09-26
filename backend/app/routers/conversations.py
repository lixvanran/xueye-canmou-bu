"""Conversation history API

v2.0: 新增 GET /api/conversations/search — 跨对话搜 (title + message content)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.db.database import get_db, ConversationORM, MessageORM
from app.models.schemas import ScenarioEnum
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/conversations", tags=["对话历史"])


@router.get("/list")
async def list_conversations(
    user_id: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """List user's conversations (newest first)"""
    items = (
        db.query(ConversationORM)
        .filter_by(user_id=user_id)
        .order_by(ConversationORM.updated_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "total": len(items),
        "items": [
            {
                "id": c.id,
                "scenario": c.scenario,
                "title": c.title,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in items
        ],
    }


# 注意: /search 必须在 /{conversation_id} 之前, 否则会被 int 匹配吃掉
@router.get("/search")
async def search_conversations(
    q: str = Query("", description="搜索关键词, 匹配 title 或 message content (LIKE %q%)"),
    scenario: Optional[str] = Query(None, description="可选 scenario 过滤: chat/exam/volunteer/chitchat"),
    user_id: int = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """v2.0: 跨对话搜索

    - q 为空: 按时间倒序返回该用户所有对话 (等价 list)
    - q 非空: title LIKE %q% OR message.content LIKE %q%
    - 可选 scenario 过滤
    - 返回 [{id, title, scenario, updated_at, hit_count}, ...]
    """
    from app.agent.memory.store import search_conversations as _search
    results = _search(db, user_id=user_id, q=q, scenario=scenario, limit=limit)
    return {"total": len(results), "items": results, "q": q, "scenario": scenario}


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    """Get conversation with all messages"""
    conv = db.query(ConversationORM).filter_by(id=conversation_id).first()
    if not conv:
        raise HTTPException(404, "Conversation not found")
    # v2.0: 强制 scenario 过滤 (防串台)
    messages = (
        db.query(MessageORM)
        .filter_by(conversation_id=conversation_id, scenario=conv.scenario)
        .order_by(MessageORM.created_at)
        .all()
    )
    return {
        "id": conv.id,
        "scenario": conv.scenario,
        "title": conv.title,
        "created_at": conv.created_at.isoformat() if conv.created_at else None,
        "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "tool_calls": m.tool_calls,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.patch("/{conversation_id}")
async def update_conversation(
    conversation_id: int,
    title: Optional[str] = None,
    db: Session = Depends(get_db),
):
    conv = db.query(ConversationORM).filter_by(id=conversation_id).first()
    if not conv:
        raise HTTPException(404, "Not found")
    if title is not None:
        conv.title = title
    db.commit()
    return {"message": "Updated"}


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(ConversationORM).filter_by(id=conversation_id).first()
    if not conv:
        raise HTTPException(404, "Not found")
    db.delete(conv)
    db.commit()
    return {"message": "Deleted"}


@router.post("/new")
async def create_conversation(
    scenario: str = "chat",
    title: Optional[str] = None,
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    """Create a blank conversation. v2.0: scenario 强制归一化."""
    from app.db.database import normalize_scenario
    safe_scenario = normalize_scenario(scenario)
    conv = ConversationORM(
        user_id=user_id,
        scenario=safe_scenario,
        title=title or "新对话",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {
        "id": conv.id,
        "scenario": conv.scenario,
        "title": conv.title,
    }