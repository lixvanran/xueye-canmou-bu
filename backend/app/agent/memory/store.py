"""Memory Store - 底层 DB CRUD
所有函数接收 db session, 不持有 session (无状态, 易测)
"""
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from datetime import datetime

from app.db.database import MessageORM, ConversationORM, UserORM, UserFactORM


SCENARIO_DEFAULT_TITLES = {
    "volunteer": "志愿咨询",
    "exam": "备考答疑",
    "chat": "随便聊聊",
}


# v0.9.9: UserFact 底层 CRUD
def list_user_facts(db: Session, user_id: int = 1, limit: int = 30, include_stale: bool = False) -> List[UserFactORM]:
    q = db.query(UserFactORM).filter_by(user_id=user_id)
    if not include_stale:
        q = q.filter_by(stale=0)
    return q.order_by(UserFactORM.importance.desc(), UserFactORM.updated_at.desc()).limit(limit).all()


def add_user_fact(
    db: Session,
    user_id: int,
    fact: str,
    category: str = "profile",
    importance: float = 0.5,
    source_conversation_id: Optional[int] = None,
) -> UserFactORM:
    """加一条 fact, 如果同 category+同 fact 已存在, 更新 importance"""
    existing = db.query(UserFactORM).filter_by(
        user_id=user_id, fact=fact, category=category
    ).first()
    if existing:
        existing.importance = max(existing.importance, importance)
        existing.updated_at = datetime.now()
        db.commit()
        return existing
    rec = UserFactORM(
        user_id=user_id,
        category=category,
        fact=fact,
        importance=importance,
        source_conversation_id=source_conversation_id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def mark_fact_stale(db: Session, fact_id: int) -> bool:
    rec = db.query(UserFactORM).filter_by(id=fact_id).first()
    if not rec:
        return False
    rec.stale = 1
    db.commit()
    return True


def get_conversation(db: Session, conversation_id: int) -> Optional[ConversationORM]:
    return db.query(ConversationORM).filter_by(id=conversation_id).first()


def create_conversation(db: Session, user_id: int, scenario: str) -> ConversationORM:
    new_conv = ConversationORM(
        user_id=user_id,
        scenario=scenario,
        title=SCENARIO_DEFAULT_TITLES.get(scenario, "新对话"),
    )
    db.add(new_conv)
    db.commit()
    db.refresh(new_conv)
    return new_conv


def update_conversation_title(db: Session, conversation_id: int, new_title: str):
    conv = get_conversation(db, conversation_id)
    if conv:
        conv.title = new_title
        db.commit()


def list_conversation_messages(db: Session, conversation_id: int, limit: int = 10) -> List[MessageORM]:
    return (
        db.query(MessageORM)
        .filter_by(conversation_id=conversation_id)
        .order_by(MessageORM.created_at.desc())
        .limit(limit)
        .all()
    )[::-1]  # reverse to chronological order


def save_message(db: Session, conversation_id: int, role: str, content: str, tool_calls: str = None) -> MessageORM:
    msg = MessageORM(
        conversation_id=conversation_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
    )
    db.add(msg)
    db.commit()
    return msg


def get_user_by_id(db: Session, user_id: int) -> Optional[UserORM]:
    return db.query(UserORM).filter_by(id=user_id).first()


def get_user_profile(db: Session, user_id: int) -> Dict:
    """拉用户画像; 不存在时给个 default"""
    user = get_user_by_id(db, user_id)
    if not user:
        return {"name": "Student", "education_stage": "high"}
    return {
        "name": user.name,
        "education_stage": user.education_stage,
        "province": user.province,
        "score": user.score,
        "rank": user.rank,
        "target": user.target,
        "interests": user.interests,
        "background": user.background,
    }
