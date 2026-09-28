"""
v0.1.7+ 并行 Agent 团队 API
"""
from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse
from typing import Optional
import logging

from app.agent.orchestrator_team import process_team_stream

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent/team", tags=["Agent 团队"])


@router.post("")
async def team_chat(
    message: str = Body(..., embed=True),
    personas: list[str] = Body(..., embed=True),
    scenario: str = Body("chat", embed=True),
    user_id: int = Body(1, embed=True),
    synth_persona: Optional[str] = Body(None, embed=True),
):
    """v0.1.7+ 并行 Agent 团队 — SSE 流式

    Body:
        message: str  ← 用户问题
        personas: list[str]  ← sub-agent 用的 persona 列表 (2-5 个)
        scenario: str  ← chat / exam / volunteer / chitchat
        user_id: int
        synth_persona: str  ← synthesizer 用的 persona (默认 = user 当前 persona)

    Yield (跟单 agent trace 一致的事件格式):
        [TEAM_START] / [SUB_START] / [SUB_DONE] / [SYNTH_START] / [SYNTH_CHUNK] / [SYNTH_DONE] / [TEAM_END]
    """
    if not personas or len(personas) < 1:
        from fastapi import HTTPException
        raise HTTPException(400, "personas 至少 1 个")
    if len(personas) > 6:
        from fastapi import HTTPException
        raise HTTPException(400, "personas 最多 6 个 (避免配额爆炸)")

    async def generate():
        async for chunk in process_team_stream(
            message=message,
            personas=personas,
            scenario=scenario,
            user_id=user_id,
            synth_persona=synth_persona,
        ):
            # 拼 SSE 格式 (data: xxx\n\n)
            import json as _json
            # orchestrator_team 输出的是 [EVENT]{json}[/EVENT]\n\n 格式
            # 改成标准 SSE: data: [EVENT]{json}[/EVENT]\n\n
            yield f"data: {chunk}"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )