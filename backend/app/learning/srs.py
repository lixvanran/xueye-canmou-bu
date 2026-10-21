"""间隔重复 (SRS) — SM-2 简化版 (v1.3.0)

为什么自己写而不用现成库
-----------------------
市面上的错题本 App 的 SRS 基本是黑盒: 复习间隔怎么算、为什么今天推这道、
答对和答错差别多大, 用户看不到也调不了。
本项目的 SRS 全部**可解释**: 每一道题的"下次什么时候复习"都能算出理由,
前端能显示"因为上次答对了, 所以 4 天后再见"。

规则
----
维护等级 level ∈ [0, 5]:

    level 0: 从没练过 / 练过但全错
    level 1: 很生疏
    level 2: 有点印象
    level 3: 大致会了
    level 4: 熟练
    level 5: 掌握(很久不复习也不会忘)

答对 ⇒ level += 1 (上限 5), 间隔按新 level 走
答错 ⇒ level = max(0, level - 2), 间隔重置 (连续错两次就退回"明天再来")

间隔表 (天):
    level 0 → 0 天 (今天还要再练)
    level 1 → 1 天
    level 2 → 2 天
    level 3 → 4 天
    level 4 → 7 天
    level 5 → 15 天
    level 5 且连续答对 ≥3 次 → 30 天 (真正掌握了)

**关键设计**: 间隔只看 level, 不看具体日期 ⇒ 可复现、可测试、无隐藏状态。
"""

from datetime import datetime, timedelta
from typing import Optional, Tuple

# level → 间隔天数
INTERVAL_DAYS = {0: 0, 1: 1, 2: 2, 3: 4, 4: 7, 5: 15}
# level 5 且连对 ≥3 次 → 真正掌握
MASTERED_INTERVAL_DAYS = 30
# 达到"真掌握"所需的连续答对次数
MASTERED_STREAK = 3

MAX_LEVEL = 5


def interval_for(level: int, streak: int = 0) -> int:
    """某个等级对应的复习间隔(天)"""
    level = max(0, min(MAX_LEVEL, int(level)))
    if level >= MAX_LEVEL and streak >= MASTERED_STREAK:
        return MASTERED_INTERVAL_DAYS
    return INTERVAL_DAYS.get(level, 1)


def next_review_at(
    level: int,
    streak: int = 0,
    now: Optional[datetime] = None,
) -> datetime:
    """算出下次复习时间"""
    now = now or datetime.now()
    return now + timedelta(days=interval_for(level, streak))


def apply_answer(
    level: int,
    streak: int,
    correct_count: int,
    wrong_count: int,
    answered_correct: bool,
    now: Optional[datetime] = None,
) -> Tuple[int, int, int, int, datetime, str]:
    """答一道题之后, 更新 (level, streak, correct, wrong, next_review_at, reason)

    Args:
        level: 复习前的等级
        streak: 复习前的连续答对次数
        correct_count / wrong_count: 复习前的累计次数
        answered_correct: 这次答对了没
        now: 当前时间 (便于测试注入)

    Returns:
        (新 level, 新 streak, 新 correct, 新 wrong, 下次复习时间, 可解释理由)
    """
    now = now or datetime.now()
    level = max(0, min(MAX_LEVEL, int(level or 0)))
    streak = max(0, int(streak or 0))
    correct_count = max(0, int(correct_count or 0))
    wrong_count = max(0, int(wrong_count or 0))

    if answered_correct:
        new_level = min(MAX_LEVEL, level + 1)
        new_streak = streak + 1
        correct_count += 1
        reason = f"答对, 掌握度 {level} → {new_level}"
    else:
        # 答错退两级 —— 连续错两次就回到 level 0 (明天必须再练)
        new_level = max(0, level - 2)
        new_streak = 0
        wrong_count += 1
        reason = f"答错, 掌握度 {level} → {new_level}"

    nxt = next_review_at(new_level, new_streak, now)
    days = (nxt - now).days
    if days == 0:
        reason += f", 今天还要再练一遍"
    else:
        reason += f", {days} 天后复习"
    return new_level, new_streak, correct_count, wrong_count, nxt, reason


def mastery_label(level: int) -> str:
    """给前端显示的掌握度文案"""
    return {
        0: "未掌握",
        1: "很生疏",
        2: "有印象",
        3: "基本会了",
        4: "熟练",
        5: "已掌握",
    }.get(max(0, min(MAX_LEVEL, int(level or 0))), "未掌握")


def mastery_color(level: int) -> str:
    """前端配色: 越低越红"""
    return {
        0: "red",
        1: "orange",
        2: "amber",
        3: "blue",
        4: "green",
        5: "emerald",
    }.get(max(0, min(MAX_LEVEL, int(level or 0))), "gray")


def is_overdue(next_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """是否到期该复习了"""
    if next_at is None:
        return False
    return next_at <= (now or datetime.now())
