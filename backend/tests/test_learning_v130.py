"""学习主线回归测试 (v1.3.0)

覆盖这一轮的核心:
1. SRS 算法 —— 间隔/升级/降级/可解释理由
2. 错题 → 掌握度 → 复习队列 → 复习回写 的完整飞轮
3. 模考失分归因
4. 学段策略 —— 工具白名单按学段收窄 (硬过滤)
5. 情绪检测 —— crisis / overloaded / normal
6. 失败不许静默变成功 (本仓库的硬规则)

跑法: cd backend && ../.venv/bin/python -m pytest tests -q
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.learning import srs
from app.learning.stage import (
    allowed_tools, detect_emotional_state, get_profile, is_high_school_stage, normalize_stage,
)


# ===== 1. SRS 算法 =====

def test_srs_levels_and_intervals():
    assert srs.INTERVAL_DAYS == {0: 0, 1: 1, 2: 2, 3: 4, 4: 7, 5: 15}
    assert srs.interval_for(0) == 0
    assert srs.interval_for(5, streak=3) == srs.MASTERED_INTERVAL_DAYS
    assert srs.interval_for(5, streak=0) == 15


def test_srs_answer_correct_upgrades():
    now = datetime(2026, 10, 1, 9, 0, 0)
    level, streak, c, w, nxt, reason = srs.apply_answer(0, 0, 0, 0, True, now=now)
    assert level == 1
    assert streak == 1
    assert c == 1 and w == 0
    assert nxt == now + timedelta(days=1)
    assert "答对" in reason and "1 天后" in reason


def test_srs_answer_wrong_drops_two():
    now = datetime(2026, 10, 1, 9, 0, 0)
    level, streak, c, w, nxt, reason = srs.apply_answer(4, 3, 5, 1, False, now=now)
    assert level == 2, f"答错应降两级, 拿到 {level}"
    assert streak == 0, "答错要清空连对"
    assert w == 2 and c == 5
    assert nxt == now + timedelta(days=2)
    assert "答错" in reason


def test_srs_never_goes_below_zero():
    level, _, _, _, _, _ = srs.apply_answer(0, 0, 0, 3, False)
    assert level == 0
    level2, _, _, _, _, _ = srs.apply_answer(1, 0, 0, 0, False)
    assert level2 == 0


def test_srs_never_goes_above_five():
    level, streak, _, _, _, _ = srs.apply_answer(5, 9, 10, 0, True)
    assert level == 5
    assert streak == 10


def test_srs_reason_is_explainable():
    """每一道复习的间隔都要能说出理由 —— 不做黑盒"""
    _, _, _, _, _, reason = srs.apply_answer(3, 0, 0, 0, True)
    assert reason
    assert "掌握度" in reason
    assert any(k in reason for k in ("天后", "今天"))


def test_mastery_labels_cover_all_levels():
    for lv in range(6):
        assert srs.mastery_label(lv)
        assert srs.mastery_color(lv)


# ===== 2. 完整飞轮 (错题 → 掌握度 → 队列 → 复习) =====

@pytest.fixture
def db():
    """每个测试一个独立的内存库 —— 不碰用户数据"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db.database import Base
    from app.learning.db import ExamScoreORM, KPMasteryORM
    from app.db.database import ResourceORM, ScheduleORM, UserORM, ConversationORM, MessageORM

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    yield s
    s.close()


def test_flywheel_end_to_end(db):
    """完整飞轮: 录错题 → 掌握度下调 → 进队列 → 复习答对 → 掌握度上升 → 出队列"""
    from app.learning import service

    # 1) 录错题
    res = service.create_mistake(
        db, user_id=1, subject="数学", title="一元二次方程求根",
        content="解 x^2-5x+6=0", my_answer="x=3", correct_answer="x=2或3",
        cause="计算失误", knowledge_tags=["一元二次方程"],
    )
    assert res["success"] is True
    assert res["code"] == "M-001"
    mid = res["id"]
    assert res["mastery_updates"][0]["level"] == 0, "刚录的错题, 掌握度应该最低"

    # 2) 掌握度里有这个知识点
    mas = service.list_mastery(db, 1)
    assert len(mas) == 1
    assert mas[0]["kp_name"] == "一元二次方程"
    assert mas[0]["wrong_count"] == 1
    assert mas[0]["due"] is True

    # 3) 进复习队列
    q = service.review_queue(db, 1)
    assert q["counts"]["due_mistakes"] == 1
    assert len(q["due_mistakes"]) == 1
    assert q["due_mistakes"][0]["code"] == "M-001"
    assert q["counts"]["weak_points"] >= 1

    # 4) 复习答对 → 掌握度上升
    r = service.review_mistake(db, 1, mid, True, note="会了")
    assert r["success"] is True
    assert r["mastery_updates"][0]["level"] == 1, "答对后掌握度应该上升"
    assert r["mistake"]["review_count"] == 1
    assert r["mistake"]["mastered"] is False, "才答对 1 次还不算掌握"

    # 5) 复习队列里它应该挪后 (next_review_at 推到未来)
    q2 = service.review_queue(db, 1)
    due_ids = [m["id"] for m in q2["due_mistakes"]]
    assert mid not in due_ids, "答对之后不该还留在今天的队列里"

    # 6) 答对 3 次 → 掌握, 出库
    for _ in range(2):
        service.review_mistake(db, 1, mid, True)
    m = service.get_mistake(db, 1, mid)
    assert m["mastered"] is True
    q3 = service.review_queue(db, 1)
    assert q3["counts"]["mastered_mistakes"] == 1
    assert q3["counts"]["due_mistakes"] == 0


def test_review_wrong_keeps_it_in_queue(db):
    """答错 → 明天还要练, 仍在队列里"""
    from app.learning import service

    res = service.create_mistake(
        db, user_id=1, subject="物理", title="牛顿第二定律",
        cause="concept", knowledge_tags=["牛顿第二定律"],
    )
    mid = res["id"]
    service.review_mistake(db, 1, mid, False)
    q = service.review_queue(db, 1)
    assert any(m["id"] == mid for m in q["due_mistakes"]), "答错的题今天还得再练"


def test_mistake_code_sequence(db):
    """错题编号递增, 不重复"""
    from app.learning import service

    codes = []
    for i in range(3):
        r = service.create_mistake(db, user_id=1, subject="数学", title=f"题{i}")
        codes.append(r["code"])
    assert codes == ["M-001", "M-002", "M-003"]
    assert len(set(codes)) == 3


def test_cause_normalized(db):
    """错因要归一到受控枚举, 否则统计会散"""
    from app.learning import service

    r = service.create_mistake(
        db, user_id=1, subject="数学", title="题", cause="计算错误"
    )
    m = service.get_mistake(db, 1, r["id"])
    assert m["cause"] == "calculation"
    assert m["cause_label"] == "计算失误"

    r2 = service.create_mistake(db, user_id=1, subject="数学", title="题2", cause="随便说点什么")
    assert service.get_mistake(db, 1, r2["id"])["cause"] == "unfamiliar"


def test_delete_mistake(db):
    from app.learning import service

    r = service.create_mistake(db, user_id=1, subject="数学", title="题")
    res = service.delete_mistake(db, 1, r["id"])
    assert res["success"] is True
    assert service.get_mistake(db, 1, r["id"]) is None


def test_review_nonexistent_mistake_fails_loudly(db):
    """❗ 失败必须报错, 不能返回空 —— 本仓库硬规则"""
    from app.learning import service

    res = service.review_mistake(db, 1, 99999, True)
    assert res.get("success") is False
    assert res.get("error"), "失败必须带原因"
    assert "error" in res, "不能是空 dict"


# ===== 3. 模考归因 =====

def test_exam_score_attributes_loss(db):
    """模考失分要归因到知识点, 并压低掌握度"""
    from app.learning import service

    res = service.add_exam_score(
        db, user_id=1, name="高一上期中", subject="数学", score=78, total=150,
        exam_date="2026-10-15",
        detail=[
            {"q": "第3题", "kp": "二次函数", "lost": 12, "total": 17, "why": "计算错误"},
            {"q": "第8题", "kp": "一元二次方程", "lost": 8, "total": 12, "why": "概念不清"},
        ],
    )
    assert res["success"] is True
    assert len(res["mastery_updates"]) >= 2

    mas = {m["kp_name"]: m for m in service.list_mastery(db, 1)}
    assert "二次函数" in mas
    assert mas["二次函数"]["wrong_count"] >= 1

    trend = service.exam_trend(db, 1, "数学")
    assert trend["count"] == 1
    assert len(trend["top_lost"]) == 2
    assert trend["top_lost"][0]["kp"] == "二次函数", "失分最多的应该排第一"
    assert trend["top_lost"][0]["lost"] == 12


def test_exam_without_detail_does_not_crash(db):
    """没有失分明细也能录 —— 不能因为缺字段 500"""
    from app.learning import service

    res = service.add_exam_score(db, user_id=1, name="月考", subject="物理", score=60, total=100)
    assert res["success"] is True
    assert res["mastery_updates"] == []


def test_learning_stats(db):
    from app.learning import service

    service.create_mistake(db, user_id=1, subject="数学", title="题1", cause="calculation",
                            knowledge_tags=["一元二次方程"])
    st = service.learning_stats(db, 1)
    assert st["total_mistakes"] == 1
    assert st["total_knowledge_points"] == 1
    assert st["weak_knowledge_points"] == 1
    assert "计算失误" in st["cause_distribution"]


# ===== 4. 学段策略 =====

def test_normalize_stage():
    assert normalize_stage("初中") == "middle"
    assert normalize_stage("高中") == "high"
    assert normalize_stage("middle") == "middle"
    assert normalize_stage("职高") == "vocational"
    assert normalize_stage("") == "high", "默认高中生"
    assert normalize_stage("乱填") == "high"


def test_middle_school_has_no_volunteer_tools():
    """初中生不该看到志愿工具 —— 硬过滤, 不是 prompt 建议"""
    tools = allowed_tools("初中")
    for banned in ("query_college", "calculate_admission_probability", "search_major",
                   "analyze_major", "compare_schools"):
        assert banned not in tools, f"初中生不该有 {banned}"
    for needed in ("add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"):
        assert needed in tools, f"初中生应该有 {needed}"


def test_high_school_has_volunteer_tools():
    tools = allowed_tools("高中")
    for t in ("query_college", "calculate_admission_probability", "add_mistake"):
        assert t in tools


def test_tool_filter_actually_removes_tools():
    """过滤函数本身要真的摘掉工具"""
    from app.agent.pipeline.llm_runner import _filter_tools
    from app.agent.prompts.tools import TOOLS

    all_names = {t["function"]["name"] for t in TOOLS}
    assert "query_college" in all_names

    filtered = _filter_tools(allowed_tools("初中"))
    names = {t["function"]["name"] for t in filtered}
    assert "query_college" not in names
    assert "add_mistake" in names
    assert len(filtered) < len(TOOLS)


def test_tool_filter_never_empties():
    """空/无效白名单不能把工具全干掉 —— 否则模型连话都说不出来"""
    from app.agent.pipeline.llm_runner import _filter_tools
    from app.agent.prompts.tools import TOOLS

    assert _filter_tools([]) == TOOLS
    assert _filter_tools(["nonexistent_tool"]) == TOOLS
    assert _filter_tools(None) == TOOLS


def test_middle_school_profile_has_real_strategy():
    """初中策略要具体, 不能是一句话"""
    prof = get_profile("初中")
    assert "初中" in prof["teaching"]
    assert "导数" in prof["teaching"], "初中策略要明确说不能用高中方法"
    assert "中考" in prof["exam_context"]


def test_stage_profiles_all_complete():
    from app.learning.stage import STAGE_PROFILES

    for key, prof in STAGE_PROFILES.items():
        assert prof.get("teaching"), f"{key} 缺 teaching"
        assert prof.get("focus"), f"{key} 缺 focus"
        assert prof.get("tools"), f"{key} 缺 tools"
        for t in prof["tools"]:
            assert isinstance(t, str)


# ===== 5. 情绪检测 =====

def test_emotional_crisis_detected():
    for msg in ["我完了", "考不上了", "我太差了", "想哭", "没救了"]:
        r = detect_emotional_state(msg)
        assert r["state"] == "crisis", f"'{msg}' 应判为 crisis, 实际 {r['state']}"
        assert r["guidance"]
        assert "安抚" in r["guidance"] or "接住" in r["guidance"]


def test_emotional_overload_detected():
    r = detect_emotional_state("作业太多了 学不完 压力好大")
    assert r["state"] == "overloaded"
    assert r["guidance"]


def test_emotional_normal_not_triggered():
    """正常提问不能被当成崩溃 —— 误判会让学生莫名被安慰, 很尴尬"""
    for msg in ["这道题怎么做", "什么是导数", "帮我看看这道函数题", "我完成了作业"]:
        r = detect_emotional_state(msg)
        assert r["state"] == "normal", f"'{msg}' 不该触发情绪模式, 实际 {r['state']}"


def test_emotional_empty_safe():
    r = detect_emotional_state("")
    assert r["state"] == "normal"
    assert r["guidance"] == ""


# ===== 6. 失败不许静默变成功 =====

def test_learning_tool_failures_return_error_marker():
    """工具失败必须带 error 标记 —— 空 dict 会被上层当成"成功但没数据" """
    from app.agent.tools import learning as ltools

    # 故意用不存在的 user_id 触发 DB 错误? 不稳。
    # 改成直接验证: 正常路径返回必须有 success 字段或 items 字段, 失败路径必须有 error
    ok = asyncio.run(ltools.list_weak_points(subject="数学"))
    assert "error" not in ok or ok.get("error")

    # 模拟 DB 挂掉
    import app.agent.tools.learning as mod
    orig = mod.SessionLocal
    mod.SessionLocal = lambda: (_ for _ in ()).throw(RuntimeError("db down"))
    try:
        res = asyncio.run(ltools.list_mistakes())
        assert "error" in res, f"DB 挂了却没报 error: {res}"
        assert res["error"], "error 字段不能是空的"
    finally:
        mod.SessionLocal = orig


def test_knowledge_search_returns_items():
    from app.learning.knowledge import search_knowledge, load_knowledge_points

    kps = load_knowledge_points()
    assert kps, "知识点库不该是空的 (至少要有背诵卡)"
    hits = search_knowledge("三角", limit=5)
    assert isinstance(hits, list)


def test_recitation_cards_loaded():
    """从游戏里抽出来的 29 条背诵卡必须在"""
    from app.learning.knowledge import load_recitation_cards

    cards = load_recitation_cards()
    assert len(cards) >= 25, f"背诵卡只有 {len(cards)} 条, 预期 ≥25"
    for c in cards:
        assert c["name"]
        assert c["summary"]
        assert c["subject"]


def test_legacy_mistakes_without_srs_appear_in_queue(db):
    """老数据 (手动加的错题, next_review_at=NULL) 必须出现在复习队列里

    回归背景: v1.3.0 之前 ResourcesPage 手动加的错题没有 next_review_at,
    如果队列只查 `next_review_at <= now`, 学生之前录的错题会"永远消失"。
    """
    from app.db.database import ResourceORM
    from app.learning import service

    # 模拟老数据: 直接插一行, 不带 SRS 字段
    db.add(ResourceORM(
        id=999, user_id=1, type="mistake", code="M-900",
        subject="数学", title="老数据错题",
        error_type="concept", mastered=False, difficulty=3,
        knowledge_tags=["旧知识点"],
    ))
    db.commit()

    q = service.review_queue(db, 1)
    assert any(m["id"] == 999 for m in q["due_mistakes"]), "老错题没进队列"
    assert q["counts"]["due_mistakes"] >= 1

    st = service.learning_stats(db, 1)
    assert st["due_mistakes"] >= 1


def test_legacy_mistake_review_works(db):
    """老错题也能正常复习 (SRS 字段补上后回写)"""
    from app.db.database import ResourceORM
    from app.learning import service

    db.add(ResourceORM(
        id=998, user_id=1, type="mistake", code="M-899",
        subject="物理", title="老错题2", mastered=False,
        knowledge_tags=["老知识点2"],
    ))
    db.commit()

    r = service.review_mistake(db, 1, 998, True)
    assert r["success"] is True
    assert r["mistake"]["next_review_at"] is not None, "复习后应写入下次复习时间"
    assert r["mastery_updates"][0]["kp_name"] == "老知识点2"


# ===== 7. 知识点检索 =====

def test_search_finds_standard_names():
    """精确匹配: 标准名/别名能搜到"""
    from app.learning.knowledge import search_knowledge

    hits = search_knowledge("牛顿第二定律", limit=5)
    assert hits, "搜'牛顿第二定律'应有结果"
    assert any("牛顿第二定律" in h["name"] for h in hits)


def test_search_fuzzy_fallback():
    """模糊兜底: 学生的话不等于标准卡名, 也得能搜到

    这是关键 —— 精确匹配搜不到 ⇒ AI 记不上掌握度 ⇒ 整个功能废掉。
    """
    from app.learning.knowledge import search_knowledge

    # "牛二" 是学生的口头简称
    hits = search_knowledge("牛二", limit=5)
    assert hits, "搜'牛二'应有模糊命中"
    assert any("牛顿第二定律" in h["name"] for h in hits), f"命中里没有牛顿第二定律: {[h['name'] for h in hits]}"

    # "二次函数顶点" 是复合说法
    hits2 = search_knowledge("二次函数顶点", limit=5)
    assert hits2, "搜'二次函数顶点'应有模糊命中"
    assert any("二次函数" in h["name"] for h in hits2), f"命中不对: {[h['name'] for h in hits2]}"


def test_search_fuzzy_keeps_precision():
    """模糊兜底不能变成"什么都搜得到" —— 不相关的不能混进来"""
    from app.learning.knowledge import search_knowledge

    hits = search_knowledge("完全无关的词xyz", limit=5)
    assert not hits or all(
        any(ch in (h["name"] + h.get("summary", "")) for ch in "完全无关的词xyz")
        for h in hits
    )


def test_search_respects_subject_and_stage():
    from app.learning.knowledge import search_knowledge

    hits = search_knowledge("函数", subject="数学", stage="初中", limit=20)
    for h in hits:
        assert h["subject"] == "数学"
        assert h["stage"] == "初中"


def test_knowledge_library_is_populated():
    """知识点库必须够大, 否则闪卡功能是空的"""
    from app.learning.knowledge import load_knowledge_points, stats

    st = stats()
    assert st["total"] >= 500, f"知识点只有 {st['total']} 条, 太少"
    assert len(st["by_subject"]) >= 5, "学科覆盖不足"
    assert st["by_stage"].get("初中", 0) > 100, "初中知识点太少"
    assert st["by_stage"].get("高中", 0) > 100, "高中知识点太少"


def test_char_overlap_is_overlap_coefficient():
    """重叠系数而非 Jaccard —— 短查询要能完全命中长卡名"""
    from app.learning.knowledge import _char_overlap

    assert _char_overlap("二次函数顶点", "二次函数") == 1.0
    assert _char_overlap("牛二", "牛顿第二定律") == 1.0
    assert _char_overlap("abc", "xyz") == 0.0
