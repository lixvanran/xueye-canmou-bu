"""知识点库 — 种子数据加载 + 闪卡生成 (v1.3.0)

数据来源
--------
`backend/knowledge_base/11_knowledge_points.json` —— 由脚本批量生成 + 人工校验过的
学科知识点卡 (定义/公式/易错点/常考问法/难度)。

为什么不进 RAG 的向量索引
------------------------
RAG 索引是**语义检索**(按问题找相似段落), 适合"帮我查查这个政策"。
而知识点掌握度需要**精确对齐**(这道题错在"二次函数顶点式"这个知识点上)。
语义相近 ≠ 同一个知识点 (例: "二次函数" 和 "二次函数的图像" 余弦很高, 但不是同一个标签)。
⇒ 知识点走**结构化表 + 字符串精确对齐**, RAG 走语义检索, 两条路各司其职。

闪卡怎么来的
------------
闪卡 = 知识点卡 + 该用户的掌握度。
- 用户练过这个知识点 → 用掌握度排序, 越不熟越靠前
- 用户没练过 → 按难度排, 入门优先
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.learning.srs import mastery_label

logger = logging.getLogger(__name__)

KB_DIR = Path(__file__).resolve().parent.parent.parent / "knowledge_base"
KNOWLEDGE_FILE = "11_knowledge_points.json"
# 背诵卡 (高一必修一) —— 原本藏在「张雪峰快跑」游戏里, v1.3.0 抽出来做成正经闪卡
RECITATION_FILE = "12_recitation_cards.json"

# 内存缓存 —— 种子数据不变, 不必每次读盘
_CACHE: Optional[List[Dict]] = None
_RECITATION_CACHE: Optional[List[Dict]] = None


def _read_json_list(path: Path, warn_if_missing: bool = True) -> List[Dict]:
    if not path.exists():
        if warn_if_missing:
            logger.warning(f"知识点库不存在: {path}")
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("items", [])
        return [d for d in data if isinstance(d, dict)]
    except Exception as e:
        logger.error(f"知识点库加载失败 ({path.name}): {e}")
        return []


def load_recitation_cards() -> List[Dict]:
    """读背诵卡, 转成知识点卡的统一 schema

    背诵卡原本是 {question, answer} 形态 (游戏里飘的卡片),
    这里转成 {name, summary, formula, pitfalls, exam_points} 才能跟知识点统一排序、
    统一进掌握度统计。
    """
    global _RECITATION_CACHE
    if _RECITATION_CACHE is not None:
        return _RECITATION_CACHE
    raw = _read_json_list(KB_DIR / RECITATION_FILE)
    out = []
    for i, c in enumerate(raw):
        q = (c.get("question") or "").strip()
        a = (c.get("answer") or "").strip()
        if not q:
            continue
        out.append({
            "id": c.get("id") or f"recite-{i}",
            "name": q,
            "subject": c.get("subject") or "综合",
            "stage": c.get("stage") or "高中",
            "aliases": [],
            "summary": a,
            "formula": a if len(a) < 40 and any(ch in a for ch in "=→") else None,
            "pitfalls": [],
            "exam_points": [],
            "difficulty": 2,
            "source": c.get("source") or "背诵卡",
            "_recitation": True,
        })
    _RECITATION_CACHE = out
    logger.info(f"背诵卡加载完成: {len(out)} 条")
    return out


def load_knowledge_points() -> List[Dict]:
    """读知识点种子数据 (带缓存) —— 知识点卡 + 背诵卡"""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    data = _read_json_list(KB_DIR / KNOWLEDGE_FILE)
    points = [d for d in data if d.get("name")]
    _CACHE = points + load_recitation_cards()
    logger.info(f"知识点库加载完成: {len(points)} 知识点卡 + {len(_CACHE) - len(points)} 背诵卡")
    return _CACHE


def reload_knowledge_points() -> List[Dict]:
    """强制重载 (改了种子文件后用)"""
    global _CACHE, _RECITATION_CACHE
    _CACHE = None
    _RECITATION_CACHE = None
    return load_knowledge_points()


def _char_overlap(a: str, b: str) -> float:
    """字符重叠系数 (overlap coefficient) —— 不是 Jaccard

    为什么不用 Jaccard: 查询短、卡名长时 Jaccard 会被长文本稀释
    ("二次函数顶点" vs "二次函数" 只有 4/6=0.67, 会被阈值砍掉)。
    重叠系数 = |交集| / min(|a|,|b|) ⇒ 短查询能完全命中长卡名。

    例:
      "二次函数顶点" vs "二次函数"          → 4/4 = 1.00
      "牛二"          vs "牛顿第二定律"      → 2/2 = 1.00
      "英语时态"      vs "时态与语境"        → 3/4 = 0.75
    """
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / min(len(sa), len(sb))


def search_knowledge(
    keyword: str,
    subject: Optional[str] = None,
    stage: Optional[str] = None,
    limit: int = 20,
) -> List[Dict]:
    """按名字/别名/摘要搜知识点 —— 给 LLM 的 add_mistake 归因用

    两段式:
    1) 精确子串命中 (name / summary / aliases / exam_points)
    2) 精确没命中 ⇒ 模糊兜底 (字符重合度)

    为什么要有第 2 段: 学生说的是"文言文", 库里存的是"文言实词一词多义"/
    "文言倒装与被动句" —— **学生的话不会等于标准卡名**。
    只做精确匹配 ⇒ AI 搜不到 ⇒ 掌握度记不上 ⇒ 这个功能等于没有。
    """
    kw = (keyword or "").strip().lower()
    pool = []
    for kp in load_knowledge_points():
        if subject and kp.get("subject") != subject:
            continue
        if stage and kp.get("stage") != stage:
            continue
        pool.append(kp)

    if not kw:
        return pool[:limit]

    exact = []
    for kp in pool:
        hay = " ".join([
            str(kp.get("name", "")),
            str(kp.get("summary", "")),
            " ".join(kp.get("aliases") or []),
            " ".join(kp.get("exam_points") or []),
        ]).lower()
        if kw in hay:
            exact.append(kp)
    if exact:
        return exact[:limit]

    # 模糊兜底 —— 逐字段算, 取最高分 (别把 name+summary 拼起来算, 长文本会稀释)
    kw_chars = set(kw)
    min_overlap = 2 if len(kw_chars) >= 2 else 1
    scored = []
    for kp in pool:
        fields = [str(kp.get("name", "")), str(kp.get("summary", ""))]
        fields += [str(a) for a in (kp.get("aliases") or [])]
        best = 0.0
        for f in fields:
            fl = f.lower()
            if not fl:
                continue
            ov = _char_overlap(kw, fl)
            if ov > best:
                best = ov
            if len(kw_chars & set(fl)) >= min_overlap and kw in fl:
                best = 1.0
                break
        name_chars = set(str(kp.get("name", "")).lower())
        if best >= 0.5 and len(kw_chars & name_chars) >= min_overlap:
            scored.append((best, kp))
    scored.sort(key=lambda x: (-x[0], str(x[1].get("name", ""))))
    return [kp for _, kp in scored[:limit]]


def get_by_id(kp_id: str) -> Optional[Dict]:
    for kp in load_knowledge_points():
        if kp.get("id") == kp_id:
            return kp
    return None


def list_subjects() -> List[str]:
    seen = []
    for kp in load_knowledge_points():
        s = kp.get("subject")
        if s and s not in seen:
            seen.append(s)
    return seen


def list_flashcards(
    db: Session,
    user_id: int = 1,
    subject: Optional[str] = None,
    limit: int = 30,
) -> Dict:
    """生成闪卡列表 —— 知识点卡 + 用户掌握度

    排序:
    - 练过的: 按 (等级升序, 错次降序) ⇒ 最不熟的先复习
    - 没练过的: 按难度升序 ⇒ 入门先来
    """
    from app.learning.service import list_mastery

    mastery_map = {m["kp_name"]: m for m in list_mastery(db, user_id)}
    cards = []
    for kp in load_knowledge_points():
        if subject and kp.get("subject") != subject:
            continue
        m = mastery_map.get(kp.get("name"))
        cards.append({
            "id": kp.get("id"),
            "name": kp.get("name"),
            "subject": kp.get("subject"),
            "stage": kp.get("stage"),
            "aliases": kp.get("aliases") or [],
            "summary": kp.get("summary"),
            "formula": kp.get("formula"),
            "pitfalls": kp.get("pitfalls") or [],
            "exam_points": kp.get("exam_points") or [],
            "difficulty": kp.get("difficulty", 3),
            "practiced": m is not None,
            "mastery": m["level"] if m else None,
            "mastery_label": m["label"] if m else "未练过",
            "wrong_count": m["wrong_count"] if m else 0,
            "due": bool(m and m["due"]),
        })
    practiced = [c for c in cards if c["practiced"]]
    fresh = [c for c in cards if not c["practiced"]]
    practiced.sort(key=lambda c: (c["mastery"] if c["mastery"] is not None else 9, -c["wrong_count"]))
    fresh.sort(key=lambda c: c["difficulty"])
    return {
        "items": (practiced + fresh)[:limit],
        "count": len(cards),
        "practiced_count": len(practiced),
        "total_count": len(cards),
        "subjects": list_subjects(),
    }


def stats() -> Dict:
    """知识点库自身统计"""
    kps = load_knowledge_points()
    by_subject: Dict[str, int] = {}
    by_stage: Dict[str, int] = {}
    for kp in kps:
        s = kp.get("subject") or "未知"
        st = kp.get("stage") or "未知"
        by_subject[s] = by_subject.get(s, 0) + 1
        by_stage[st] = by_stage.get(st, 0) + 1
    return {
        "total": len(kps),
        "by_subject": by_subject,
        "by_stage": by_stage,
    }
