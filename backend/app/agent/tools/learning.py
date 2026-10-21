"""学习主线工具 — LLM 可调用 (v1.3.0)

这些工具让 AI 能主动干活, 而不只是聊天:
- 学生拍了一道错题 → AI 调 `add_mistake` 归档 + 归因
- 学生问"我哪里最差" → AI 调 `list_weak_points` 看掌握度
- 学生报了一次模考成绩 → AI 调 `add_exam_score` 归因失分
- 复习完 → AI 调 `list_mistakes` 拉今天的队列

⚠️ 每个工具失败时都必须返回**可识别的失败标记** (`{"error": ...}`),
   不许返回空 dict —— 空 dict 会被上层当成"成功但没数据"。
"""
import logging
from typing import Any, Dict, List, Optional

from app.db.database import SessionLocal
from app.learning import service
from app.learning.knowledge import search_knowledge

logger = logging.getLogger(__name__)


async def add_mistake(
    subject: str,
    title: str,
    content: str = "",
    my_answer: str = "",
    correct_answer: str = "",
    cause: str = "",
    knowledge_tags: Optional[List[str]] = None,
    difficulty: int = 3,
    user_id: int = 1,
) -> Dict:
    """把一道错题归档进错题本, 并按知识点标签更新掌握度

    什么时候用: 学生发来一张题目照片/文本, 说"这道我做错了"、"帮我记下来"、
    或者讲题过程中学生承认做错了。

    Args:
        subject: 科目, 数学/物理/化学/英语/语文
        title: 题目一句话摘要
        content: 题目原文 (能拿到就填)
        my_answer: 学生当时的答案
        correct_answer: 正确答案
        cause: 错因, 取值 concept(概念不清)/calculation(计算失误)/method(方法不会)/
                unfamiliar(题型不熟)/careless(粗心)/time(时间不够)
        knowledge_tags: 涉及的知识点, 越准越好 —— 掌握度按这个更新
        difficulty: 难度 1-5
    """
    try:
        db = SessionLocal()
        try:
            res = service.create_mistake(
                db,
                user_id=user_id,
                subject=subject,
                title=title,
                content=content,
                my_answer=my_answer,
                correct_answer=correct_answer,
                cause=cause,
                knowledge_tags=knowledge_tags or [],
                difficulty=difficulty,
            )
            # 附上知识点卡, 让 AI 知道这些知识点讲什么 (下轮可以照着讲)
            cards = []
            for tag in (knowledge_tags or [])[:3]:
                hits = search_knowledge(tag, subject=subject, limit=1)
                if hits:
                    cards.append({
                        "name": hits[0].get("name"),
                        "summary": hits[0].get("summary"),
                        "pitfalls": hits[0].get("pitfalls") or [],
                    })
            res["knowledge_cards"] = cards
            return res
        finally:
            db.close()
    except Exception as e:
        logger.error(f"add_mistake failed: {e}")
        return {"error": f"add_mistake 失败: {e}"}


async def list_mistakes(
    subject: str = "",
    only_due: bool = False,
    limit: int = 20,
    user_id: int = 1,
) -> Dict:
    """查错题本。可以只看"今天该复习的"。

    Args:
        subject: 科目, 留空 = 全部
        only_due: True = 只返回今天到期的
        limit: 最多返回条数
    """
    try:
        db = SessionLocal()
        try:
            items = service.list_mistakes(
                db, user_id=user_id,
                subject=subject or None,
                only_due=only_due,
                limit=limit,
            )
            return {"items": items, "count": len(items)}
        finally:
            db.close()
    except Exception as e:
        logger.error(f"list_mistakes failed: {e}")
        return {"error": f"list_mistakes 失败: {e}"}


async def list_weak_points(
    subject: str = "",
    limit: int = 10,
    user_id: int = 1,
) -> Dict:
    """查薄弱知识点 (掌握度低 + 错过)。

    学生问"我最差的是什么"/"该从哪开始补"时用。
    """
    try:
        db = SessionLocal()
        try:
            items = service.weak_points(db, user_id, subject or None, limit)
            return {
                "items": items,
                "count": len(items),
                "hint": "按'掌握度低 + 错得多'排序, 建议从第一个开始补",
            }
        finally:
            db.close()
    except Exception as e:
        logger.error(f"list_weak_points failed: {e}")
        return {"error": f"list_weak_points 失败: {e}"}


async def add_exam_score(
    name: str,
    subject: str,
    score: float,
    total: Optional[float] = None,
    exam_date: Optional[str] = None,
    detail: Optional[List[Dict]] = None,
    note: str = "",
    user_id: int = 1,
) -> Dict:
    """录入一次模考/期中成绩, 并把各题失分归因到知识点。

    Args:
        name: 考试名, 如 "高一上期中" "中考一模"
        subject: 科目
        score: 得分
        total: 满分
        exam_date: "YYYY-MM-DD", 不填按今天
        detail: 各题失分明细, 每项 {"q": "第3题", "kp": "二次函数", "lost": 8,
              "total": 12, "why": "计算错误"} —— **kp 填了才会归因到掌握度**
        note: 备注
    """
    try:
        db = SessionLocal()
        try:
            return service.add_exam_score(
                db,
                user_id=user_id,
                name=name,
                subject=subject,
                score=score,
                total=total,
                exam_date=exam_date,
                detail=detail or [],
                note=note,
            )
        finally:
            db.close()
    except Exception as e:
        logger.error(f"add_exam_score failed: {e}")
        return {"error": f"add_exam_score 失败: {e}"}


async def search_knowledge_points(
    keyword: str,
    subject: str = "",
    limit: int = 10,
) -> Dict:
    """在知识点库里搜 (按名称/别名/摘要)。

    学生报了一个知识点名, 但你不知道标准叫法时, 用它找到标准名称 ——
    掌握度是按**标准名称字符串**对齐的, 叫法不一致会导致掌握度记不上。
    """
    try:
        items = search_knowledge(keyword, subject=subject or None, limit=limit)
        return {"items": items, "count": len(items)}
    except Exception as e:
        logger.error(f"search_knowledge_points failed: {e}")
        return {"error": f"search_knowledge_points 失败: {e}"}
