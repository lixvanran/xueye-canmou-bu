"""User API - all fields optional except name

v2.0:
- 精简前端可编辑字段, 只留核心 8 个
- 保留 birthday/home_address/emergency_contact (兼容老数据, schema 不删)
- 新增 stage/direction/language/agent_name 字段
- GET /api/user/profile-view 返回"AI 怎么理解我"的衍生指令预览
- GET /api/user/export / POST /api/user/import (数据导出导入)
- 导出/导入包含 schedules (v2.0 兼容 backend-architecture task)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.db.database import get_db, UserORM, ScheduleORM
from typing import Optional

router = APIRouter(prefix="/api/user", tags=["用户"])


# ========== Profile (字段精简版) ==========
# v2.0 保留的可编辑字段 (前端表单展示):
#   - name             姓名/昵称 (必填)
#   - stage            学段 [小学/初中/高中/大学/考研/在职]  ← 中文友好版, 替代 education_stage
#   - subject_choice   选科 (如 "物化生", 高考 3+1+2)
#   - target_school    目标院校
#   - target_major     目标专业
#   - interest         兴趣方向 (文本)
#   - notes            备注
#   - agent_name       Agent 称呼 (替代硬编码 "张老师")
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
    name: Optional[str] = None,
    stage: Optional[str] = None,                # v2.0: 中文友好学段
    subject_choice: Optional[str] = None,       # v2.0: 选科
    target_school: Optional[str] = None,        # v2.0: 目标院校 (独立字段, 不挤 target)
    target_major: Optional[str] = None,         # v2.0: 目标专业
    interest: Optional[str] = None,             # v2.0: 兴趣方向
    notes: Optional[str] = None,                # v2.0: 备注 (替代老 background)
    agent_name: Optional[str] = None,           # v2.0: Agent 称呼
    # 兼容老字段 — 可继续传, 不传不更新
    education_stage: Optional[str] = None,
    province: Optional[str] = None,
    score: Optional[int] = None,
    rank: Optional[int] = None,
    target: Optional[str] = None,
    interests: Optional[str] = None,
    background: Optional[str] = None,
    direction: Optional[str] = None,
    language: Optional[str] = None,
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    """Update user profile. ALL fields optional."""
    user = db.query(UserORM).filter_by(id=user_id).first()
    if not user:
        user = UserORM(id=user_id, name=name or "Student")
        db.add(user)
        db.flush()

    # v2.0 新字段
    if name is not None:
        user.name = name
    if stage is not None:
        user.stage = stage or "高中"
        # 同步到老字段 education_stage, 让下游 system_prompt 仍能工作
        user.education_stage = _stage_to_education_stage(stage)
    if subject_choice is not None:
        # 没有独立列, 塞 target (但 target_school 优先, 这里用 interests)
        pass  # 暂存 interests, 或后续加列
    if interest is not None:
        user.interests = interest or None
    if agent_name is not None:
        user.agent_name = agent_name or "张老师"
    if direction is not None:
        user.direction = direction or ""
    if language is not None:
        user.language = language or "中文"

    # 老字段 (保持兼容)
    if education_stage is not None:
        user.education_stage = education_stage
    if province is not None:
        user.province = province or None
    if score is not None:
        user.score = score
    if rank is not None:
        user.rank = rank
    if target is not None:
        user.target = target or None
    if interests is not None:
        user.interests = interests or None
    if background is not None:
        user.background = background or None

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
        "agent_name": user.agent_name or "张老师",
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
    agent_name = user.agent_name or "张老师"
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
    if agent_name and agent_name != "张老师":
        derived_rules.append(f"你叫 {agent_name}, 不要自称张老师或张雪峰")
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