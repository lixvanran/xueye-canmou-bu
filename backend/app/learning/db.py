"""学习主线数据层 — 错题本 / 知识点掌握度 / 模考成绩 (v1.3.0)

设计要点
--------
1. **不新建错题表**: `resources` 表早就是错题本了(type='mistake'、code='M-001'、
   error_type、knowledge_tags、mastered 全都有) ⇒ 只补 3 个 SRS 调度字段,
   不动老数据、不迁移老表。
2. **知识点主表也不建**: 知识点名来自 LLM 产出的 `knowledge_tags`(自由文本),
   掌握度直接按知识点名字符串做 key ⇒ 新学科、新考点零成本接入。
3. **模考单独一张表**: "一次考试"是独立实体(日期+科目+分数+各题失分),
   跟单道错题不同层级。

新表
----
- `kp_mastery`  知识点掌握度 (user_id + kp_name 是主键语义)
- `exam_scores` 模考成绩
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)

from app.db.database import Base


# ========== 知识点掌握度 ==========

class KPMasteryORM(Base):
    """每个用户在每个知识点上的掌握度

    level 是 SM-2 风格的 0-5:
      0 = 从没练过 / 练过但全错
      1-2 = 薄弱
      3 = 一般
      4 = 熟练
      5 = 掌握(长时间不复习也不会忘)

    同一 (user_id, kp_name) 只有一行 ⇒ 重复答同一知识点是**更新**不是新增。
    """

    __tablename__ = "kp_mastery"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False, default=1)
    # 知识点名 (与 resources.knowledge_tags 里的字符串对齐)
    kp_name = Column(String(128), index=True, nullable=False)
    subject = Column(String(32), nullable=True, index=True)

    # 掌握等级 0-5
    level = Column(Integer, nullable=False, default=0)
    # 累计对/错次数
    correct_count = Column(Integer, nullable=False, default=0)
    wrong_count = Column(Integer, nullable=False, default=0)
    # 连续答对次数 (答错清零) —— 比累计正确率更抗噪
    streak = Column(Integer, nullable=False, default=0)

    # 下次该复习的时间 (SRS 调度) —— null = 还没排期
    next_review_at = Column(DateTime, nullable=True, index=True)
    last_reviewed_at = Column(DateTime, nullable=True)
    # 首次出错时间 —— 用于"这个坑我踩了多久了"
    first_wrong_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== 模考成绩 ==========

class ExamScoreORM(Base):
    """一次考试/模考的成绩记录

    detail 存各题失分明细, 格式:
        [{"q": "第3题", "kp": "二次函数", "lost": 8, "total": 12, "why": "计算错误"}]
    有了它才能做 "这次丢的 23 分丢在哪" 的归因。
    """

    __tablename__ = "exam_scores"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False, default=1)
    # 考试名, 如 "高一上期中" "中考一模"
    name = Column(String(128), nullable=False)
    subject = Column(String(32), nullable=True, index=True)
    exam_date = Column(Date, nullable=True, index=True)
    # 得分 / 满分
    score = Column(Float, nullable=True)
    total = Column(Float, nullable=True)
    # 班级/年级排名 (可选)
    rank = Column(Integer, nullable=True)
    # 各题失分明细 (JSON)
    detail = Column(JSON, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# ========== 给 resources(错题本) 补的 SRS 字段 ==========

# v1.3.0 新增列 —— 迁移脚本按这个列表 ALTER TABLE
RESOURCE_SRS_COLUMNS = [
    # 已复习次数
    ("review_count", "INTEGER", "0"),
    # 下次该复习这条错题的时间
    ("next_review_at", "DATETIME", None),
    # 上次复习时间
    ("last_reviewed_at", "DATETIME", None),
]
