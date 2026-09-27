"""上下文构建器 - 拼 LLM 要用的 messages
- RAG 检索 (user resources + KB)
- 历史消息 (memory)
- system prompt (scenario + profile + RAG context)
- user content (含可选图片)
"""
import logging
from typing import Dict, List, Optional

from app.core.config import settings
from app.agent.rag import rag_engine
from app.agent.prompts import build_system_prompt
from app.agent.memory.manager import MemoryManager
from app.agent.pipeline.preprocessor import build_user_content

logger = logging.getLogger(__name__)


def _resolve_toggle(caller_value, settings_attr: str) -> bool:
    if caller_value is not None:
        return caller_value
    return getattr(settings, settings_attr, False)


def _summarize_rag(user_resources: list, kb_results: list) -> Dict:
    """生成 RAG 用量摘要 (返回给前端)"""
    return {
        "user_resources": [
            {
                "code": r["metadata"].get("code", ""),
                "title": r["metadata"].get("title", ""),
                "type": r["metadata"].get("type", "material"),
                "score": r.get("score", 0),
                "has_file": bool(r["metadata"].get("file_path")),
            }
            for r in user_resources
        ],
        "kb_results": [
            {"title": r["title"], "type": r["type"], "score": r.get("score", 0)}
            for r in kb_results
        ],
    }


# ===== v2.0: profile 衍生指令注入 =====
def _build_profile_injection(user_profile: dict) -> str:
    """根据 user profile 拼一段额外指令, 追加到 system prompt 末尾.

    规则:
    - stage=='初中': 用初中方法, 不引入高中公式
    - language=='英文': 回复以英文为主
    - agent_name 非默认 ('张老师'): 改称谓
    - persona: 注入对应人格 prompt (teacher_zhang/xuejie/duanzishou)
    - 调用方负责 skip scenario='volunteer' (其 persona 已自带张雪峰风格)
    """
    if not user_profile:
        return ""

    blocks: list[str] = []

    stage = (user_profile.get("stage") or "").strip()
    if stage == "初中":
        blocks.append(
            "用户是初中生, 解题用初中方法, 不引入高中公式"
        )
    elif stage == "小学":
        blocks.append(
            "用户是小学生, 用最简单的方式讲, 不要用超过小学范围的术语"
        )
    elif stage == "大学":
        blocks.append(
            "用户是大学生, 可以聊专业方向 / 考研 / 实习 / 就业"
        )
    elif stage == "考研":
        blocks.append(
            "用户在备考研究生, 重点聊考研复习 / 院校选择 / 学术方向"
        )
    elif stage == "在职":
        blocks.append(
            "用户已经在工作, 重点聊职业发展 / 跳槽 / 转行 / 技能提升"
        )

    language = (user_profile.get("language") or "").strip()
    if language == "英文":
        blocks.append("回复以英文为主 (除非用户主动切回中文)")
    elif language == "双语":
        blocks.append("中英双语都可以, 根据用户语言自然切换")

    agent_name = (user_profile.get("agent_name") or "").strip()
    if agent_name and agent_name != "张老师":
        blocks.append(
            f"你叫 {agent_name}, 不要自称'张老师'或'老张'等默认称呼"
        )

    # v0.1.7: persona 注入 (实际生效人格到 system prompt)
    persona = (user_profile.get("persona") or "teacher_zhang").strip()
    if persona == "xuejie":
        blocks.append(
            "## 人格: 学姐风格\n"
            "- 语气温和亲切, 像过来人分享经验\n"
            "- 多用'我当年''我当时'等第一人称代入\n"
            "- 给建议时常加'你试试''我建议你'等温和措辞\n"
            "- 不端架子, 鼓励学生提问"
        )
    elif persona == "duanzishou":
        blocks.append(
            "## 人格: 段子手风格\n"
            "- 幽默轻松, 偶尔抛梗, 但不油腻\n"
            "- 知识点讲完会加个梗或冷笑话辅助记忆\n"
            "- 但严肃问题 (志愿/考试) 别抖机灵, 该正经正经"
        )
    # teacher_zhang 不需要注入 (scenario prompt 已自带)

    if not blocks:
        return ""
    return "# Profile-driven adaptation (v2.0)\n" + "\n".join(f"- {b}" for b in blocks)


async def build_messages(
    user_message: str,
    scenario: str,
    user_id: int,
    memory: MemoryManager,
    conversation_id: Optional[int] = None,
    web_search_enabled: Optional[bool] = None,
    deep_thinking_enabled: Optional[bool] = None,
    include_image: bool = False,
    tracer = None,  # v0.1: RAG tracer
) -> Dict:
    """拼装完整 messages + RAG 摘要
    Returns: {
        "messages": [...],
        "rag_summary": {...},
        "user_resources": [...],
        "kb_results": [...],
        "rag_trace": {...}  # v0.1
    }
    """
    # 1) 拉历史 + profile + 长期事实
    # v0.9.9: 短期记忆 (last 6 条原文) + 长期事实 (高密度)
    history = memory.get_conversation_history(conversation_id, limit=6) if conversation_id else []
    user_profile = memory.get_user_profile(user_id)
    user_facts = memory.get_user_facts(user_id, limit=30)  # v0.9.9 长期事实

    if tracer:
        tracer.add_stage("memory_load", f"user_id={user_id}",
            f"history={len(history)} msgs, facts={len(user_facts)}",
            {"history_count": len(history), "facts_count": len(user_facts)})

    # 2) RAG (with tracer)
    if tracer:
        tracer.add_stage("init", f"user_id={user_id}, scenario={scenario}",
            "starting RAG pipeline", {"user_id": user_id, "scenario": scenario})
    user_resources = rag_engine.search_user_resources(user_message, user_id, top_k=3, tracer=tracer)
    kb_results = rag_engine.search_knowledge_base(user_message, top_k=5, tracer=tracer)
    rag_context = rag_engine.build_context(user_resources, kb_results, tracer=tracer)
    rag_summary = _summarize_rag(user_resources, kb_results)
    if tracer:
        tracer.finish({
            "user_resources_count": len(user_resources),
            "kb_results_count": len(kb_results),
            "rag_context_chars": len(rag_context),
            "history_count": len(history),
            "facts_count": len(user_facts),
        })

    # 3) 解析 toggle
    ws_on = _resolve_toggle(web_search_enabled, "WEB_SEARCH_ENABLED")
    dt_on = _resolve_toggle(deep_thinking_enabled, "DEEP_THINKING_ENABLED")

    # 4) System prompt
    system_prompt = build_system_prompt(
        scenario, user_profile, rag_context,
        web_search_enabled=ws_on, deep_thinking_enabled=dt_on,
    )

    # v2.0: profile 衍生指令注入 (末尾追加)
    # 注意: 报志愿场景 (scenario='volunteer') 已自带"张雪峰"风格 persona, **不要覆盖**
    if scenario != "volunteer" and user_profile:
        profile_injection = _build_profile_injection(user_profile)
        if profile_injection:
            system_prompt = system_prompt + "\n\n" + profile_injection

    # v0.9.9: 在 system prompt 顶部塞长期事实 (人脑长期记忆类比)
    if user_facts:
        from app.agent.memory.fact_extractor import format_facts_for_prompt
        facts_block = format_facts_for_prompt(user_facts)
        system_prompt = facts_block + "\n\n" + system_prompt

    # 5) 拼 messages
    messages: List[Dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(history)

    # 6) user content (含图片或图片描述)
    # v0.8.0: 默认 include_image=False, 统一用 vision_client 转文字
    #   因为中档/高档 primary (GLM 5.2, Grok 4.20) 都不支持 vision
    #   (实测 OpenRouter 上 z-ai/glm-5.2, x-ai/grok-4.20-multi-agent 返回 404 image)
    #   只有 minimax/minimax-m3 (low 档) 支持多模态
    #   统一走文字描述, 确保全档位都能处理带图消息
    top_resource = user_resources[0] if user_resources else None
    user_content = await build_user_content(
        user_message, top_resource, include_image=include_image,
    )
    messages.append(user_content)

    return {
        "messages": messages,
        "rag_summary": rag_summary,
        "user_resources": user_resources,
        "kb_results": kb_results,
        "ws_on": ws_on,
        "dt_on": dt_on,
        "rag_trace": tracer.to_dict() if tracer else None,  # v0.1
    }
