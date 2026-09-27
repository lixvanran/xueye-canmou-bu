"""build_system_prompt - 拼装 base + scenario + 用户画像 + RAG context
v0.7.5 模块化后的入口, 其他文件 import 这个
v0.1.7: 加 persona 参数, 根据 persona 选 base prompt
"""
from app.core.config import settings
from app.agent.prompts.style import (
    BASE_PERSONA,
    get_base_persona,
    WEB_SEARCH_INSTRUCTION_ON, WEB_SEARCH_INSTRUCTION_OFF,
    DEEP_THINKING_INSTRUCTION_ON, DEEP_THINKING_INSTRUCTION_OFF,
    STAGE_ADAPTATION,
)
from app.agent.prompts.scenarios import SCENARIO_PROMPTS


def _resolve_toggle(caller_value, settings_attr: str) -> bool:
    """判断开关：caller 显式传值优先, 否则读 settings"""
    if caller_value is not None:
        return caller_value
    return getattr(settings, settings_attr, False)


def _resolve_web_instruction(ws_on: bool) -> str:
    """拼装 web search 指令"""
    return WEB_SEARCH_INSTRUCTION_ON if ws_on else WEB_SEARCH_INSTRUCTION_OFF


def _resolve_deep_instruction(dt_on: bool) -> str:
    return DEEP_THINKING_INSTRUCTION_ON if dt_on else DEEP_THINKING_INSTRUCTION_OFF


def _render_base(web_search_enabled: bool, deep_thinking_enabled: bool, persona: str = "teacher_zhang") -> str:
    """v0.1.7: 渲染 base persona, 按 persona 选不同模板, 注入时间 + toggle 指令"""
    from app.agent.prompts.style import _current_time_block
    base = get_base_persona(persona).replace("{current_date}", _current_time_block())
    web_inst = _resolve_web_instruction(web_search_enabled)
    deep_inst = _resolve_deep_instruction(deep_thinking_enabled) if deep_thinking_enabled else ""
    combined_inst = web_inst + ("\n" + deep_inst if deep_inst else "")
    base = base.replace("{web_search_instruction}", combined_inst)
    return base


def _render_persona_reminder(persona: str) -> str:
    """v0.1.7 [P0] 修复: 当 persona 不是 teacher_zhang 时, 在 prompt 末尾追加 persona 提醒,
    因为 scenario prompts 大量写死'张老师'风格, LLM 会自然 follow scenario 主导.
    - teacher_zhang: 不需要 (scenario 默认就是张老师)
    - xuejie: 提醒'你是学姐, 不是张老师, 用学姐风格回答'
    - duanzishou: 提醒'你是段子手, 用幽默轻松的风格'
    """
    if persona == "teacher_zhang":
        return ""
    reminders = {
        "xuejie": (
            "# ⚠️ Persona 提醒 (v0.1.7)\n"
            "虽然 scenario 文字里常出现'张老师'字样, 但你现在的 persona 是 **学姐**, 不是张老师.\n"
            "- 用'我当年'/'我跟你讲'/'我建议你'等过来人语气\n"
            "- 称呼用'学弟/学妹/同学', 不要用'兄弟/孩子/家长'\n"
            "- 不要用张老师的'老实说''你别不信'那种'过来人训话'语气\n"
            "- 鼓励分享自己的失败/踩坑, 让用户放松"
        ),
        "duanzishou": (
            "# ⚠️ Persona 提醒 (v0.1.7)\n"
            "虽然 scenario 文字里常出现'张老师'字样, 但你现在的 persona 是 **段子手**.\n"
            "- 开口就有梗, 一个例子一个笑话一段正经话\n"
            "- 称呼用'兄弟/朋友/老铁', 不要用'学弟/家长'\n"
            "- 不要用张老师的'老实说''你别不信'那种直给语气\n"
            "- **严肃问题**(心理危机/重大决策/真正难过的事) 严肃对待, 不开玩笑"
        ),
    }
    return reminders.get(persona, "")


def _render_user_profile(user_profile: dict) -> tuple[str, str | None]:
    """渲染 user profile + stage 适配"""
    if not user_profile:
        return "", None
    edu = user_profile.get("education_stage", "")
    name = user_profile.get("name", "同学")
    bg = user_profile.get("background", "")
    profile_block = f"""
# User profile
- Name: {name}
- Stage: {edu}
- Province: {user_profile.get('province') or 'unspecified'}
- Score: {user_profile.get('score') or 'unspecified'}
- Rank: {user_profile.get('rank') or 'unspecified'}
- Target: {user_profile.get('target') or 'unspecified'}
- Interests: {user_profile.get('interests') or 'unspecified'}
- Background: {bg or 'unspecified'}
"""
    stage_inst = STAGE_ADAPTATION.get(edu) if edu else None
    return profile_block, stage_inst


def _render_rag(rag_context: str | None) -> str:
    if not rag_context:
        return ""
    return f"""
# Retrieved context (use this!)
The following is relevant information from the user's uploaded resources and the knowledge base.
YOU MUST reference this when answering:
{rag_context}
"""


def build_system_prompt(
    scenario: str = "chat",
    user_profile: dict = None,
    rag_context: str = None,
    web_search_enabled: bool = None,
    deep_thinking_enabled: bool = None,
    persona: str = "teacher_zhang",
) -> str:
    """拼装 system prompt - 顺序：base → scenario → profile+stage → RAG context → persona_reminder
    v0.1.7: 加 persona 参数, 默认 teacher_zhang (向后兼容)
    v0.1.7 [P0] 修复: 末尾加 persona reminder, 防止 scenario 文字里的'张老师'主导
    """
    ws_on = _resolve_toggle(web_search_enabled, "WEB_SEARCH_ENABLED")
    dt_on = _resolve_toggle(deep_thinking_enabled, "DEEP_THINKING_ENABLED")

    parts = [_render_base(ws_on, dt_on, persona)]
    parts.append(SCENARIO_PROMPTS.get(scenario, SCENARIO_PROMPTS["chat"]))

    profile_block, stage_inst = _render_user_profile(user_profile)
    if profile_block:
        parts.append(profile_block)
    if stage_inst:
        parts.append(stage_inst)

    rag_block = _render_rag(rag_context)
    if rag_block:
        parts.append(rag_block)

    persona_reminder = _render_persona_reminder(persona)
    if persona_reminder:
        parts.append(persona_reminder)

    return "\n\n".join(parts)
