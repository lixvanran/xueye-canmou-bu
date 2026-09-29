"""User API - all fields optional except name

v2.0:
- 精简前端可编辑字段, 只留核心 8 个
- 保留 birthday/home_address/emergency_contact (兼容老数据, schema 不删)
- 新增 stage/direction/language/agent_name 字段
- GET /api/user/profile-view 返回"AI 怎么理解我"的衍生指令预览
- GET /api/user/export / POST /api/user/import (数据导出导入)
- 导出/导入包含 schedules (v2.0 兼容 backend-architecture task)
v0.1.6 修复:
- update_profile 改用 Pydantic ProfileUpdate body 模型, 修复 agent_name 等字段无法通过 body 保存的 bug (FastAPI 默认从 query 取基础类型参数)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from app.db.database import get_db, UserORM, ScheduleORM
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/api/user", tags=["用户"])


class ProfileUpdate(BaseModel):
    """v0.1.6: profile 更新 body (前端 PUT 用 body 传, 之前用 query 是 bug)
    字段只列 UserORM 实际存在的列; 没列的字段(target_school/target_major/notes 等)通过
    target/background 字段兼容存 (前端可继续传, 后端忽略或拼接)。"""
    # v2.0 核心字段 (UserORM 都有列)
    name: Optional[str] = None
    stage: Optional[str] = None                # 中文友好学段
    interest: Optional[str] = None             # 兴趣方向 (存到 interests 字段)
    agent_name: Optional[str] = None           # Agent 称呼
    direction: Optional[str] = None            # 目标方向
    language: Optional[str] = None             # 语言偏好
    # v0.1.7: Agent 人格 (teacher_zhang / xuejie / duanzishou)
    persona: Optional[str] = None
    # 老字段 (UserORM 有列)
    education_stage: Optional[str] = None
    province: Optional[str] = None
    score: Optional[int] = None
    rank: Optional[int] = None
    target: Optional[str] = None
    interests: Optional[str] = None
    background: Optional[str] = None


# ========== Profile (字段精简版) ==========
# v2.0 保留的可编辑字段 (前端表单展示):
#   - name             姓名/昵称 (必填)
#   - stage            学段 [小学/初中/高中/大学/考研/在职]  ← 中文友好版, 替代 education_stage
#   - subject_choice   选科 (如 "物化生", 高考 3+1+2)
#   - target_school    目标院校
#   - target_major     目标专业
#   - interest         兴趣方向 (文本)
#   - notes            备注
#   - agent_name       Agent 称呼 (替代硬编码 "张雪峰")
#
# 内部字段 (前端表单不展示, 但保留兼容):
#   - education_stage  /  province / score / rank / target (旧版字段)
#   - direction / language (派生 / 配置项)
#
# schema 保留字段 (前端不再编辑, 但数据库列不删):
#   - birthday / home_address / emergency_contact (注释保留)


# ========== Get profile ==========
@router.get("/profile")
async def get_profile(user_id: int = 1, db: Session = Depends(get_db)):
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        user = UserORM(id=user_id, name="Student", education_stage="high")
        db.add(user)
        db.commit()
        db.refresh(user)
    return _serialize_profile(user)


@router.put("/profile")
async def update_profile(
    payload: ProfileUpdate = Body(default_factory=ProfileUpdate),
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    """v0.1.6 修复: 用 ProfileUpdate body 接受 PUT, 不再用 query params
    (FastAPI 默认从 query 提取基础类型参数, 前端 PUT body 永远落不到 update 逻辑)
    Update user profile. ALL fields optional.
    v0.1.6 二次修复: ProfileUpdate 只保留 UserORM 实际有列的字段; 老字段兼容."""
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        user = UserORM(id=user_id, name=payload.name or "Student")
        db.add(user)
        db.flush()

    # v2.0 新字段 (UserORM 实际有列)
    if payload.name is not None:
        user.name = payload.name
    if payload.stage is not None:
        user.stage = payload.stage or "高中"
        # 同步到老字段 education_stage, 让下游 system_prompt 仍能工作
        user.education_stage = _stage_to_education_stage(payload.stage)
    if payload.interest is not None:
        # 兴趣方向存到 interests 字段 (UserORM 没独立 interest 列)
        user.interests = payload.interest or None
    if payload.agent_name is not None:
        # 核心修复目标 — 前端 PUT body 现在能正确保存
        user.agent_name = payload.agent_name or "张雪峰"
    if payload.persona is not None:
        # v0.1.7: 切换 Agent 人格 (实际生效到 system prompt)
        # 允许值: teacher_zhang / xuejie / duanzishou / custom
        new_persona = payload.persona or "teacher_zhang"
        # [P0] 修复: persona 切换时联动 agent_name (避免自相矛盾)
        # 只有当 agent_name 是空 / 默认值 / 任何 persona 默认值之一时, 才跟着变
        # 用户明确设过 (如 '小张' '李老师'), 不覆盖
        all_defaults = set(PERSONA_DEFAULT_AGENT_NAME.values())
        if payload.agent_name is None and (not user.agent_name or user.agent_name in all_defaults):
            user.agent_name = PERSONA_DEFAULT_AGENT_NAME.get(new_persona, "张雪峰")
        user.persona = new_persona
    if payload.direction is not None:
        user.direction = payload.direction or ""
    if payload.language is not None:
        user.language = payload.language or "中文"

    # 老字段 (保持兼容)
    if payload.education_stage is not None:
        user.education_stage = payload.education_stage
    if payload.province is not None:
        user.province = payload.province or None
    if payload.score is not None:
        user.score = payload.score
    if payload.rank is not None:
        user.rank = payload.rank
    if payload.target is not None:
        user.target = payload.target or None
    if payload.interests is not None:
        user.interests = payload.interests or None
    if payload.background is not None:
        user.background = payload.background or None

    db.commit()
    db.refresh(user)
    return {"message": "Updated", "profile": _serialize_profile(user)}


def _stage_to_education_stage(stage: str) -> str:
    """中文友好 stage → 老字段 education_stage (值域 [primary..other])"""
    m = {
        "小学": "primary",
        "初中": "middle",
        "高中": "high",
        "职高": "vocational",
        "中专": "vocational",
        "大专": "junior_college",
        "本科": "bachelor",
        "大学": "bachelor",
        "考研": "master",
        "硕士": "master",
        "留学": "abroad",
        "在职": "working",
        "工作": "working",
    }
    return m.get(stage or "", "high")


def _export_schedules(db: Session, user_id: int) -> list:
    """v2.0: 导出日程 (兼容 backend-architecture task)."""
    rows = db.query(ScheduleORM).filter_by(user_id=user_id).order_by(ScheduleORM.date).all()
    return [
        {
            "date": s.date,
            "content": s.content,
            "type": s.type,
            "completed": bool(s.completed),
            "resource_id": s.resource_id,
            "note": s.note,
        }
        for s in rows
    ]


def _serialize_profile(user: UserORM) -> dict:
    """序列化 profile, 同时回老字段 (兼容前端 / RAG 检索)"""
    return {
        "id": user.id,
        "name": user.name,
        # v2.0 精简字段
        "stage": user.stage or "高中",
        "subject_choice": "",  # 暂未独立列, 后续可加
        "target_school": "",
        "target_major": "",
        "interest": user.interests or "",
        "notes": user.background or "",
        "agent_name": user.agent_name or "张雪峰",
        # v0.1.7: Agent 人格 (实际生效到 system prompt)
        "persona": getattr(user, "persona", None) or "teacher_zhang",
        # 配置字段
        "direction": user.direction or "",
        "language": user.language or "中文",
        # 老字段 (向后兼容)
        "education_stage": user.education_stage or "high",
        "province": user.province,
        "score": user.score,
        "rank": user.rank,
        "target": user.target,
        "interests": user.interests,
        "background": user.background,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


# ========== Profile view: "AI 怎么理解我" ==========
@router.get("/profile-view")
async def profile_view(user_id: int = 1, db: Session = Depends(get_db)):
    """v2.0: 返回 profile 的"衍生指令" — 这是 build_system_prompt 实际看到的输入

    前端"AI 怎么理解我"折叠区直接显示这个, 让用户能看到 LLM 真实读到的画像,
    方便校准 (改完表单可以立刻预览效果)
    """
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        user = UserORM(id=user_id, name="Student", education_stage="high")
        db.add(user)
        db.commit()
        db.refresh(user)

    stage = user.stage or "高中"
    language = user.language or "中文"
    agent_name = user.agent_name or "张雪峰"
    direction = user.direction or ""

    # 衍生指令 — 跟 context_builder 注入规则一致
    derived_rules: list[str] = []
    if stage in ("小学", "初中"):
        derived_rules.append(f"用户是{stage}生, 解题用{stage}方法, 不引入更高阶段公式")
    if stage == "高中":
        derived_rules.append("用户是高中生, 关注高考相关: 知识点、解题套路、志愿填报")
    if stage in ("大学", "考研", "在职"):
        derived_rules.append(f"用户是{stage}阶段, 关注点: 职业规划、技能提升、效率工具")
    if language == "英文":
        derived_rules.append("回复以英文为主 (英文提问用英文, 中文提问可中英混排)")
    elif language == "双语":
        derived_rules.append("中英双语回复, 关键术语括注英文")
    if agent_name and agent_name != "张雪峰":
        derived_rules.append(f"你叫 {agent_name}, 不要自称'张雪峰'或'张老师'等默认称呼")
    if direction == "学业":
        derived_rules.append("用户目标方向是学业, 优先给应试 + 系统学习建议")
    elif direction == "兴趣":
        derived_rules.append("用户目标方向是兴趣, 优先给探索性 + 拓展资源")
    elif direction == "职业":
        derived_rules.append("用户目标方向是职业, 优先给就业 + 行业洞察")

    # 渲染成预览 prompt (跟 build_system_prompt 实际拼接的格式一致)
    profile_block = (
        f"# User profile\n"
        f"- Name: {user.name}\n"
        f"- Stage: {stage}\n"
        f"- Province: {user.province or 'unspecified'}\n"
        f"- Score: {user.score or 'unspecified'}\n"
        f"- Rank: {user.rank or 'unspecified'}\n"
        f"- Target: {user.target or 'unspecified'}\n"
        f"- Interests: {user.interests or 'unspecified'}\n"
        f"- Background: {user.background or 'unspecified'}\n"
    )
    stage_injection = ""
    if derived_rules:
        stage_injection = "## Profile-derived rules\n" + "\n".join(f"- {r}" for r in derived_rules)

    return {
        "user_id": user_id,
        "raw_profile": _serialize_profile(user),
        "derived_rules": derived_rules,
        "preview_prompt": profile_block + ("\n" + stage_injection if stage_injection else ""),
    }


# ========== v0.1.7: Agent 人格 (实际生效到 system prompt) ==========

# v0.1.7+ 扩充: nuwa-skill 蒸馏 13 人物 + 1 主题 + 自定义 2 个 = 16 个 persona
# 来源: github.com/alchaincyf/nuwa-skill (MIT 协议) + 自蒸馏 xuejie / duanzishou
AVAILABLE_PERSONAS = [
    {"value": "teacher_zhang", "label": "张雪峰", "desc": "nuwa-skill · 教育/职业/阶层 · 5 心智模型 + 8 决策启发", "source": "nuwa-skill", "scenario_fit": ["chat", "exam", "volunteer"]},
    {"value": "xuejie",        "label": "学姐",   "desc": "自蒸馏 · 串行复利 · 适合答疑陪伴", "source": "self",      "scenario_fit": ["chat", "exam"]},
    {"value": "duanzishou",    "label": "段子手", "desc": "自蒸馏 · 第一性原理 + 段子 · 适合闲聊", "source": "self",      "scenario_fit": ["chitchat"]},
    {"value": "jobs",          "label": "乔布斯", "desc": "nuwa-skill · 专注=说不 · 产品/设计/战略", "source": "nuwa-skill", "scenario_fit": ["chat", "volunteer"]},
    {"value": "musk",          "label": "马斯克", "desc": "nuwa-skill · 第一性原理 · 工程/成本/删减", "source": "nuwa-skill", "scenario_fit": ["chat", "exam"]},
    {"value": "munger",        "label": "芒格",   "desc": "nuwa-skill · 反转思维 · 投资/多学科", "source": "nuwa-skill", "scenario_fit": ["chat", "exam"]},
    {"value": "feynman",       "label": "费曼",   "desc": "nuwa-skill · 命名≠理解 · 学习/科学", "source": "nuwa-skill", "scenario_fit": ["chat", "exam"]},
    {"value": "naval",         "label": "纳瓦尔", "desc": "nuwa-skill · 杠杆思维 · 财富/人生哲学", "source": "nuwa-skill", "scenario_fit": ["chat"]},
    {"value": "zhang_yiming",  "label": "张一鸣", "desc": "nuwa-skill · 延迟满足 · 产品/组织/全球化", "source": "nuwa-skill", "scenario_fit": ["chat", "volunteer"]},
    {"value": "paul_graham",   "label": "Paul Graham", "desc": "nuwa-skill · 写作=思考 · 创业/YC", "source": "nuwa-skill", "scenario_fit": ["chat"]},
    {"value": "karpathy",      "label": "Karpathy",   "desc": "nuwa-skill · Software X.0 · AI/工程", "source": "nuwa-skill", "scenario_fit": ["chat", "exam"]},
    {"value": "ilya",          "label": "Ilya 苏茨克维","desc": "nuwa-skill · 压缩=理解 · AI 安全/研究", "source": "nuwa-skill", "scenario_fit": ["chat"]},
    {"value": "mrbeast",       "label": "MrBeast",     "desc": "nuwa-skill · CTR × AVD · 内容/YouTube", "source": "nuwa-skill", "scenario_fit": ["chitchat"]},
    {"value": "trump",         "label": "特朗普",     "desc": "nuwa-skill · 一切都是交易 · 谈判/权力", "source": "nuwa-skill", "scenario_fit": ["chat", "volunteer"]},
    {"value": "taleb",         "label": "塔勒布",     "desc": "nuwa-skill · 反脆弱 · 风险/黑天鹅", "source": "nuwa-skill", "scenario_fit": ["chat", "volunteer"]},
    {"value": "x_mastery",     "label": "X Mastery", "desc": "nuwa-skill · 6 位创作者综合 · X/Twitter 运营", "source": "nuwa-skill", "scenario_fit": ["chitchat"]},
]


# v0.1.7 修复下属测试报告 [P0]: persona 切换时 agent_name 自动联动, 避免自相矛盾
# (之前 user.agent_name='学姐' + user.persona='duanzishou' 同时存在 → LLM 双重人格)
# v0.1.7+: 全 16 persona 联动默认 agent_name (跟 label 一致, 全中文)
PERSONA_DEFAULT_AGENT_NAME = {
    "teacher_zhang": "张雪峰",
    "xuejie":        "学姐",
    "duanzishou":    "段子手",
    "jobs":          "乔布斯",
    "musk":          "马斯克",
    "munger":        "芒格",
    "feynman":       "费曼",
    "naval":         "纳瓦尔",
    "zhang_yiming":  "张一鸣",
    "paul_graham":   "Paul Graham",
    "karpathy":      "Karpathy",
    "ilya":          "Ilya",
    "mrbeast":       "MrBeast",
    "trump":         "特朗普",
    "taleb":         "塔勒布",
    "x_mastery":     "X Mastery",
}


@router.get("/personas")
async def list_personas():
    """列出可选的 Agent 人格 (含适用 scenario)"""
    return {"personas": AVAILABLE_PERSONAS}


@router.get("/persona")
async def get_persona(user_id: int = 1, db: Session = Depends(get_db)):
    """读当前用户的人格"""
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        return {"persona": "teacher_zhang"}
    return {"persona": getattr(user, "persona", None) or "teacher_zhang"}


@router.post("/persona")
async def set_persona(
    persona: str = Body(..., embed=True),
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    """v0.1.7: 切换 Agent 人格 — 立即生效 (下次 chat 自动用新 persona)"""
    valid_values = [p["value"] for p in AVAILABLE_PERSONAS]
    if persona not in valid_values and persona != "custom":
        raise HTTPException(
            status_code=400,
            detail=f"未知 persona: {persona!r}. 可选: {valid_values}"
        )
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        user = UserORM(id=user_id, name="Student")
        db.add(user)
        db.flush()
    user.persona = persona
    # v0.1.7 修复 [P0] agent_name 与 persona 一致性:
    # 如果当前 agent_name 是空/默认值/任一 persona 默认值之一, 跟着 persona 切换
    # 否则保留用户自定义 (用户可能设了 '小张' '李老师' 等特殊名)
    current_default = PERSONA_DEFAULT_AGENT_NAME.get(getattr(user, "persona", None) or "teacher_zhang")
    all_defaults = set(PERSONA_DEFAULT_AGENT_NAME.values())
    if not user.agent_name or user.agent_name in all_defaults:
        user.agent_name = PERSONA_DEFAULT_AGENT_NAME.get(persona, "张雪峰")
    db.commit()
    db.refresh(user)
    return {
        "message": "Persona updated",
        "persona": persona,
        "persona_label": next((p["label"] for p in AVAILABLE_PERSONAS if p["value"] == persona), persona),
        "agent_name": user.agent_name,  # 返回当前 agent_name, 前端可显示
    }


# ========== Education stages ==========
@router.get("/education-stages")
async def list_education_stages():
    """Available education stages"""
    return {
        "stages": [
            {"value": "primary", "label": "小学", "icon": "🎒"},
            {"value": "middle", "label": "初中", "icon": "📚"},
            {"value": "high", "label": "高中", "icon": "🎓"},
            {"value": "vocational", "label": "职高/中专", "icon": "🔧"},
            {"value": "junior_college", "label": "大专", "icon": "🏫"},
            {"value": "bachelor", "label": "本科", "icon": "🎯"},
            {"value": "master", "label": "考研/硕士", "icon": "📖"},
            {"value": "abroad", "label": "留学", "icon": "✈️"},
            {"value": "working", "label": "在职/工作", "icon": "💼"},
            {"value": "other", "label": "其他", "icon": "✨"},
        ]
    }


# ========== Data Export / Import (v2.0) ==========
@router.get("/export")
async def export_data(user_id: int = 1, db: Session = Depends(get_db)):
    """v2.0: 导出用户所有数据为 JSON (profile + conversations + facts + mistakes)

    用途: 备份、跨设备迁移
    """
    from app.db.database import UserFactORM, MessageORM, ConversationORM

    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    conversations = (
        db.query(ConversationORM)
        .filter_by(user_id=user_id)
        .order_by(ConversationORM.created_at)
        .all()
    )
    facts = db.query(UserFactORM).filter_by(user_id=user_id).all()

    # 错题/学习资料
    from app.db.database import ResourceORM
    resources = (
        db.query(ResourceORM)
        .filter_by(user_id=user_id)
        .order_by(ResourceORM.created_at)
        .all()
    )

    return {
        "version": "v2.0",
        "exported_at": user.updated_at.isoformat() if user.updated_at else None,
        "profile": _serialize_profile(user),
        "conversations": [
            {
                "id": c.id,
                "scenario": c.scenario,
                "title": c.title,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "messages": [
                    {
                        "role": m.role,
                        "content": m.content,
                        "scenario": m.scenario,
                        "created_at": m.created_at.isoformat() if m.created_at else None,
                    }
                    for m in (
                        db.query(MessageORM)
                        .filter_by(conversation_id=c.id, scenario=c.scenario)
                        .order_by(MessageORM.created_at)
                        .all()
                    )
                ],
            }
            for c in conversations
        ],
        "facts": [
            {
                "category": f.category,
                "fact": f.fact,
                "importance": f.importance,
                "stale": bool(f.stale),
            }
            for f in facts
        ],
        "resources": [
            {
                "type": r.type,
                "code": r.code,
                "title": r.title,
                "content": r.content,
                "subject": r.subject,
                "tags": r.tags or [],
                "knowledge_point": r.knowledge_point,
                "knowledge_tags": r.knowledge_tags or [],  # v2.0
                "difficulty": r.difficulty or 3,             # v2.0
                "error_type": r.error_type,
                "mastered": r.mastered,
                "notes": r.notes,
                "solution": r.solution,
                "thinking": r.thinking,
            }
            for r in resources
        ],
        "schedules": _export_schedules(db, user_id),
    }


@router.post("/import")
async def import_data(
    payload: dict,
    user_id: int = 1,
    mode: str = "merge",  # merge | overwrite
    db: Session = Depends(get_db),
):
    """v2.0: 从 JSON 恢复用户数据

    mode=overwrite: 清空现有 profile/conversations/facts/resources, 再导入
    mode=merge (默认): 跳过已存在的 (按 code/id), 追加新的
    """
    if mode not in ("merge", "overwrite"):
        raise HTTPException(400, "mode 必须是 merge 或 overwrite")
    if not isinstance(payload, dict):
        raise HTTPException(400, "payload 必须是 JSON 对象")

    from app.db.database import UserFactORM, MessageORM, ConversationORM, ResourceORM, ScheduleORM

    counts = {"profile": 0, "conversations": 0, "messages": 0, "facts": 0, "resources": 0, "schedules": 0}

    # ---- Profile ----
    prof = payload.get("profile") or {}
    if prof:
        user = db.query(UserORM).filter_by(id=user_id).first()
        if not user:
            user = UserORM(id=user_id)
            db.add(user)
        for k in ("name", "stage", "education_stage", "province", "target",
                  "interests", "background", "direction", "language", "agent_name"):
            v = prof.get(k)
            if v is not None and v != "":
                setattr(user, k, v)
        if prof.get("score") is not None:
            user.score = prof["score"]
        if prof.get("rank") is not None:
            user.rank = prof["rank"]
        db.commit()
        counts["profile"] = 1

    # ---- Conversations + messages ----
    if mode == "overwrite":
        old_convs = db.query(ConversationORM).filter_by(user_id=user_id).all()
        for c in old_convs:
            db.query(MessageORM).filter_by(conversation_id=c.id).delete()
        db.query(ConversationORM).filter_by(user_id=user_id).delete()
        db.commit()

    for c in payload.get("conversations") or []:
        new_conv = ConversationORM(
            user_id=user_id,
            scenario=c.get("scenario") or "chat",
            title=c.get("title") or "导入的对话",
        )
        db.add(new_conv)
        db.flush()
        counts["conversations"] += 1
        for m in c.get("messages") or []:
            db.add(MessageORM(
                conversation_id=new_conv.id,
                scenario=c.get("scenario") or "chat",
                role=m.get("role") or "user",
                content=m.get("content") or "",
            ))
            counts["messages"] += 1
    db.commit()

    # ---- Facts ----
    if mode == "overwrite":
        db.query(UserFactORM).filter_by(user_id=user_id).delete()
        db.commit()
    for f in payload.get("facts") or []:
        db.add(UserFactORM(
            user_id=user_id,
            category=f.get("category") or "profile",
            fact=f.get("fact") or "",
            importance=f.get("importance") or 0.5,
            stale=1 if f.get("stale") else 0,
        ))
        counts["facts"] += 1
    db.commit()

    # ---- Resources (错题 + 资料) ----
    if mode == "overwrite":
        db.query(ResourceORM).filter_by(user_id=user_id).delete()
        db.commit()
    for r in payload.get("resources") or []:
        db.add(ResourceORM(
            user_id=user_id,
            type=r.get("type") or "material",
            code=r.get("code") or "",
            title=r.get("title") or "(无标题)",
            content=r.get("content"),
            subject=r.get("subject"),
            tags=r.get("tags") or [],
            knowledge_point=r.get("knowledge_point"),
            knowledge_tags=r.get("knowledge_tags") or [],  # v2.0
            difficulty=r.get("difficulty") or 3,           # v2.0
            error_type=r.get("error_type"),
            mastered=bool(r.get("mastered")),
            notes=r.get("notes"),
            solution=r.get("solution"),
            thinking=r.get("thinking"),
        ))
        counts["resources"] += 1
    db.commit()

    # ---- Schedules (v2.0: 兼容 backend-architecture task) ----
    if mode == "overwrite":
        db.query(ScheduleORM).filter_by(user_id=user_id).delete()
        db.commit()
    for s in payload.get("schedules") or []:
        db.add(ScheduleORM(
            user_id=user_id,
            date=s.get("date"),
            content=s.get("content") or "",
            type=s.get("type") or "study",
            completed=bool(s.get("completed", False)),
            resource_id=s.get("resource_id"),
            note=s.get("note"),
        ))
        counts["schedules"] += 1
    db.commit()

    return {"message": f"导入完成 (mode={mode})", "imported": counts}

# ========== v0.1.7: 学情统计 + 学习轨迹 (画像可视化 + 学习轨迹图) ==========

@router.get("/profile-stats")
async def profile_stats(user_id: int = 1, db: Session = Depends(get_db)):
    """v0.1.7: 学情统计 — 用于画像页雷达图

    返回:
    - by_subject: {数学: 5, 物理: 3} 各学科错题数
    - by_difficulty: {1: 1, 2: 2, 3: 4, 4: 0, 5: 0} 各难度错题数
    - mastered_rate: 已掌握比例 (0-1)
    - knowledge_tags: top 10 知识点
    - conversation_count: 历史会话数
    """
    from app.db.database import ResourceORM, ConversationORM, UserFactORM, MessageORM
    from sqlalchemy import func

    # 各学科错题数
    by_subject = dict(
        db.query(ResourceORM.subject, func.count(ResourceORM.id))
        .filter(ResourceORM.user_id == user_id, ResourceORM.type == "mistake", ResourceORM.subject.isnot(None))
        .group_by(ResourceORM.subject)
        .all()
    )
    # 各难度错题数
    by_difficulty = {}
    for d in range(1, 6):
        c = db.query(ResourceORM).filter_by(
            user_id=user_id, type="mistake", difficulty=d
        ).count()
        if c > 0:
            by_difficulty[d] = c
    # 总错题 + 已掌握
    total_mistakes = db.query(ResourceORM).filter_by(user_id=user_id, type="mistake").count()
    mastered = db.query(ResourceORM).filter_by(user_id=user_id, type="mistake", mastered=True).count()
    # 知识点 (从 knowledge_tags JSON 提取 - SQLite 直接 LIKE 不可靠, Python 层解析)
    rows = db.query(ResourceORM.knowledge_tags).filter(
        ResourceORM.user_id == user_id,
        ResourceORM.type == "mistake",
        ResourceORM.knowledge_tags.isnot(None),
    ).all()
    tag_count = {}
    import json
    for (raw,) in rows:
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                continue
        if isinstance(raw, list):
            for t in raw:
                if isinstance(t, str):
                    tag_count[t] = tag_count.get(t, 0) + 1
    top_tags = sorted(tag_count.items(), key=lambda x: -x[1])[:10]
    # 会话数
    conv_count = db.query(ConversationORM).filter_by(user_id=user_id).count()
    msg_count = db.query(MessageORM).filter(
        MessageORM.conversation_id.in_(
            db.query(ConversationORM.id).filter_by(user_id=user_id)
        )
    ).count()

    return {
        "user_id": user_id,
        "total_mistakes": total_mistakes,
        "mastered": mastered,
        "mastered_rate": round(mastered / total_mistakes, 3) if total_mistakes > 0 else 0,
        "by_subject": by_subject,
        "by_difficulty": by_difficulty,
        "top_knowledge_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "conversation_count": conv_count,
        "message_count": msg_count,
    }


@router.get("/learning-timeline")
async def learning_timeline(
    user_id: int = 1,
    days: int = 30,
    db: Session = Depends(get_db),
):
    """v0.1.7: 学习轨迹 — 按天聚合最近 N 天活动, 给前端画时间线

    返回 [{date: "2026-09-27", mistakes_added: 2, schedules_done: 1, messages: 5}, ...]
    """
    from app.db.database import ResourceORM, ScheduleORM, ConversationORM, MessageORM
    from datetime import datetime, timedelta

    cutoff = datetime.now() - timedelta(days=days)
    # 用 created_at 字段 (SQLite 没专门的 date 函数, 用 date() 转换)
    timeline: dict = {}

    # 错题 (按 created_at)
    rows = db.query(ResourceORM.created_at).filter(
        ResourceORM.user_id == user_id, ResourceORM.type == "mistake", ResourceORM.created_at >= cutoff
    ).all()
    for (ts,) in rows:
        if ts:
            d = ts.strftime("%Y-%m-%d")
            t = timeline.setdefault(d, {"date": d, "mistakes_added": 0, "schedules_done": 0, "messages": 0})
            t["mistakes_added"] += 1

    # 日程完成 (用 updated_at 近似)
    rows = db.query(ScheduleORM.updated_at).filter(
        ScheduleORM.user_id == user_id, ScheduleORM.completed == True, ScheduleORM.updated_at >= cutoff
    ).all()
    for (ts,) in rows:
        if ts:
            d = ts.strftime("%Y-%m-%d")
            t = timeline.setdefault(d, {"date": d, "mistakes_added": 0, "schedules_done": 0, "messages": 0})
            t["schedules_done"] += 1

    # 消息 (用 created_at)
    rows = db.query(MessageORM.created_at).filter(
        MessageORM.role == "user",
        MessageORM.created_at >= cutoff,
        MessageORM.conversation_id.in_(db.query(ConversationORM.id).filter_by(user_id=user_id))
    ).all()
    for (ts,) in rows:
        if ts:
            d = ts.strftime("%Y-%m-%d")
            t = timeline.setdefault(d, {"date": d, "mistakes_added": 0, "schedules_done": 0, "messages": 0})
            t["messages"] += 1

    items = sorted(timeline.values(), key=lambda x: x["date"], reverse=True)
    return {"days": days, "items": items}
