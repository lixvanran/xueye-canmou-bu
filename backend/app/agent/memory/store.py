"""Memory Store - 底层 DB CRUD
所有函数接收 db session, 不持有 session (无状态, 易测)

v2.0: conversations/messages 的 CRUD 强制 WHERE scenario=?
- 防止 chat 场景混入 exam 场景的消息 ("串台")
- scenario 参数必传, 缺省 'chat'
"""
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime

from app.db.database import (
    MessageORM, ConversationORM, UserORM, UserFactORM,
    normalize_scenario,
)


SCENARIO_DEFAULT_TITLES = {
    "volunteer": "志愿咨询",
    "exam": "备考答疑",
    "chat": "随便聊聊",
    "chitchat": "随便聊聊",
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
    """v2.0: scenario 强制归一化. 非法值降级 chat."""
    safe_scenario = normalize_scenario(scenario)
    new_conv = ConversationORM(
        user_id=user_id,
        scenario=safe_scenario,
        title=SCENARIO_DEFAULT_TITLES.get(safe_scenario, "新对话"),
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


def list_conversation_messages(
    db: Session,
    conversation_id: int,
    limit: int = 10,
    scenario: Optional[str] = None,
) -> List[MessageORM]:
    """v2.0: 强制 WHERE scenario=?. 不传则用 conversations.scenario.

    防串台: 即使 conversation_id 撞库 (历史数据 / 误传), scenario 不匹配的消息也不会返回.
    """
    # 先取 conv 的 scenario (权威源)
    conv = db.query(ConversationORM).filter_by(id=conversation_id).first()
    if not conv:
        return []
    effective_scenario = normalize_scenario(scenario if scenario is not None else conv.scenario)
    q = (
        db.query(MessageORM)
        .filter_by(conversation_id=conversation_id, scenario=effective_scenario)
        .order_by(MessageORM.created_at.desc())
        .limit(limit)
        .all()
    )
    return q[::-1]  # reverse to chronological order


def save_message(
    db: Session,
    conversation_id: int,
    role: str,
    content: str,
    tool_calls: str = None,
    scenario: Optional[str] = None,
) -> MessageORM:
    """v2.0: 强制存 scenario. 缺省则继承 conversation.scenario.

    这是防串台的关键写入点: messages.scenario 必须与 conversations.scenario 一致,
    否则 list_messages() 的 WHERE scenario=? 会过滤掉这条消息.
    """
    if scenario is not None:
        safe_scenario = normalize_scenario(scenario)
    else:
        conv = db.query(ConversationORM).filter_by(id=conversation_id).first()
        safe_scenario = normalize_scenario(conv.scenario if conv else "chat")
    msg = MessageORM(
        conversation_id=conversation_id,
        scenario=safe_scenario,
        role=role,
        content=content,
        tool_calls=tool_calls,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def search_conversations(
    db: Session,
    user_id: int,
    q: str = "",
    scenario: Optional[str] = None,
    limit: int = 20,
) -> List[dict]:
    """v2.0: 跨对话搜 (title 模糊 + 命中消息的 conversation).

    - q 为空: 按时间倒序返回该用户所有对话
    - q 非空: 标题 LIKE %q% OR 含匹配消息的对话
    - scenario: 限定场景
    - 返回 [{id, title, scenario, updated_at, hit_count}, ...]
    """
    safe_scenario = normalize_scenario(scenario) if scenario else None

    # 先按 title 命中
    title_hits_q = db.query(ConversationORM).filter_by(user_id=user_id)
    if safe_scenario:
        title_hits_q = title_hits_q.filter(ConversationORM.scenario == safe_scenario)
    if q:
        like = f"%{q}%"
        title_hits_q = title_hits_q.filter(ConversationORM.title.like(like))
    title_hits = {c.id: c for c in title_hits_q.all()}

    # 再按消息命中
    msg_hits = {}
    if q:
        like = f"%{q}%"
        msg_query = (
            db.query(MessageORM.conversation_id)
            .filter(MessageORM.content.like(like))
            .distinct()
        )
        if safe_scenario:
            msg_query = msg_query.filter(MessageORM.scenario == safe_scenario)
        for (conv_id,) in msg_query.all():
            msg_hits[conv_id] = msg_hits.get(conv_id, 0) + 1

    # 合并
    all_ids = set(title_hits) | set(msg_hits)
    if not all_ids:
        return []

    convs = (
        db.query(ConversationORM)
        .filter(ConversationORM.id.in_(all_ids))
        .order_by(ConversationORM.updated_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    for c in convs:
        if c.user_id != user_id:  # 安全: 只能看自己的
            continue
        if safe_scenario and c.scenario != safe_scenario:
            continue
        results.append({
            "id": c.id,
            "title": c.title,
            "scenario": c.scenario,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "hit_count": (1 if c.id in title_hits else 0) + msg_hits.get(c.id, 0),
        })
    return results


def get_user_by_id(db: Session, user_id: int) -> Optional[UserORM]:
    return db.query(UserORM).filter_by(id=user_id).first()


def get_user_profile(db: Session, user_id: int) -> Dict:
    """v2.0: 拉用户画像; 包含新增的 stage/direction/language/agent_name.
    不存在时给个 default.
    """
    user = get_user_by_id(db, user_id)
    if not user:
        return {
            "name": "Student",
            "education_stage": "high",
            "stage": "高中",
            "direction": "",
            "language": "中文",
            "agent_name": "张老师",
        }
    return {
        "id": user.id,
        "name": user.name,
        "education_stage": user.education_stage,
        # v2.0 新字段
        "stage": getattr(user, "stage", "高中") or "高中",
        "direction": getattr(user, "direction", "") or "",
        "language": getattr(user, "language", "中文") or "中文",
        "agent_name": getattr(user, "agent_name", "张老师") or "张老师",
        "province": user.province,
        "score": user.score,
        "rank": user.rank,
        "target": user.target,
        "interests": user.interests,
        "background": user.background,
    }