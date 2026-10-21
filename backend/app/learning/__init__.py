"""学习主线 (Learning Track) — 面向"中学生应对中高考"

v1.3.0 新增。这个包是产品从"高考志愿填报工具"转向"日常学业助手"的主线载体。

模块:
- db.py        知识点掌握度 / 模考成绩 ORM (+ 错题本 SRS 字段定义)
- srs.py       间隔重复算法 (可解释, 不黑盒)
- service.py   业务逻辑: 错题 → 归因 → 掌握度 → 复习队列 → 复习 → 掌握度再更新
- knowledge.py 知识点库加载 + 闪卡生成
"""
from app.learning.db import KPMasteryORM, ExamScoreORM  # noqa: F401
from app.learning import srs, service, knowledge  # noqa: F401

__all__ = ["KPMasteryORM", "ExamScoreORM", "srs", "service", "knowledge"]
