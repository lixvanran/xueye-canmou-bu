"""长期事实抽取器 - v0.9.9
模仿人脑长期记忆: 每次对话后 LLM 提取 1-3 个高密度事实, 存到 user_facts 表

- profile: 个人信息 (省份/分数/学校/家庭)
- preference: 偏好 (想学什么/不想学什么/城市偏好)
- knowledge: 知识状态 (已经会的/还没学的)
- mistake_pattern: 错题模式 (总错的地方/常用错法)

不存对话原文, 只存"压缩事实" → 大幅减小 token 消耗
"""
from __future__ import annotations

import json
import logging
import re
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.database import UserFactORM

logger = logging.getLogger(__name__)

EXTRACT_PROMPT = """你是一个长期记忆提取助手. 从用户和 AI 的对话中, 提取**值得长期记住的事实**.

# 提取规则
1. 只提取**具体且长期有用**的事实, 跳过寒暄/一次性提问
2. 1-3 个事实, 不要超过 3 个
3. 事实要**短而精**, 一句话能说完
4. 类别: profile (个人信息) / preference (偏好) / knowledge (知识状态) / mistake_pattern (错题模式)
5. 重要性 0-1: 0.3 = 边缘, 0.5 = 一般, 0.8 = 重要, 0.95 = 关键 (比如分数/学校/目标)

# 跳过
- "你好" / "谢谢" / "再见" 这类寒暄
- "这道题怎么解" 一次性提问 (没持续信息)
- 错题的具体内容 (已经存到错题本了)

# 输出 (ONLY JSON, 严格格式)
```json
{"facts": [
  {"category": "profile", "fact": "湖北高三, 物理类, 估分 620", "importance": 0.95},
  {"category": "preference", "fact": "想学 AI/计算机相关, 倾向 985", "importance": 0.8}
]}
```

如果对话没值得记的事实, 输出 `{"facts": []}`

# 对话
{conversation}
"""


async def extract_facts_from_conversation(
    user_message: str,
    assistant_message: str,
    user_id: int = 1,
    conversation_id: Optional[int] = None,
    db: Optional[Session] = None,
) -> List[Dict]:
    """从一轮对话里抽取事实, 存到 DB
    Returns: 抽取到的事实列表
    """
    from app.agent.llm.openrouter import llm_client

    conversation = f"用户: {user_message}\n\nAI: {assistant_message[:1500]}"
    if len(conversation) < 50:
        return []

    prompt = EXTRACT_PROMPT.format(conversation=conversation)

    try:
        result = await llm_client.chat(
            messages=[
                {"role": "system", "content": "你是 JSON 输出助手, 严格只输出 JSON."},
                {"role": "user", "content": prompt},
            ],
        )
        content = result.get("content", "")
        # 提取 JSON
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            logger.debug(f"Fact extract: no JSON found in {content[:100]}")
            return []
        data = json.loads(m.group())
        facts = data.get("facts", [])
        if not facts or not isinstance(facts, list):
            return []
    except Exception as e:
        logger.warning(f"Fact extract failed: {e}")
        return []

    # 过滤: importance < 0.3 不要
    facts = [f for f in facts if f.get("importance", 0) >= 0.3]
    facts = facts[:3]  # 最多 3 个

    # 存 DB
    if not facts:
        return []
    should_close = False
    if db is None:
        from app.db.database import SessionLocal
        db = SessionLocal()
        should_close = True
    try:
        for f in facts:
            fact = f.get("fact", "").strip()
            if not fact or len(fact) > 500:
                continue
            record = UserFactORM(
                user_id=user_id,
                category=f.get("category", "profile"),
                fact=fact,
                importance=float(f.get("importance", 0.5)),
                source_conversation_id=conversation_id,
                stale=0,
            )
            db.add(record)
        db.commit()
        logger.info(f"Extracted {len(facts)} facts for user {user_id} (conv {conversation_id})")
        return facts
    except Exception as e:
        logger.error(f"Save facts failed: {e}")
        db.rollback()
        return []
    finally:
        if should_close:
            db.close()


def get_user_facts(db: Session, user_id: int = 1, limit: int = 30, include_stale: bool = False) -> List[Dict]:
    """取用户的活跃事实 (按 importance 降序)"""
    q = db.query(UserFactORM).filter_by(user_id=user_id)
    if not include_stale:
        q = q.filter_by(stale=0)
    rows = q.order_by(UserFactORM.importance.desc(), UserFactORM.updated_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "category": r.category,
            "fact": r.fact,
            "importance": r.importance,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def format_facts_for_prompt(facts: List[Dict]) -> str:
    """把事实列表拼成 LLM 友好的文本块"""
    if not facts:
        return ""
    lines = ["# 长期记忆 (v0.9.9: 自动抽取, 高密度事实)"]
    for f in facts:
        cat = f.get("category", "profile")
        fact = f.get("fact", "")
        imp = f.get("importance", 0.5)
        imp_tag = "🔴" if imp >= 0.8 else "🟡" if imp >= 0.5 else "⚪"
        lines.append(f"- {imp_tag} [{cat}] {fact}")
    lines.append("\n# 指令: 这些是用户长期信息, 回答时要自然引用 (比如'你之前说你是湖北的...'), 不要假装是刚知道的.")
    return "\n".join(lines)
