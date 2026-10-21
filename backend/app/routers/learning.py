"""学习主线 API — 错题本 / 复习 / 掌握度 / 模考 (v1.3.0)

路由前缀: /api/mistakes, /api/review, /api/mastery, /api/exams, /api/learning
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.learning import service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["学习主线"])


# ========== 请求体 ==========

class MistakeCreate(BaseModel):
    subject: str = Field(..., description="科目, 如 数学/物理/化学/英语/语文")
    title: str = Field(..., description="题目摘要(一行)")
    content: str = Field("", description="题目原文")
    my_answer: str = Field("", description="我当时的答案")
    correct_answer: str = Field("", description="正确答案")
    cause: str = Field("", description="错因: concept/calculation/method/unfamiliar/careless/time")
    knowledge_tags: List[str] = Field(default_factory=list, description="知识点标签")
    file_path: str = Field("", description="题目图片路径")
    difficulty: int = Field(3, ge=1, le=5)


class MistakeReview(BaseModel):
    answered_correct: bool = Field(..., description="这次复习答对了没")
    note: str = Field("", description="复习笔记")


class ExamCreate(BaseModel):
    name: str = Field(..., description="考试名, 如 高一上期中")
    subject: str = Field(..., description="科目")
    score: float = Field(..., description="得分")
    total: Optional[float] = Field(None, description="满分")
    exam_date: Optional[str] = Field(None, description="YYYY-MM-DD")
    rank: Optional[int] = None
    detail: List[Dict[str, Any]] = Field(
        default_factory=list,
        description='各题失分明细, 如 [{"q":"第3题","kp":"二次函数","lost":8,"total":12,"why":"计算错误"}]',
    )
    note: str = ""


# ========== 错题本 ==========

@router.get("/api/mistakes")
def list_mistakes(
    subject: Optional[str] = Query(None),
    only_due: bool = Query(False, description="只返回今天该复习的"),
    only_unmastered: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """列错题本"""
    items = service.list_mistakes(
        db, user_id=user_id, subject=subject,
        only_due=only_due, only_unmastered=only_unmastered, limit=limit,
    )
    return {"items": items, "count": len(items)}


@router.post("/api/mistakes")
def create_mistake(
    payload: MistakeCreate,
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """录入一道错题 (同时更新相关知识点掌握度)"""
    if not payload.title.strip():
        raise HTTPException(400, "title 不能为空")
    res = service.create_mistake(
        db,
        user_id=user_id,
        subject=payload.subject,
        title=payload.title.strip(),
        content=payload.content,
        my_answer=payload.my_answer,
        correct_answer=payload.correct_answer,
        cause=payload.cause,
        knowledge_tags=payload.knowledge_tags,
        file_path=payload.file_path,
        difficulty=payload.difficulty,
    )
    return res


@router.get("/api/mistakes/{mistake_id}")
def get_mistake(mistake_id: int, user_id: int = Query(1), db: Session = Depends(get_db)):
    item = service.get_mistake(db, user_id, mistake_id)
    if not item:
        raise HTTPException(404, f"找不到错题 id={mistake_id}")
    return item


@router.post("/api/mistakes/{mistake_id}/review")
def review_mistake(
    mistake_id: int,
    payload: MistakeReview,
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """复习一道错题 ⇒ 错题 SRS 状态 + 知识点掌握度同时更新"""
    res = service.review_mistake(
        db, user_id, mistake_id, payload.answered_correct, payload.note
    )
    if not res.get("success"):
        raise HTTPException(404, res.get("error", "复习失败"))
    return res


@router.delete("/api/mistakes/{mistake_id}")
def delete_mistake(mistake_id: int, user_id: int = Query(1), db: Session = Depends(get_db)):
    res = service.delete_mistake(db, user_id, mistake_id)
    if not res.get("success"):
        raise HTTPException(404, res.get("error", "删除失败"))
    return res


# ========== 复习 ==========

@router.get("/api/review/queue")
def review_queue(
    limit: int = Query(20, ge=1, le=100),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """今日复习队列 —— 错题 + 薄弱知识点, 分开给"""
    return service.review_queue(db, user_id=user_id, limit=limit)


@router.get("/api/review/flashcards")
def flashcards(
    subject: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=200),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """闪卡 —— 来自知识点库, 按掌握度排序(越不熟越靠前)"""
    from app.learning.knowledge import list_flashcards

    return list_flashcards(db, user_id=user_id, subject=subject, limit=limit)


# ========== 掌握度 ==========

@router.get("/api/mastery")
def mastery(
    subject: Optional[str] = Query(None),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """全部知识点掌握度"""
    items = service.list_mastery(db, user_id, subject)
    return {"items": items, "count": len(items)}


@router.get("/api/mastery/weak")
def mastery_weak(
    subject: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """薄弱知识点"""
    items = service.weak_points(db, user_id, subject, limit)
    return {"items": items, "count": len(items)}


# ========== 模考 ==========

@router.get("/api/exams")
def list_exams(
    subject: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=200),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    items = service.list_exams(db, user_id, subject, limit)
    return {"items": items, "count": len(items)}


@router.post("/api/exams")
def create_exam(
    payload: ExamCreate,
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """录入模考成绩 (自动归因失分到知识点)"""
    return service.add_exam_score(
        db,
        user_id=user_id,
        name=payload.name,
        subject=payload.subject,
        score=payload.score,
        total=payload.total,
        exam_date=payload.exam_date,
        rank=payload.rank,
        detail=payload.detail,
        note=payload.note,
    )


@router.get("/api/exams/trend")
def exam_trend(
    subject: Optional[str] = Query(None),
    user_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """成绩趋势 + 失分归因"""
    return service.exam_trend(db, user_id, subject)


# ========== 总览 ==========

@router.get("/api/learning/stats")
def learning_stats(user_id: int = Query(1), db: Session = Depends(get_db)):
    """学习主线总览"""
    return service.learning_stats(db, user_id)
