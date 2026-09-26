"""Database ORM models"""
import logging
from sqlalchemy import create_engine, Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Float, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
from app.core.config import settings

logger = logging.getLogger(__name__)

Base = declarative_base()


# ========== User (extended) ==========
class UserORM(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), nullable=False)
    # 学段: primary/middle/high/vocational/junior_college/bachelor/master/abroad/working/other
    # v2.0: 保留向后兼容. 新字段 stage/direction/language/agent_name 由 profile 路由写入。
    education_stage = Column(String(32), default="high")
    # ---- v2.0 新字段 (profile 路由写入, schema 迁移会自动 ALTER TABLE) ----
    # 学段, 值域 [小学/初中/高中/大学/考研/在职]. 与 education_stage 区别: stage 是中文友好版, 给前端直接显示
    stage = Column(String(32), default="高中")
    # 目标方向: [学业/兴趣/职业]
    direction = Column(String(32), default="")
    # 语言偏好: [中文/英文/双语]
    language = Column(String(16), default="中文")
    # Agent 称呼 (替代硬编码"张老师"). 默认 "张老师" 保持向后兼容
    agent_name = Column(String(64), default="张老师")

    # ---- v0.x 老字段 (schema 迁移保留, 默认 NULL, 不再由前端写入) ----
    # birthday = Column(String(32), nullable=True)
    # home_address = Column(String(256), nullable=True)
    # emergency_contact = Column(String(64), nullable=True)

    # All optional now
    province = Column(String(32), nullable=True)
    score = Column(Integer, nullable=True)
    rank = Column(Integer, nullable=True)
    target = Column(String(128), nullable=True)
    interests = Column(Text, nullable=True)
    background = Column(Text, nullable=True)  # Free-form self-introduction
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== Conversation ==========
class ConversationORM(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    # v2.0: scenario 收紧到合法值 (chat/exam/volunteer/chitchat). 索引在 _migrate_if_needed 里创建
    scenario = Column(String(32), default="chat", index=True)
    title = Column(String(128), default="New chat")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    messages = relationship(
        "MessageORM",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="MessageORM.created_at",
    )


# ========== Message ==========
class MessageORM(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), index=True)
    # v2.0: 冗余存 scenario, 查询快. 写入时由 ORM 层强制同步 conversations.scenario
    scenario = Column(String(32), default="chat", index=True)
    role = Column(String(16))  # user/assistant/system/tool
    content = Column(Text)
    tool_calls = Column(Text)  # JSON string
    created_at = Column(DateTime, default=datetime.now)

    conversation = relationship("ConversationORM", back_populates="messages")


# ========== Resource (unified: mistakes + materials) ==========
class ResourceORM(Base):
    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    # 'mistake' = 错题 | 'material' = 学习资料
    type = Column(String(16), nullable=False, default="material")
    # Auto-generated code for RAG reference: M-001, S-001 etc.
    code = Column(String(16), nullable=True, index=True)
    # Common
    subject = Column(String(32), nullable=True)
    title = Column(String(256), nullable=False)
    content = Column(Text, nullable=True)
    file_path = Column(String(512), nullable=True)
    tags = Column(JSON, nullable=True)  # List[str]
    # User notes / solution / thinking (for both mistake and material)
    notes = Column(Text, nullable=True)
    solution = Column(Text, nullable=True)
    thinking = Column(Text, nullable=True)
    # Mistake-only
    knowledge_point = Column(String(128), nullable=True)
    error_type = Column(String(32), nullable=True)  # calculation/concept/method/unfamiliar
    mastered = Column(Boolean, default=False)
    # v2.0: 知识图谱 — 多知识点标签 (LLM 自动打标) + 难度等级 + 掌握度
    # knowledge_tags: list[str], 3-5 个细粒度知识点标签, e.g. ["二次函数", "顶点公式"]
    knowledge_tags = Column(JSON, nullable=True)
    # difficulty: 1-5, 1=入门 5=竞赛级, 默认 3 (中等)
    difficulty = Column(Integer, default=3)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== v0.9.1: User Preferences (key-value, 存模型选择/UI 偏好) ==========
class UserPreferenceORM(Base):
    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False, default=1)
    key = Column(String(64), nullable=False, index=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# v0.9.9: 长期事实 (LLM 自动抽取的学生/用户信息)
# 模仿人脑长期记忆: 不存对话原文, 存"高密度事实"
class UserFactORM(Base):
    __tablename__ = "user_facts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False, default=1)
    # fact 类别: profile / preference / knowledge / mistake_pattern
    category = Column(String(32), nullable=False, default="profile", index=True)
    # 事实内容 (短句: "湖北高三, 620分, 物化生")
    fact = Column(String(512), nullable=False)
    # 重要性 0-1, 抽取时 LLM 评估
    importance = Column(Float, nullable=False, default=0.5)
    # 来源对话 id (可空, 让用户手动加的事实没来源)
    source_conversation_id = Column(Integer, nullable=True)
    # 是否过期 (LLM 标记"可能过期"的事实)
    stale = Column(Integer, nullable=False, default=0)  # 0=active, 1=stale
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== v2.0: Schedule (日程/学习计划) ==========
class ScheduleORM(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False, default=1)
    # 日期, ISO 格式 'YYYY-MM-DD'
    date = Column(String(10), nullable=False, index=True)
    # 内容 (短文本, 一行)
    content = Column(String(256), nullable=False)
    # 类型: study/review/exam/rest/custom
    type = Column(String(16), nullable=False, default="study")
    # 是否完成
    completed = Column(Boolean, nullable=False, default=False)
    # 关联的错题/资料 id (可选)
    resource_id = Column(Integer, nullable=True)
    # AI 生成的额外备注
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== Database setup ==========
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# v2.0: 合法 scenario 值域
VALID_SCENARIOS = {"chat", "exam", "volunteer", "chitchat"}


def normalize_scenario(raw: str | None) -> str:
    """校验 + 归一化 scenario. 不在值域里就 fallback 到 'chat'."""
    if not raw:
        return "chat"
    raw = str(raw).strip().lower()
    return raw if raw in VALID_SCENARIOS else "chat"


def init_db():
    """Create tables and seed demo data. Handles simple schema migration."""
    _migrate_if_needed()
    # v0.9.1: 显式确保所有 ORM 类都注册到 Base.metadata
    # (在某些 Python/SQLAlchemy 版本下, 跨模块 import 可能没触发 model 注册)
    logger.debug(
        f"init_db: Base.metadata has tables: {sorted(Base.metadata.tables.keys())}"
    )
    Base.metadata.create_all(bind=engine)
    _seed_demo()


def _migrate_if_needed():
    """温和的列补全迁移 — 不再 DROP TABLE
    - 缺的列用 ALTER TABLE 补 (SQLite 支持)
    - 实在补不上的才提示手动处理
    """
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    # v0.9.1: 兜底 — 如果 user_preferences 表不存在 (老数据库升级), 用 SQL 创建
    with engine.connect() as conn:
        if 'user_preferences' not in inspector.get_table_names():
            logger.info("Schema migration: creating user_preferences table")
            try:
                conn.execute(text("""
                    CREATE TABLE user_preferences (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL DEFAULT 1,
                        "key" VARCHAR(64) NOT NULL,
                        value JSON,
                        updated_at DATETIME
                    )
                """))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_preferences_user_id ON user_preferences (user_id)"))
                conn.execute(text('CREATE INDEX IF NOT EXISTS ix_user_preferences_key ON user_preferences ("key")'))
                conn.commit()
            except Exception as e:
                logger.warning(f"Failed to create user_preferences: {e}")
        # v0.9.9: 兜底 — user_facts 表
        if 'user_facts' not in inspector.get_table_names():
            logger.info("Schema migration: creating user_facts table")
            try:
                conn.execute(text("""
                    CREATE TABLE user_facts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL DEFAULT 1,
                        category VARCHAR(32) NOT NULL DEFAULT 'profile',
                        fact VARCHAR(512) NOT NULL,
                        importance FLOAT NOT NULL DEFAULT 0.5,
                        source_conversation_id INTEGER,
                        stale INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME,
                        updated_at DATETIME
                    )
                """))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_facts_user_id ON user_facts (user_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_facts_category ON user_facts (category)"))
                conn.commit()
            except Exception as e:
                logger.warning(f"Failed to create user_facts: {e}")
    if 'resources' not in inspector.get_table_names():
        return  # 全新安装, 让 create_all 处理
    existing_cols = {c['name'] for c in inspector.get_columns('resources')}
    # 字段 → 默认值 / 类型
    new_cols = {
        'code':            ('VARCHAR(16)',  "''"),
        'notes':           ('TEXT',         "NULL"),
        'solution':        ('TEXT',         "NULL"),
        'thinking':        ('TEXT',         "NULL"),
        'mastered':        ('BOOLEAN',      "0"),
        # v2.0: 知识图谱相关字段
        'knowledge_tags':  ('JSON',         "NULL"),
        'difficulty':      ('INTEGER',      "3"),
    }
    with engine.connect() as conn:
        for col, (ctype, default) in new_cols.items():
            if col not in existing_cols:
                logger.info(f"Schema migration: adding resources.{col}")
                try:
                    conn.execute(text(
                        f"ALTER TABLE resources ADD COLUMN {col} {ctype} DEFAULT {default}"
                    ))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Failed to add column {col}: {e}")
        # 索引补全 (code 列经常按它查)
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_resources_code ON resources (code)"))
            conn.commit()
        except Exception as e:
            logger.debug(f"Index ix_resources_code: {e}")

    # ===== v2.0: profile 字段补全 =====
    _migrate_profile_fields(engine)
    # ===== v2.0: conversations / messages 加 scenario 索引 =====
    _migrate_scenario_index(engine)


def _migrate_profile_fields(engine):
    """v2.0: 给 users 表补 stage/direction/language/agent_name 字段.
    老字段 birthday/home_address/emergency_contact 按 spec 注释保留, schema 不删.
    """
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if 'users' not in inspector.get_table_names():
        return
    existing_cols = {c['name'] for c in inspector.get_columns('users')}
    new_cols = {
        'stage':       ('VARCHAR(32)', "'高中'"),
        'direction':   ('VARCHAR(32)', "''"),
        'language':    ('VARCHAR(16)', "'中文'"),
        'agent_name':  ('VARCHAR(64)', "'张老师'"),
        # 老字段保留 (向后兼容), 不主动建. 注释里说明
        # 'birthday':          ('VARCHAR(32)', "NULL"),
        # 'home_address':      ('VARCHAR(256)', "NULL"),
        # 'emergency_contact': ('VARCHAR(64)', "NULL"),
    }
    with engine.connect() as conn:
        for col, (ctype, default) in new_cols.items():
            if col not in existing_cols:
                logger.info(f"Schema migration: adding users.{col}")
                try:
                    conn.execute(text(
                        f"ALTER TABLE users ADD COLUMN {col} {ctype} DEFAULT {default}"
                    ))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Failed to add users.{col}: {e}")


def _migrate_scenario_index(engine):
    """v2.0: 给 conversations.scenario 和 messages.scenario 加索引 (防串台全表扫)"""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    with engine.connect() as conn:
        # messages 表加 scenario 列 + 索引
        if 'messages' in inspector.get_table_names():
            msg_cols = {c['name'] for c in inspector.get_columns('messages')}
            if 'scenario' not in msg_cols:
                logger.info("Schema migration: adding messages.scenario")
                try:
                    conn.execute(text(
                        "ALTER TABLE messages ADD COLUMN scenario VARCHAR(32) DEFAULT 'chat'"
                    ))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Failed to add messages.scenario: {e}")
            try:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_messages_scenario ON messages (scenario)"
                ))
                conn.commit()
            except Exception as e:
                logger.debug(f"Index ix_messages_scenario: {e}")
        # conversations.scenario 索引
        if 'conversations' in inspector.get_table_names():
            try:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_conversations_scenario ON conversations (scenario)"
                ))
                conn.commit()
            except Exception as e:
                logger.debug(f"Index ix_conversations_scenario: {e}")


def _seed_demo():
    """Seed demo user"""
    db = SessionLocal()
    try:
        if not db.query(UserORM).first():
            demo = UserORM(
                id=1,
                name="Student",
                education_stage="high",
                stage="高中",
                direction="学业",
                language="中文",
                agent_name="张老师",
                province="",
                score=None,
                rank=None,
                target="",
                interests="",
                background="",
            )
            db.add(demo)
            db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()