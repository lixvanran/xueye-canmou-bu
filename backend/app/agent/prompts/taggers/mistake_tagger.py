"""错题自动打标 — v2.0 知识图谱核心组件
- 用 LLM 给错题打 3-5 个细粒度知识点标签 + 难度等级
- 调用入口:
    - POST /api/resources/create (type=mistake) 时自动触发 (resources.py)
    - 前端"重新分析"按钮 (POST /api/resources/{id}/retag, 见 resources.py)
- 失败兜底: 返回空 tags + difficulty=3, **绝不抛异常**

设计原则:
  - 单次 LLM 调用, 同时拿 tags 和 difficulty (省 token)
  - 严格 JSON 输出, 解析失败就降级
  - prompt 极简 — 只问"这是哪几个知识点, 难度几", 不掺杂讲题内容
"""
from __future__ import annotations
import json
import logging
import re
from typing import List, Tuple, Optional

from app.agent.llm.openrouter import llm_client

logger = logging.getLogger(__name__)


_TAGGER_PROMPT = """你是错题分析助手。给题目打 3-5 个细粒度知识点标签 + 评估难度。

## 输入
- 学科: {subject}
- 标题: {title}
- 题目内容: {content}

## 任务
1. 知识点标签 (3-5 个, 短, 2-6 字):
   - 粒度要细, 如 ["二次函数", "顶点公式", "对称轴"] 比 ["函数"] 信息量大
   - 优先用教材标准命名
   - 避免 ["数学", "高中"] 这种泛化词
2. 难度 (1-5):
   - 1=入门 (基础概念直接套)
   - 2=易 (单知识点, 1 步)
   - 3=中 (单知识点, 多步或综合) ← 默认
   - 4=难 (多知识点, 套路)
   - 5=竞赛 (压轴, 创新)

## 输出格式 (严格 JSON, 不要其他内容)
{{"tags": ["...", "...", "..."], "difficulty": 3}}
"""


def _extract_json(raw: str) -> Optional[dict]:
    """从 LLM 输出里抠 JSON — 容错: 即使夹杂 ```json 围栏/前置文字也能解析"""
    if not raw:
        return None
    # 去掉 markdown 代码围栏
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw.strip())
    # 抠 { ... } 第一段
    m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", raw)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


async def tag_mistake(
    title: str,
    content: str,
    subject: str = "",
) -> Tuple[List[str], int]:
    """给错题打知识点标签 + 难度

    Args:
        title: 错题标题
        content: 错题内容 (题目原文, 可空)
        subject: 学科 (数学/语文/..., 可空)

    Returns:
        (tags: list[str], difficulty: int 1-5)
        失败/异常时 → ([], 3)
    """
    # 兜底: 内容太短就别浪费 LLM token 了
    if not title and not content:
        return [], 3

    try:
        prompt = _TAGGER_PROMPT.format(
            subject=subject or "未指定",
            title=(title or "(无标题)")[:200],
            content=(content or "(无内容)")[:1500],
        )
        result = await llm_client.chat(
            messages=[
                {"role": "system", "content": "你只输出 JSON, 严禁其他文字。"},
                {"role": "user", "content": prompt},
            ]
        )
        raw = result.get("content", "") if isinstance(result, dict) else ""
        parsed = _extract_json(raw)
        if not parsed:
            logger.warning(f"mistake_tagger: failed to parse JSON from LLM: {raw[:200]}")
            return [], 3

        raw_tags = parsed.get("tags") or []
        if not isinstance(raw_tags, list):
            return [], 3

        # 清洗: strip / 去空 / 去重保序 / 限长
        seen = set()
        tags: List[str] = []
        for t in raw_tags:
            if not isinstance(t, str):
                continue
            t = t.strip()
            if not t or len(t) > 16:
                continue
            if t in seen:
                continue
            seen.add(t)
            tags.append(t)
            if len(tags) >= 5:
                break

        # 难度 — 严格 1-5
        try:
            difficulty = int(parsed.get("difficulty", 3))
        except Exception:
            difficulty = 3
        difficulty = max(1, min(5, difficulty))

        logger.info(
            f"mistake_tagger: tags={tags} difficulty={difficulty} "
            f"(subject={subject}, title={title[:30]})"
        )
        return tags, difficulty

    except Exception as e:
        # 兜底: 不抛异常, 返回空 tags + 默认难度
        logger.warning(f"mistake_tagger LLM call failed (non-fatal): {e}")
        return [], 3