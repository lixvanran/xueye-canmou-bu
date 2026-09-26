"""日程/学习计划 API - v2.0 新增
- GET    /api/schedule/list       - 列表 (按日期范围或类型)
- POST   /api/schedule/create     - 新建
- POST   /api/schedule/update     - 更新 (id + 任意字段)
- POST   /api/schedule/delete     - 删除
- POST   /api/schedule/suggest    - LLM 生成 N 天计划草稿 (不直接入库)
- POST   /api/schedule/toggle     - 快捷勾选完成/未完成
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Tuple

from app.agent.tools.schedule import (
    create_schedule, delete_schedule, list_schedule,
    update_schedule, suggest_schedule,
)

router = APIRouter(prefix="/api/schedule", tags=["日程"])


# ===== Schemas =====
class CreateScheduleRequest(BaseModel):
    date: str = Field(..., description="YYYY-MM-DD")
    content: str = Field(..., min_length=1, max_length=256)
    type: str = "study"
    note: Optional[str] = ""
    resource_id: Optional[int] = None
    user_id: int = 1


class UpdateScheduleRequest(BaseModel):
    id: int
    date: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None
    note: Optional[str] = None
    completed: Optional[bool] = None
    user_id: int = 1


class DeleteScheduleRequest(BaseModel):
    id: int
    user_id: int = 1


class SuggestRequest(BaseModel):
    goal: str = Field(..., min_length=1)
    days: int = 7
    start_date: Optional[str] = None


class ToggleRequest(BaseModel):
    id: int
    completed: bool
    user_id: int = 1


# ===== Routes =====
@router.get("/list")
async def list_schedule_api(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    type: Optional[str] = None,
    include_completed: bool = True,
    user_id: int = 1,
    limit: int = 100,
):
    """列表日程. start_date / end_date 都用 YYYY-MM-DD."""
    date_range: Optional[Tuple[str, str]] = None
    if start_date or end_date:
        date_range = (start_date or "", end_date or "")
    items = await list_schedule(
        date_range=date_range,
        type=type,
        include_completed=include_completed,
        user_id=user_id,
        limit=limit,
    )
    return {"total": len(items), "items": items}


@router.post("/create")
async def create_schedule_api(req: CreateScheduleRequest):
    return await create_schedule(
        date=req.date,
        content=req.content,
        type=req.type,
        note=req.note or "",
        resource_id=req.resource_id,
        user_id=req.user_id,
    )


@router.post("/update")
async def update_schedule_api(req: UpdateScheduleRequest):
    return await update_schedule(
        id=req.id,
        date=req.date,
        content=req.content,
        type=req.type,
        note=req.note,
        completed=req.completed,
        user_id=req.user_id,
    )


@router.post("/delete")
async def delete_schedule_api(req: DeleteScheduleRequest):
    return await delete_schedule(id=req.id, user_id=req.user_id)


@router.post("/toggle")
async def toggle_schedule_api(req: ToggleRequest):
    return await update_schedule(id=req.id, completed=req.completed, user_id=req.user_id)


@router.post("/suggest")
async def suggest_schedule_api(req: SuggestRequest):
    """LLM 自动生成 N 天计划草稿. 不入库, 让用户确认后再 create_schedule."""
    items = await suggest_schedule(goal=req.goal, days=req.days, start_date=req.start_date)
    return {"total": len(items), "items": items, "goal": req.goal}