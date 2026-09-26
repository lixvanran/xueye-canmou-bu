"""日程/学习计划工具 - v2.0 新增
- create_schedule / delete_schedule / list_schedule / update_schedule: 增删改查
- suggest_schedule: LLM 调这个生成 N 天的计划 (基于用户目标 + 学习曲线)
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from app.db.database import SessionLocal, ScheduleORM

logger = logging.getLogger(__name__)


# v2.0: 学习曲线模板 (LLM 生成计划的兜底参考)
_STUDY_TEMPLATES = {
    "exam": [
        "复习昨天错题, 巩固薄弱知识点",
        "做一套真题计时训练",
        "整理本周笔记, 总结考点",
        "专项突破: 高频考点专项训练",
        "错题二刷 + 拓展同类题",
        "模拟考试 + 复盘",
        "休息 + 轻量复盘",
    ],
    "review": [
        "回顾上阶段核心知识点",
        "错题本再过一遍",
        "薄弱环节定向练习",
        "总结卡片复习 (Anki 风格)",
        "综合应用题训练",
    ],
    "rest": [
        "休息, 不安排学习任务",
        "散步/运动, 调整状态",
        "听音乐/阅读课外书, 放松",
    ],
    "custom": [
        "自定义任务",
    ],
}


def _validate_date(date_str: str) -> Optional[str]:
    """校验 YYYY-MM-DD, 不合法返回 None."""
    if not date_str:
        return None
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return date_str
    except (ValueError, TypeError):
        return None


def _serialize(item: ScheduleORM) -> Dict:
    return {
        "id": item.id,
        "date": item.date,
        "content": item.content,
        "type": item.type,
        "completed": bool(item.completed),
        "resource_id": item.resource_id,
        "note": item.note,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


async def create_schedule(
    date: str,
    content: str,
    type: str = "study",
    note: str = "",
    resource_id: Optional[int] = None,
    user_id: int = 1,
) -> Dict:
    """创建一条日程/学习计划

    Args:
        date: 日期 'YYYY-MM-DD'
        content: 内容 (短文本, 一行)
        type: 类型 study/review/exam/rest/custom
        note: AI/用户额外备注
        resource_id: 关联的错题/资料 id (可选)
        user_id: 用户 ID
    """
    safe_date = _validate_date(date)
    if not safe_date:
        return {"success": False, "error": f"日期格式不对: {date} (应为 YYYY-MM-DD)"}
    if not content or not content.strip():
        return {"success": False, "error": "content 不能为空"}
    if type not in {"study", "review", "exam", "rest", "custom"}:
        return {"success": False, "error": f"type 不在合法值域: {type}"}

    db = SessionLocal()
    try:
        item = ScheduleORM(
            user_id=user_id,
            date=safe_date,
            content=content.strip()[:256],
            type=type,
            note=note.strip() if note else None,
            resource_id=resource_id,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        logger.info(f"Schedule created: id={item.id} date={safe_date} type={type}")
        return {"success": True, **_serialize(item)}
    except Exception as e:
        logger.error(f"create_schedule error: {e}")
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


async def delete_schedule(id: int, user_id: int = 1) -> Dict:
    """删除一条日程"""
    db = SessionLocal()
    try:
        item = db.query(ScheduleORM).filter_by(id=id, user_id=user_id).first()
        if not item:
            return {"success": False, "error": f"找不到 id={id} 的日程"}
        db.delete(item)
        db.commit()
        logger.info(f"Schedule deleted: id={id}")
        return {"success": True, "id": id, "message": "已删除"}
    except Exception as e:
        logger.error(f"delete_schedule error: {e}")
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


async def list_schedule(
    date_range: Optional[Tuple[str, str]] = None,
    type: Optional[str] = None,
    include_completed: bool = True,
    user_id: int = 1,
    limit: int = 100,
) -> List[Dict]:
    """查日程

    Args:
        date_range: (start_date, end_date) 元组, 闭区间. 都不传则查所有
        type: 类型过滤
        include_completed: 是否含已完成
        user_id: 用户 ID
        limit: 最多返回条数
    """
    db = SessionLocal()
    try:
        q = db.query(ScheduleORM).filter_by(user_id=user_id)
        if date_range:
            start, end = date_range
            safe_start = _validate_date(start) if start else None
            safe_end = _validate_date(end) if end else None
            if safe_start:
                q = q.filter(ScheduleORM.date >= safe_start)
            if safe_end:
                q = q.filter(ScheduleORM.date <= safe_end)
        if type:
            q = q.filter(ScheduleORM.type == type)
        if not include_completed:
            q = q.filter(ScheduleORM.completed == False)  # noqa: E712
        items = q.order_by(ScheduleORM.date.asc(), ScheduleORM.id.asc()).limit(limit).all()
        return [_serialize(i) for i in items]
    except Exception as e:
        logger.error(f"list_schedule error: {e}")
        return []
    finally:
        db.close()


async def update_schedule(
    id: int,
    date: Optional[str] = None,
    content: Optional[str] = None,
    type: Optional[str] = None,
    note: Optional[str] = None,
    completed: Optional[bool] = None,
    user_id: int = 1,
    **kwargs,
) -> Dict:
    """更新日程. 只更新显式传的字段."""
    db = SessionLocal()
    try:
        item = db.query(ScheduleORM).filter_by(id=id, user_id=user_id).first()
        if not item:
            return {"success": False, "error": f"找不到 id={id} 的日程"}

        if date is not None:
            safe_date = _validate_date(date)
            if not safe_date:
                return {"success": False, "error": f"日期格式不对: {date}"}
            item.date = safe_date
        if content is not None:
            if not content.strip():
                return {"success": False, "error": "content 不能为空"}
            item.content = content.strip()[:256]
        if type is not None:
            if type not in {"study", "review", "exam", "rest", "custom"}:
                return {"success": False, "error": f"type 不在合法值域: {type}"}
            item.type = type
        if note is not None:
            item.note = note.strip() if note else None
        if completed is not None:
            item.completed = bool(completed)

        # 兼容多余 kwargs (LLM 可能传未知字段, 静默忽略, 不报错)
        db.commit()
        db.refresh(item)
        logger.info(f"Schedule updated: id={id}")
        return {"success": True, **_serialize(item)}
    except Exception as e:
        logger.error(f"update_schedule error: {e}")
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


async def suggest_schedule(goal: str, days: int = 7, start_date: Optional[str] = None) -> List[Dict]:
    """让 Agent 自动生成 N 天计划. 这是 LLM 工具 — 返回"草稿", 不直接入库.

    Args:
        goal: 用户目标 (e.g. "期末数学冲 120", "英语六级 500+", "考研数学 80+")
        days: 生成天数 (默认 7, 最大 30)
        start_date: 起始日期 (默认今天)

    Returns:
        [{date, content, type}, ...] — 给 LLM 参考, 让它再决定要不要 create_schedule 入库
    """
    try:
        days = max(1, min(int(days), 30))
    except (ValueError, TypeError):
        days = 7

    # 起始日: 今天或传入
    if start_date and _validate_date(start_date):
        start = datetime.strptime(start_date, "%Y-%m-%d")
    else:
        start = datetime.now()

    # 按目标关键字匹配模板
    goal_lower = goal.lower()
    if any(k in goal for k in ["六级", "四级", "雅思", "托福", "英语"]):
        template = _STUDY_TEMPLATES["exam"]
    elif any(k in goal for k in ["考研", "高考", "中考", "期末", "模拟"]):
        template = _STUDY_TEMPLATES["exam"]
    elif any(k in goal for k in ["复习", "巩固", "回顾"]):
        template = _STUDY_TEMPLATES["review"]
    else:
        template = _STUDY_TEMPLATES["exam"]

    # 简单生成: 7 天循环套模板
    suggestions = []
    for i in range(days):
        day = start + timedelta(days=i)
        idx = i % len(template)
        item_type = "rest" if (i + 1) % 7 == 0 else "study"  # 每 7 天放一天休息
        suggestions.append({
            "date": day.strftime("%Y-%m-%d"),
            "content": template[idx],
            "type": item_type,
            "goal_context": goal,
        })

    logger.info(f"suggest_schedule generated {len(suggestions)} items for goal={goal!r}")
    return suggestions