"""Nuwa Skill 框架 API - v2.0 预留接入

注意: 本路由**只 read**, 不实际调用 skill 执行. 真正的 skill 调用留给后续 v2.x.
当前用途: 让前端能列出本地 ~/.nuwa/skills/* 下的 SKILL.md, 给用户看 "能加载哪些 skill"
"""
from fastapi import APIRouter, HTTPException
from typing import Optional
import logging

from app.agent.tools.nuwa_skill import list_skills, load_skill, warmup_log

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/nuwa-skill", tags=["Nuwa Skill"])


@router.get("/list")
async def list_skills_api():
    """扫 ~/.nuwa/skills/*/SKILL.md, 返回 [{name, description, path}, ...]
    找不到 nuwa 路径就返回空 list (前端显示 '暂未加载 skill')
    """
    skills = list_skills()
    return {
        "total": len(skills),
        "items": skills,
        "framework_status": "ready",
    }


@router.get("/load/{skill_name}")
async def load_skill_api(skill_name: str):
    """读某个 skill 的 frontmatter + body 前 200 字.
    找不到 → 404
    """
    skill = load_skill(skill_name)
    if not skill:
        raise HTTPException(404, f"找不到 skill: {skill_name}")
    return skill


@router.post("/warmup")
async def warmup_api():
    """手动触发 warmup log. 返回当前加载数量. 用于 health 端点."""
    count = warmup_log()
    return {"loaded_count": count, "framework_status": "ready"}