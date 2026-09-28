"""
v0.1.7+ 并行 Agent 团队 (Multi-Agent Parallel)

架构:
  用户输入 → coordinator
       ↓ asyncio.gather([
         sub-agent-1 (persona=teacher_zhang) ─→ output-1
         sub-agent-2 (persona=musk)         ─→ output-2
         ...
       ])
       ↓
  synthesizer (把 N 个 sub 输出综合, persona=teacher_zhang 主答)

流式事件 (SSE):
  [TEAM_START] {team_id, total_personas, scenario, started_at}
  [SUB_START]  {sub_id, persona, model, started_at}
  [SUB_CHUNK]  {sub_id, content}            ← 增量
  [SUB_DONE]   {sub_id, latency_ms, content_length, reasoning_length, model_used}
  ... (N 次 SUB_*, 可能交错, 因并行)
  [SYNTH_START] {model}
  [SYNTH_CHUNK] {content}
  [SYNTH_DONE]  {latency_ms, content_length, model_used}
  [TEAM_END]   {total_latency_ms, subs: [{persona, latency_ms, model, length}]}

设计原则:
- 复用现有 build_messages + run_llm_with_tools (不走 routing 简化逻辑)
- sub-agent 上下文: 共享 history + RAG + profile, 但 base prompt 用各自的 persona
- synthesizer base prompt: "你是 [user 当前 persona], 下面是 N 个视角的分析, 综合给出最终建议"
- 失败容错: 任何一个 sub 失败不影响其他, synthesizer 会标 "视角 X 未完成"
"""
import asyncio
import json
import logging
import time
import uuid
from typing import AsyncGenerator, List, Dict, Optional

from app.agent.prompts.style import get_base_persona, PERSONA_TEMPLATES, _PERSONA_COMMON
from app.agent.prompts.builder import build_system_prompt
from app.agent.pipeline.context_builder import build_messages as build_ctx
from app.agent.pipeline.llm_runner import run_llm_with_tools
from app.services.conversation_service import get_memory

logger = logging.getLogger(__name__)


async def _run_single_sub_agent(
    sub_id: str,
    persona: str,
    user_message: str,
    scenario: str,
    user_id: int,
    shared_ctx: Dict,
) -> Dict:
    """跑 1 个 sub-agent (同步), 返回 {persona, content, reasoning, model_used, latency_ms, error}

    - 用 persona 自己的 base prompt
    - 共享 RAG / profile (来自 shared_ctx), 但不共享历史消息 (避免互相串台)
    - 不持久化 (持久化交给 synthesizer)
    """
    import time as _time
    t0 = _time.time()
    try:
        # 1. 拼 system prompt (用 persona)
        persona_p = persona if persona in PERSONA_TEMPLATES else "teacher_zhang"
        # 重建 system prompt (复用 build_messages 的 ctx 结构)
        system_prompt = build_system_prompt(
            scenario=scenario,
            user_profile=shared_ctx.get("user_profile"),
            rag_context=shared_ctx.get("rag_context"),
            web_search_enabled=shared_ctx.get("ws_on"),
            deep_thinking_enabled=shared_ctx.get("dt_on"),
            persona=persona_p,
        )
        # 2. 拼 messages: system + user message (无 history, 避免与 synth 重复)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        # 3. 跑 LLM (medium tier, sub-agent 不需要 deep_thinking 节省配额)
        from app.core.config import settings
        result = await run_llm_with_tools(
            messages,
            deep_thinking=False,
            primary_model=settings.LLM_MODEL,
            fallback_models=[],  # sub-agent 用主模型即可
        )
        latency_ms = round((_time.time() - t0) * 1000, 2)
        return {
            "sub_id": sub_id,
            "persona": persona_p,
            "content": result.get("content") or "",
            "reasoning": result.get("reasoning") or "",
            "model_used": result.get("model_used", settings.LLM_MODEL),
            "latency_ms": latency_ms,
            "error": None,
        }
    except Exception as e:
        latency_ms = round((_time.time() - t0) * 1000, 2)
        logger.error(f"sub-agent {sub_id} (persona={persona}) failed: {e}")
        return {
            "sub_id": sub_id,
            "persona": persona,
            "content": "",
            "reasoning": "",
            "model_used": "",
            "latency_ms": latency_ms,
            "error": str(e)[:200],
        }


async def process_team_stream(
    message: str,
    personas: List[str],
    scenario: str = "chat",
    user_id: int = 1,
    synth_persona: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """v0.1.7+ 并行 Agent 团队 — 流式

    Args:
        message: 用户问题
        personas: sub-agent 用的 persona 列表 (前端 multi-select)
        scenario: chat / exam / volunteer / chitchat
        user_id: 用户 id
        synth_persona: synthesizer 用的 persona, 默认 = user 当前 persona (teacher_zhang)

    Yield SSE 事件 (json in [EVENT]{...}[/EVENT] 格式, 跟 v0.1.7 trace 一致)
    """
    import time as _time
    if not personas:
        yield f"[ERROR]{json.dumps({'error': 'personas 不能为空'}, ensure_ascii=False)}[/ERROR]\n\n"
        return

    team_id = uuid.uuid4().hex[:12]
    started_at = _time.time()
    logger.info(f"[team {team_id}] start: {len(personas)} sub-agents, scenario={scenario}")

    # TEAM_START
    yield f"[TEAM_START]{json.dumps({'team_id': team_id, 'total_personas': len(personas), 'personas': personas, 'scenario': scenario, 'started_at': started_at, 'user_message': message[:200]}, ensure_ascii=False)}[/TEAM_START]\n\n"

    # 1) 共享 context: build profile / RAG / 长期事实 (只跑一次, 给所有 sub 复用)
    t0 = _time.time()
    try:
        ctx = await build_ctx(
            message, scenario, user_id, get_memory_manager(),
            conversation_id=None,  # sub-agent 不创建对话
            tracer=None,
        )
        shared_ctx = {
            "user_profile": ctx.get("user_profile"),
            "rag_context": ctx.get("rag_context"),
            "ws_on": ctx.get("ws_on"),
            "dt_on": False,  # sub-agent 不用 deep_thinking (节省配额)
        }
    except Exception as e:
        logger.error(f"[team {team_id}] shared ctx build failed: {e}")
        shared_ctx = {"user_profile": None, "rag_context": None, "ws_on": None, "dt_on": False}

    # 2) 并行 N 个 sub-agent
    # 队列: 每个 sub 完成后, yield SUB_DONE 事件
    sub_tasks = [
        _run_single_sub_agent(
            sub_id=f"sub_{i+1}_{p[:6]}",
            persona=p,
            user_message=message,
            scenario=scenario,
            user_id=user_id,
            shared_ctx=shared_ctx,
        )
        for i, p in enumerate(personas)
    ]
    # 启动时 yield SUB_START (前端可显示 "N 个视角同时跑")
    sub_start_msgs = []
    for i, p in enumerate(personas):
        sub_start_msgs.append(
            f"[SUB_START]{json.dumps({'sub_id': f'sub_{i+1}_{p[:6]}', 'persona': p, 'started_at': _time.time()}, ensure_ascii=False)}[/SUB_START]\n\n"
        )
    for m in sub_start_msgs:
        yield m

    # asyncio.gather 一起跑, 等全部完成
    sub_results = await asyncio.gather(*sub_tasks, return_exceptions=True)

    # 处理结果: yield SUB_DONE (可能交错)
    for r in sub_results:
        if isinstance(r, Exception):
            logger.error(f"[team {team_id}] sub exception: {r}")
            continue
        yield f"[SUB_DONE]{json.dumps({'sub_id': r['sub_id'], 'persona': r['persona'], 'latency_ms': r['latency_ms'], 'content_length': len(r['content']), 'reasoning_length': len(r['reasoning'] or ''), 'model_used': r['model_used'], 'error': r['error']}, ensure_ascii=False)}[/SUB_DONE]\n\n"

    # 3) Synthesizer: 把 N 个 sub 输出综合成最终答案 (流式)
    # 拼合成 prompt
    sub_summary_lines = []
    for r in sub_results:
        if isinstance(r, Exception) or r.get('error'):
            sub_summary_lines.append(f"### 视角 {r['persona']} (失败: {r.get('error') or 'exception'})")
        else:
            content = r['content'] or '(无输出)'
            # 截断避免 prompt 过长
            if len(content) > 1500:
                content = content[:1500] + "...(省略)"
            sub_summary_lines.append(f"### 视角 {r['persona']} ({len(r['content'])} 字, 耗时 {r['latency_ms']}ms)\n{content}")
    sub_summary = "\n\n".join(sub_summary_lines)

    synth_user_msg = (
        f"用户问题: {message}\n\n"
        f"以下是从 {len(personas)} 个不同视角的分析:\n\n{sub_summary}\n\n"
        f"---\n\n"
        f"请综合这些视角, 给出最终的、结构清晰的回答. "
        f"标注哪些视角有共识, 哪些有分歧, 哪些是你(综合方)独有的洞察. "
        f"不要重复每个视角的完整内容, 直接给综合建议."
    )

    # synthesizer system prompt 用 synth_persona (默认 = user 当前 persona)
    synth_p = synth_persona or "teacher_zhang"
    synth_system_prompt = build_system_prompt(
        scenario=scenario,
        user_profile=shared_ctx.get("user_profile"),
        rag_context=shared_ctx.get("rag_context"),
        web_search_enabled=shared_ctx.get("ws_on"),
        deep_thinking_enabled=False,  # synthesizer 也不深推
        persona=synth_p,
    )

    yield f"[SYNTH_START]{json.dumps({'persona': synth_p, 'started_at': _time.time()}, ensure_ascii=False)}[/SYNTH_START]\n\n"

    # synthesizer 也用 run_llm_with_tools (流式)
    # v0.1.7: 我先做非流式, 等接 streaming LLM call 之后再做真流式
    # 这里简化: 一次性返回 SYNTH_CHUNK + SYNTH_DONE
    t_synth = _time.time()
    try:
        from app.core.config import settings
        synth_msgs = [
            {"role": "system", "content": synth_system_prompt},
            {"role": "user", "content": synth_user_msg},
        ]
        synth_result = await run_llm_with_tools(
            synth_msgs,
            deep_thinking=False,
            primary_model=settings.LLM_MODEL,
            fallback_models=[],
        )
        synth_content = synth_result.get("content") or ""
        synth_model = synth_result.get("model_used", settings.LLM_MODEL)
        synth_latency_ms = round((_time.time() - t_synth) * 1000, 2)
        # chunk 输出 (按 80 字一段, 让前端能流式更新)
        chunk_size = 80
        for i in range(0, len(synth_content), chunk_size):
            chunk = synth_content[i:i+chunk_size]
            yield f"[SYNTH_CHUNK]{json.dumps({'content': chunk}, ensure_ascii=False)}[/SYNTH_CHUNK]\n\n"
        yield f"[SYNTH_DONE]{json.dumps({'latency_ms': synth_latency_ms, 'content_length': len(synth_content), 'model_used': synth_model, 'persona': synth_p}, ensure_ascii=False)}[/SYNTH_DONE]\n\n"
    except Exception as e:
        logger.error(f"[team {team_id}] synthesizer failed: {e}")
        yield f"[SYNTH_DONE]{json.dumps({'latency_ms': round((_time.time() - t_synth) * 1000, 2), 'error': str(e)[:200]}, ensure_ascii=False)}[/SYNTH_DONE]\n\n"

    # 4) TEAM_END
    total_latency_ms = round((_time.time() - started_at) * 1000, 2)
    subs_summary = []
    for r in sub_results:
        if isinstance(r, Exception):
            continue
        subs_summary.append({
            "sub_id": r["sub_id"],
            "persona": r["persona"],
            "latency_ms": r["latency_ms"],
            "content_length": len(r["content"]),
            "model_used": r["model_used"],
            "error": r["error"],
        })
    yield f"[TEAM_END]{json.dumps({'team_id': team_id, 'total_latency_ms': total_latency_ms, 'subs': subs_summary}, ensure_ascii=False)}[/TEAM_END]\n\n"
    logger.info(f"[team {team_id}] done in {total_latency_ms}ms")