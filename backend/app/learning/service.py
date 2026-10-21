"""学习主线业务逻辑 — 错题本 / 掌握度 / 复习队列 / 模考归因 (v1.3.0)

这一层是"错题 → 归因 → 掌握度 → 复习队列 → 复习 → 掌握度再更新"这个飞轮的全部逻辑。
**所有写操作都返回可解释的理由**, 前端能直接显示, 不做黑盒。
"""
import logging
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.database import ResourceORM, SessionLocal
from app.learning import srs
from app.learning.db import KPMasteryORM, ExamScoreORM

logger = logging.getLogger(__name__)

# 错因枚举 (与 resources.error_type 原有值域对齐)
ERROR_TYPES = {
    "concept": "概念不清",
    "calculation": "计算失误",
    "method": "方法不会",
    "unfamiliar": "题型不熟",
    "careless": "审题/粗心",
    "time": "时间不够",
}


# ========== 错题本 ==========

def create_mistake(
    db: Session,
    user_id: int,
    subject: str,
    title: str,
    content: str = "",
    my_answer: str = "",
    correct_answer: str = "",
    cause: str = "",
    knowledge_tags: Optional[List[str]] = None,
    file_path: str = "",
    difficulty: int = 3,
) -> Dict:
    """录入一道错题, 并同步更新相关知识点的掌握度

    Args:
        cause: 错因, 取值见 ERROR_TYPES (也接受中文标签)
        knowledge_tags: 知识点标签, 掌握度按这些标签更新

    Returns:
        {"success": bool, "id": int, "code": str, "mastery_updates": [...]}
    """
    now = datetime.now()
    tags = [t.strip() for t in (knowledge_tags or []) if t and t.strip()]

    # 错题本里的 code 形如 M-001 —— 找当前最大编号
    existing = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake"
    ).count()
    code = f"M-{existing + 1:03d}"

    cause_key = _normalize_cause(cause)
    item = ResourceORM(
        user_id=user_id,
        type="mistake",
        code=code,
        subject=subject or None,
        title=title[:256],
        content=content or None,
        notes=my_answer or None,          # notes = 我的答案
        solution=correct_answer or None,   # solution = 正确答案
        thinking=cause or None,
        file_path=file_path or None,
        tags=tags,
        knowledge_tags=tags,
        knowledge_point=tags[0] if tags else None,
        error_type=cause_key,
        mastered=False,
        difficulty=max(1, min(5, int(difficulty or 3))),
        # SRS 字段: 刚录的错题, 今天就该复习
        review_count=0,
        next_review_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # 掌握度: 错一次 ⇒ 该知识点等级下调
    mastery_updates = []
    for tag in tags:
        u = _bump_mastery(db, user_id, tag, subject, answered_correct=False, now=now)
        mastery_updates.append(u)

    return {
        "success": True,
        "id": item.id,
        "code": code,
        "mastery_updates": mastery_updates,
    }


# 错因关键词表 —— LLM 说法千变万化 ("计算错误" / "算错了" / "公式记混了"),
# 光靠枚举值做 substring 会漏 ("计算错误" 跟 "计算失误" 只差一个字, 匹配不上)
CAUSE_KEYWORDS = {
    "calculation": ["计算", "算错", "算术", "符号错", "化简", "通分"],
    "concept": ["概念", "定义", "不理解", "没懂", "公式记", "定理记"],
    "method": ["方法", "不会做", "没思路", "套路", "不会用", "没想到"],
    "unfamiliar": ["不熟", "没见过", "题型", "第一次", "没做过", "不常见"],
    "careless": ["粗心", "看错", "审题", "抄错", "漏看", "手误", "涂错"],
    "time": ["时间", "来不及", "没做完", "超时", "太慢", "做不完"],
}


def _normalize_cause(cause: str) -> str:
    """错因归一到受控枚举 —— 防止自由文本把统计打散

    顺序很重要: 先精确匹配, 再关键词匹配 (关键词表按"具体"程度排)。
    统计要能聚合, 否则"计算错误"/"算错了"/"计算失误"会变成三个不同桶。
    """
    if not cause:
        return ""
    c = str(cause).strip()
    # 1) 精确匹配 (枚举 key 或中文标签)
    for k, v in ERROR_TYPES.items():
        if c == k or c == v:
            return k
    # 2) 关键词匹配 —— 按关键词表顺序, 先命中先返回
    for k, words in CAUSE_KEYWORDS.items():
        for w in words:
            if w in c:
                return k
    # 3) 老逻辑兜底: 枚举中文标签做 substring
    for k, v in ERROR_TYPES.items():
        if v in c:
            return k
    return "unfamiliar"


def list_mistakes(
    db: Session,
    user_id: int = 1,
    subject: Optional[str] = None,
    only_due: bool = False,
    only_unmastered: bool = False,
    limit: int = 50,
) -> List[Dict]:
    """列错题。only_due=True 时只返回"今天该复习"的。"""
    q = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake"
    )
    if subject:
        q = q.filter(ResourceORM.subject == subject)
    if only_unmastered:
        q = q.filter(ResourceORM.mastered.is_(False))
    if only_due:
        now = datetime.now()
        # next_review_at 为 NULL = 还没排期 (老数据 / 手动加的错题)
        # ⇒ 当成"今天该复习", 否则学生之前录的错题在新队列里永远看不到
        q = q.filter(
            ResourceORM.mastered.is_(False),
            or_(
                ResourceORM.next_review_at.is_(None),
                ResourceORM.next_review_at <= now,
            ),
        )
    items = q.order_by(
        ResourceORM.next_review_at.asc().nulls_last(),
        ResourceORM.difficulty.desc(),
        ResourceORM.id.desc(),
    ).limit(max(1, min(limit, 500))).all()
    return [_mistake_dict(i) for i in items]


def get_mistake(db: Session, user_id: int, mistake_id: int) -> Optional[Dict]:
    item = db.query(ResourceORM).filter(
        ResourceORM.id == mistake_id,
        ResourceORM.user_id == user_id,
        ResourceORM.type == "mistake",
    ).first()
    return _mistake_dict(item) if item else None


def _mistake_dict(item: ResourceORM) -> Dict:
    nxt = item.next_review_at
    now = datetime.now()
    due = bool(nxt and nxt <= now and not item.mastered)
    return {
        "id": item.id,
        "code": item.code,
        "subject": item.subject,
        "title": item.title,
        "content": item.content,
        "my_answer": item.notes,
        "correct_answer": item.solution,
        "cause": item.error_type,
        "cause_label": ERROR_TYPES.get(item.error_type or "", item.error_type or ""),
        "knowledge_tags": item.knowledge_tags or [],
        "difficulty": item.difficulty,
        "mastered": bool(item.mastered),
        "review_count": item.review_count or 0,
        "next_review_at": nxt.isoformat() if nxt else None,
        "last_reviewed_at": item.last_reviewed_at.isoformat() if item.last_reviewed_at else None,
        "due": due,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def review_mistake(
    db: Session,
    user_id: int,
    mistake_id: int,
    answered_correct: bool,
    note: str = "",
) -> Dict:
    """复习一道错题 ⇒ 更新该错题的 SRS 状态 + 相关知识点的掌握度

    这是飞轮的转轴: 答一次, 错题本身和知识点掌握度同时前进。
    """
    now = datetime.now()
    item = db.query(ResourceORM).filter(
        ResourceORM.id == mistake_id,
        ResourceORM.user_id == user_id,
        ResourceORM.type == "mistake",
    ).first()
    if not item:
        return {"success": False, "error": f"找不到错题 id={mistake_id}"}

    tags = item.knowledge_tags or ([item.knowledge_point] if item.knowledge_point else [])

    # 错题自身: 答对 3 次视为已掌握
    # v1.3.0 修: 间隔不再硬编码 —— 跟 SRS 用同一套规则
    # (之前答错一律推 1 天, 但 SRS 说掌握度掉到 0 就该"今天还要再练",
    #  两套规则打架 ⇒ 答错的题当天从队列里消失, 学生以为复习完了)
    rc = int(item.review_count or 0) + 1
    item.review_count = rc
    item.last_reviewed_at = now
    if answered_correct:
        if rc >= 3:
            item.mastered = True
            item.next_review_at = None
        else:
            item.next_review_at = now + timedelta(days=2 ** min(rc, 5))
    else:
        item.mastered = False
        # 答错 → 掌握度掉两级; 掉到 0 就今天再来 (SRS 的 level 0 → 0 天)
        cur = _current_level(db, user_id, tags)
        new_level = max(0, cur - 2)
        item.next_review_at = now + timedelta(days=srs.interval_for(new_level, 0))
    if note:
        prev = item.thinking or ""
        item.thinking = (prev + "\n" if prev else "") + note

    # 知识点掌握度
    mastery_updates = []
    for tag in tags:
        u = _bump_mastery(db, user_id, tag, item.subject, answered_correct=answered_correct, now=now)
        mastery_updates.append(u)

    db.commit()
    db.refresh(item)
    return {
        "success": True,
        "mistake": _mistake_dict(item),
        "mastery_updates": mastery_updates,
        "review_count": rc,
    }


def delete_mistake(db: Session, user_id: int, mistake_id: int) -> Dict:
    item = db.query(ResourceORM).filter(
        ResourceORM.id == mistake_id,
        ResourceORM.user_id == user_id,
        ResourceORM.type == "mistake",
    ).first()
    if not item:
        return {"success": False, "error": f"找不到错题 id={mistake_id}"}
    db.delete(item)
    db.commit()
    return {"success": True, "deleted_id": mistake_id}


# ========== 知识点掌握度 ==========

def _current_level(db: Session, user_id: int, tags: List[str]) -> int:
    """取这些知识点当前的最**低**掌握度 —— 错题整体按最弱的那个知识点排期"""
    if not tags:
        return 0
    levels = []
    for tag in tags:
        m = db.query(KPMasteryORM).filter(
            KPMasteryORM.user_id == user_id, KPMasteryORM.kp_name == tag
        ).first()
        levels.append(m.level if m else 0)
    return min(levels)


def _bump_mastery(
    db: Session,
    user_id: int,
    kp_name: str,
    subject: Optional[str],
    answered_correct: bool,
    now: Optional[datetime] = None,
) -> Dict:
    """更新某个知识点的掌握度 (不存在则建)"""
    now = now or datetime.now()
    m = db.query(KPMasteryORM).filter(
        KPMasteryORM.user_id == user_id, KPMasteryORM.kp_name == kp_name
    ).first()
    if m is None:
        m = KPMasteryORM(user_id=user_id, kp_name=kp_name, subject=subject)
        db.add(m)
        db.flush()

    new_level, new_streak, c, w, nxt, reason = srs.apply_answer(
        m.level, m.streak, m.correct_count, m.wrong_count, answered_correct, now=now
    )
    m.level = new_level
    m.streak = new_streak
    m.correct_count = c
    m.wrong_count = w
    m.next_review_at = nxt
    m.last_reviewed_at = now
    if not answered_correct and m.first_wrong_at is None:
        m.first_wrong_at = now
    if subject and not m.subject:
        m.subject = subject
    db.commit()
    db.refresh(m)
    return {
        "kp_name": kp_name,
        "level": new_level,
        "label": srs.mastery_label(new_level),
        "next_review_at": nxt.isoformat(),
        "reason": reason,
    }


def list_mastery(db: Session, user_id: int = 1, subject: Optional[str] = None) -> List[Dict]:
    q = db.query(KPMasteryORM).filter(KPMasteryORM.user_id == user_id)
    if subject:
        q = q.filter(KPMasteryORM.subject == subject)
    rows = q.order_by(KPMasteryORM.level.asc(), KPMasteryORM.wrong_count.desc()).all()
    return [_mastery_dict(r) for r in rows]


def weak_points(
    db: Session,
    user_id: int = 1,
    subject: Optional[str] = None,
    limit: int = 10,
) -> List[Dict]:
    """薄弱知识点 —— 按"错得多 + 等级低 + 沉没成本高"排

    排序键: (等级升序, 错次降序) ⇒ 先给最该补的。
    """
    rows = list_mastery(db, user_id, subject)
    weak = [r for r in rows if r["level"] <= 2 and r["wrong_count"] > 0]
    weak.sort(key=lambda r: (r["level"], -r["wrong_count"]))
    return weak[: max(1, min(limit, 50))]


def _mastery_dict(m: KPMasteryORM) -> Dict:
    now = datetime.now()
    return {
        "kp_name": m.kp_name,
        "subject": m.subject,
        "level": m.level,
        "label": srs.mastery_label(m.level),
        "color": srs.mastery_color(m.level),
        "correct_count": m.correct_count,
        "wrong_count": m.wrong_count,
        "streak": m.streak,
        "accuracy": round(
            m.correct_count / (m.correct_count + m.wrong_count), 3
        ) if (m.correct_count + m.wrong_count) else None,
        "next_review_at": m.next_review_at.isoformat() if m.next_review_at else None,
        "due": bool(m.next_review_at and m.next_review_at <= now),
        "first_wrong_at": m.first_wrong_at.isoformat() if m.first_wrong_at else None,
    }


# ========== 复习队列 ==========

def review_queue(db: Session, user_id: int = 1, limit: int = 20) -> Dict:
    """今日复习队列

    分两组:
    - due: 到期该复习的错题 (next_review_at <= now)
    - weak: 到期该复习的知识点 (掌握度低)

    付费 App 常见做法是只给一个"今日 N 题"。这里分开给, 因为
    "重做旧错题" 和 "补薄弱知识点" 是两件事, 混在一起学生会不知道该干什么。
    """
    now = datetime.now()
    due_items = list_mistakes(db, user_id, only_due=True, limit=limit)
    weak = [
        m for m in list_mastery(db, user_id)
        if m["due"] and m["level"] <= 3
    ]
    weak.sort(key=lambda m: (m["level"], -m["wrong_count"]))
    total_due = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id,
        ResourceORM.type == "mistake",
        ResourceORM.mastered.is_(False),
        or_(
            ResourceORM.next_review_at.is_(None),
            ResourceORM.next_review_at <= now,
        ),
    ).count()
    return {
        "due_mistakes": due_items,
        "weak_points": weak[:limit],
        "counts": {
            "due_mistakes": total_due,
            "weak_points": len(weak),
            "mastered_mistakes": db.query(ResourceORM).filter(
                ResourceORM.user_id == user_id,
                ResourceORM.type == "mistake",
                ResourceORM.mastered.is_(True),
            ).count(),
            "total_mistakes": db.query(ResourceORM).filter(
                ResourceORM.user_id == user_id, ResourceORM.type == "mistake"
            ).count(),
        },
        "generated_at": now.isoformat(),
    }


# ========== 模考 ==========

def add_exam_score(
    db: Session,
    user_id: int,
    name: str,
    subject: str,
    score: float,
    total: Optional[float] = None,
    exam_date: Optional[str] = None,
    rank: Optional[int] = None,
    detail: Optional[List[Dict]] = None,
    note: str = "",
) -> Dict:
    """录入一次模考成绩, 并把失分归因到知识点 (拉低掌握度)"""
    now = datetime.now()
    d = None
    if exam_date:
        try:
            d = datetime.strptime(exam_date, "%Y-%m-%d").date()
        except ValueError:
            d = None
    item = ExamScoreORM(
        user_id=user_id,
        name=name[:128],
        subject=subject or None,
        exam_date=d or now.date(),
        score=score,
        total=total,
        rank=rank,
        detail=detail or [],
        note=note or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # 归因: 各题失分涉及的知识点, 掌握度下调
    updates = []
    for row in (detail or []):
        kp = (row.get("kp") or "").strip()
        if not kp:
            continue
        lost = float(row.get("lost") or 0)
        # 失分越多, 扣得越狠 (最多两级)
        times = 2 if lost >= 8 else (1 if lost > 0 else 0)
        for _ in range(times):
            u = _bump_mastery(db, user_id, kp, subject, answered_correct=False, now=now)
        updates.append(u)

    return {
        "success": True,
        "id": item.id,
        "name": item.name,
        "subject": item.subject,
        "score": item.score,
        "total": item.total,
        "mastery_updates": updates,
    }


def list_exams(db: Session, user_id: int = 1, subject: Optional[str] = None, limit: int = 20) -> List[Dict]:
    q = db.query(ExamScoreORM).filter(ExamScoreORM.user_id == user_id)
    if subject:
        q = q.filter(ExamScoreORM.subject == subject)
    rows = q.order_by(ExamScoreORM.exam_date.desc()).limit(max(1, min(limit, 200))).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "subject": r.subject,
            "exam_date": r.exam_date.isoformat() if r.exam_date else None,
            "score": r.score,
            "total": r.total,
            "rate": round(r.score / r.total, 3) if (r.total and r.score is not None) else None,
            "rank": r.rank,
            "detail": r.detail or [],
            "note": r.note,
        }
        for r in rows
    ]


def exam_trend(db: Session, user_id: int = 1, subject: Optional[str] = None) -> Dict:
    """成绩趋势 + 失分归因汇总

    「这次丢的 23 分丢在哪」—— 付费 App 里这块最弱, 这里做成结构化输出。
    """
    exams = list_exams(db, user_id, subject, limit=50)
    exams_asc = list(reversed(exams))
    lost_by_kp: Dict[str, Dict] = {}
    for e in exams:
        for row in (e.get("detail") or []):
            kp = (row.get("kp") or "").strip()
            if not kp:
                continue
            lost = float(row.get("lost") or 0)
            bucket = lost_by_kp.setdefault(
                kp, {"kp": kp, "lost": 0.0, "count": 0, "subjects": set()}
            )
            bucket["lost"] += lost
            bucket["count"] += 1
            if e.get("subject"):
                bucket["subjects"].add(e["subject"])
    top_lost = sorted(lost_by_kp.values(), key=lambda b: -b["lost"])[:10]
    for b in top_lost:
        b["subjects"] = list(b["subjects"])
    trend = [
        {"exam_date": e["exam_date"], "name": e["name"], "score": e["score"], "rate": e["rate"]}
        for e in exams_asc
    ]
    return {
        "exams": exams_asc,
        "trend": trend,
        "top_lost": top_lost,
        "count": len(exams),
    }


# ========== 总览统计 ==========

def learning_stats(db: Session, user_id: int = 1) -> Dict:
    """一页总览 —— 前端首页用"""
    now = datetime.now()
    total = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake"
    ).count()
    mastered = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake",
        ResourceORM.mastered.is_(True),
    ).count()
    due = db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake",
        ResourceORM.mastered.is_(False),
        or_(
            ResourceORM.next_review_at.is_(None),
            ResourceORM.next_review_at <= now,
        ),
    ).count()
    mastery_rows = list_mastery(db, user_id)
    by_level: Dict[str, int] = {}
    for m in mastery_rows:
        by_level[m["label"]] = by_level.get(m["label"], 0) + 1
    # 错因分布
    cause_dist: Dict[str, int] = {}
    for item in db.query(ResourceORM).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake"
    ).all():
        k = item.error_type or "未标注"
        cause_dist[k] = cause_dist.get(k, 0) + 1
    return {
        "total_mistakes": total,
        "mastered_mistakes": mastered,
        "due_mistakes": due,
        "total_knowledge_points": len(mastery_rows),
        "weak_knowledge_points": len([m for m in mastery_rows if m["level"] <= 2]),
        "mastery_distribution": by_level,
        "cause_distribution": {
            ERROR_TYPES.get(k, k): v for k, v in sorted(cause_dist.items(), key=lambda x: -x[1])
        },
        "exam_count": db.query(ExamScoreORM).filter(ExamScoreORM.user_id == user_id).count(),
    }
