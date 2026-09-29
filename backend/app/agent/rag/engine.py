"""RAG 引擎 - 入口 AgentRAG
组合 tokenizer / indexer / ranker / boost, 提供对外 API
"""
import json
import logging
import re as _re
from typing import List, Dict, Any, Optional
from pathlib import Path

from app.core.config import settings
from app.agent.rag.tokenizer import tokenize
from app.agent.rag.indexer import EmbeddingService
from app.agent.rag.ranker import cosine, keyword_score
from app.agent.rag.boost import maybe_apply_boost

logger = logging.getLogger(__name__)


# 知识库每类 item 的"索引文本"提取规则
# v0.8.0: 重做后的 KB 文件名 + 字段, 替代旧的 admission/career/cities/colleges/life_kb/majors/policy/strategy/zhang_quotes/zhang_strategy_2026
KB_INDEX_FIELD = {
    # ===== v0.8.0 新 KB schema =====
    "01_persona": lambda item: f"{item.get('name', '')} {item.get('type', '')} {item.get('core', '')} {item.get('summary', '')} {' '.join(item.get('tags', []))}",
    "02_quotes": lambda item: f"{item.get('category', '')} {item.get('text', '')} {item.get('context', '')} {' '.join(item.get('tags', []))}",
    "03_majors": lambda item: f"{item.get('name', '')} {item.get('category_zh', '')} {item.get('sub_category', '')} {item.get('comment', '')} {item.get('warning', '')} {item.get('tags', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    "04_universities": lambda item: f"{item.get('name', '')} {item.get('city', '')} {item.get('tier', '')} {item.get('features', '')} {' '.join(item.get('famous_majors', []))} {item.get('teacher_comment', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    "05_volunteer_strategy": lambda item: f"{item.get('text', '')} {item.get('name', '')} {item.get('content', '')} {item.get('context', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    "06_career_employment": lambda item: f"{item.get('text', '')} {item.get('title', '')} {item.get('content', '')} {item.get('context', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    "07_life_study": lambda item: f"{item.get('text', '')} {item.get('title', '')} {item.get('content', '')} {item.get('context', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    # ===== v0.8.0: 借鉴参考项目新增的 2 个 KB =====
    "08_admission_scores": lambda item: f"{item.get('school_name', '')} {item.get('province', '')} {item.get('subject_type', '')} {item.get('batch', '')} {item.get('min_score', '')} {item.get('min_rank', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    "09_policies": lambda item: f"{item.get('name', '')} {item.get('type', '')} {item.get('summary', '')} {' '.join(item.get('key_points', []))} {item.get('scope', '')} {item.get('teacher_comment', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
    # ===== v0.9.8: 集成 2 个开源 KB (CC BY 4.0 + MIT, 124 篇高质量内容) =====
    "10_external_kb": lambda item: f"{item.get('text', '')} {item.get('context', '')} {' '.join(item.get('tags', []) if isinstance(item.get('tags'), list) else [])}",
}


# 知识库每类 item 的"展示文本"提取规则
KB_DISPLAY_FIELD = {
    "01_persona": lambda item: f"[{item.get('type', 'persona')}] {item.get('name', '')}" + (f"\n核心: {item.get('core', '')}" if item.get('core') else f"\n{item.get('summary', '')[:200]}"),
    "02_quotes": lambda item: f"[{item.get('category', '语录')}] \"{item.get('text', '')}\"\n场景: {item.get('context', '')}",
    "03_majors": lambda item: f"专业: {item.get('name')} ({item.get('category_zh', '')})\n就业率: {item.get('employment_rate', '?')} | 月薪: {item.get('median_salary', '?')} | 考研: {item.get('grad_school_ratio', '?')}\n张雪峰点评: {item.get('comment', '')}",
    "04_universities": lambda item: f"院校: {item.get('name')} ({item.get('tier', '')})\n城市: {item.get('city')} | 最低分(2024): {item.get('min_score_2024', '?')} | 位次: {item.get('min_rank_2024', '?')}\n特色: {item.get('features', '')}\n王炸专业: {', '.join(item.get('famous_majors', []))}\n张雪峰点评: {item.get('teacher_comment', '')}",
    "05_volunteer_strategy": lambda item: f"[{item.get('type', '策略')}] {item.get('name') or item.get('text', '')[:50]}\n{item.get('content') or item.get('text', '')}",
    "06_career_employment": lambda item: f"[{item.get('type', '就业')}] {item.get('title') or item.get('text', '')[:50]}\n{item.get('content') or item.get('text', '')}",
    "07_life_study": lambda item: f"[{item.get('category') or item.get('type', '人生')}] {item.get('title') or item.get('text', '')[:50]}\n{item.get('content') or item.get('text', '')}",
    "08_admission_scores": lambda item: f"录取数据: {item.get('school_name')} {item.get('province')} {item.get('subject_type', '')} {item.get('year')}年\n最低分: {item.get('min_score', '?')} | 平均分: {item.get('avg_score', '?')} | 最高分: {item.get('max_score', '?')} | 最低位次: {item.get('min_rank', '?')}",
    "09_policies": lambda item: f"[{item.get('type', '政策')}] {item.get('name')}\n{item.get('summary', '')}\n要点: {'; '.join(item.get('key_points', [])[:3])}\n张雪峰点评: {item.get('teacher_comment', '')}",
    "10_external_kb": lambda item: f"[{item.get('topic', '外部KB')}] {item.get('context', '')[:80]}\n{item.get('text', '')}" + (f"\n[来源: {item.get('source', '?')} / {item.get('license', '?')}]" if item.get('source') else ""),
}


class AgentRAG:
    """In-memory RAG with persistent JSON storage"""

    def __init__(self):
        self.embedding = EmbeddingService()
        self.knowledge_base = self._load_kb()
        self.store_path = settings.CHROMA_DIR / "user_index.json"
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self.user_index: Dict[str, Dict[str, Dict]] = self._load_user_index()
        logger.info(f"RAG initialized: {len(self.user_index)} users indexed")

    # ========== 加载/持久化 ==========

    def _load_user_index(self) -> Dict:
        if self.store_path.exists():
            try:
                return json.loads(self.store_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to load user index: {e}")
        return {}

    def _save_user_index(self):
        try:
            self.store_path.write_text(
                json.dumps(self.user_index, ensure_ascii=False),
                encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"Failed to save user index: {e}")

    def _load_kb(self) -> Dict:
        kb_dir = settings.KNOWLEDGE_BASE_DIR
        kb = {}
        # v0.7.8: Auto-discover and load ALL *.json files in knowledge_base/
        for fp in sorted(kb_dir.glob("*.json")):
            try:
                kb[fp.stem] = json.loads(fp.read_text(encoding="utf-8"))
                logger.info(f"Loaded KB: {fp.stem} ({len(kb[fp.stem])} items)")
            except Exception as e:
                logger.warning(f"Failed to load {fp.name}: {e}")
        return kb

    # ========== 用户资源 CRUD ==========

    def add_resource(self, resource_id: int, content: str, metadata: Dict = None) -> bool:
        if not content and not metadata:
            return False
        try:
            text_for_index = content or (metadata or {}).get("title", "")
            if not text_for_index:
                return False
            # 同步入口 — 实际项目里调 RAG 的都是 sync (上传/编辑时)
            embedding = self.embedding.embed(text_for_index)
            meta = dict(metadata or {})
            meta["resource_id"] = str(resource_id)
            meta["content_text"] = text_for_index
            meta["embedding_mode"] = self.embedding.mode
            user_id = str(meta.get("user_id", "0"))
            if user_id not in self.user_index:
                self.user_index[user_id] = {}
            self.user_index[user_id][str(resource_id)] = {
                "content": text_for_index,
                "metadata": meta,
                "embedding": embedding,
            }
            self._save_user_index()
            logger.info(f"Added resource {resource_id} (user {user_id}) to RAG: {meta.get('code', '?')} ({self.embedding.mode})")
            return True
        except Exception as e:
            logger.error(f"Failed to add resource: {e}")
            return False

    def update_resource(self, resource_id: int, content: str, metadata: Dict = None) -> bool:
        self.delete_resource(resource_id)
        return self.add_resource(resource_id, content, metadata)

    def delete_resource(self, resource_id: int):
        try:
            for user_id, items in self.user_index.items():
                if str(resource_id) in items:
                    del items[str(resource_id)]
            self._save_user_index()
            return True
        except Exception as e:
            logger.error(f"Delete failed: {e}")
        return False

    # ========== 搜索 ==========

    def search_user_resources(
        self,
        query: str,
        user_id: int,
        top_k: int = 3,
        resource_type: str = None,
        tracer = None,  # v0.1: RAG tracer
    ) -> List[Dict]:
        """搜索用户资源 (按 cosine 相似度 + code 精确匹配 boost)"""
        user_id = str(user_id)
        user_items = self.user_index.get(user_id, {})
        if not user_items:
            if tracer:
                tracer.add_stage("user_search",
                    f"user_id={user_id}, query={query!r}",
                    "0 items (no user index)",
                    {"user_id": user_id, "matched": 0, "indexed": 0})
            return []
        # 兼容 M002 和 M-002
        query_codes = set(m.upper() for m in _re.findall(r"[MS]-?\d+", query or ""))
        try:
            query_emb = self.embedding.embed(query)
            scored = []
            skipped_dim = 0
            for rid, item in user_items.items():
                if resource_type and item["metadata"].get("type") != resource_type:
                    continue
                if len(item["embedding"]) != len(query_emb):
                    skipped_dim += 1
                    continue
                score = cosine(query_emb, item["embedding"])
                item_code = (item["metadata"].get("code") or "").upper()
                if item_code and item_code in query_codes:
                    score += 1.0  # code 精确匹配 boost
                if score > 0.01:
                    scored.append({
                        "content": item["content"],
                        "metadata": item["metadata"],
                        "score": score,
                    })
            scored.sort(key=lambda x: x["score"], reverse=True)
            top = scored[:top_k]
            if tracer:
                tracer.add_stage("user_search",
                    f"query={query!r}, user_id={user_id}, top_k={top_k}",
                    f"{len(top)} hits / {len(scored)} candidates / {len(user_items)} indexed",
                    {
                        "query_codes_matched": list(query_codes),
                        "indexed_total": len(user_items),
                        "skipped_dim_mismatch": skipped_dim,
                        "scored_count": len(scored),
                        "top_hits": [
                            {
                                "code": r["metadata"].get("code"),
                                "title": r["metadata"].get("title", "")[:30],
                                "type": r["metadata"].get("type"),
                                "score": round(r["score"], 4),
                            }
                            for r in top
                        ],
                    })
            return top
        except Exception as e:
            logger.error(f"Search failed: {e}")
            if tracer:
                tracer.add_stage("user_search", f"query={query!r}", f"ERROR: {e}", {"error": str(e)})
            return []

    def search_knowledge_base(self, query: str, top_k: int = 5, tracer = None) -> List[Dict]:
        """搜索知识库 (entity boost + 关键词打分)"""
        results: List[Dict] = []
        query_tokens = set(tokenize(query))

        # Step 1: entity boost (省+年份 → 强行置顶)
        boost_results = maybe_apply_boost(query, self.knowledge_base)
        results.extend(boost_results)

        # Step 2: 关键词打分
        kb_stats: Dict[str, int] = {}
        for kb_name, kb_items in self.knowledge_base.items():
            if not isinstance(kb_items, list):
                continue
            index_fn = KB_INDEX_FIELD.get(kb_name)
            display_fn = KB_DISPLAY_FIELD.get(kb_name)
            if not index_fn or not display_fn:
                continue
            for item in kb_items:
                if not isinstance(item, dict):
                    continue
                content = index_fn(item)
                score = keyword_score(query_tokens, content)
                if score > 0:
                    title, body = self._format_result(kb_name, item, display_fn)
                    results.append({
                        "type": kb_name,
                        "title": title,
                        "content": body,
                        "score": score,
                        "data": item,
                    })
                    kb_stats[kb_name] = kb_stats.get(kb_name, 0) + 1

        results.sort(key=lambda x: x["score"], reverse=True)
        top = results[:top_k]

        if tracer:
            tracer.add_stage("kb_search",
                f"query={query!r}, top_k={top_k}, query_tokens={list(query_tokens)[:10]}",
                f"{len(top)} hits / {len(results)} total scored / boost: {len(boost_results)}",
                {
                    "kbs_searched": list(self.knowledge_base.keys()),
                    "kbs_with_hits": kb_stats,
                    "total_scored": len(results),
                    "boost_count": len(boost_results),
                    "query_tokens": list(query_tokens)[:20],
                    "top_hits": [
                        {"kb": r["type"], "title": r["title"][:40], "score": round(r["score"], 2)}
                        for r in top
                    ],
                })
        return top

    def _format_result(self, kb_name: str, item: Dict, display_fn) -> tuple[str, str]:
        """根据 kb_name 生成 title + body"""
        if kb_name == "colleges":
            title = item.get("name", "")
        elif kb_name == "majors":
            title = item.get("name", "")
        elif kb_name == "cities":
            title = item.get("city", "")
        elif kb_name == "career":
            title = f"【{item.get('industry', '')}】{item.get('salary_range', '')}"
        elif kb_name == "zhang_quotes":
            title = f"【{item.get('category', '')}】{item.get('quote', '')[:50]}..."
        elif kb_name == "zhang_strategy_2026":
            title = f"【{item.get('category', '')}】{item.get('title', '')}"
        elif kb_name == "gaokao_2026":
            title = f"{item.get('province', '')} 2026 高考分数线"
        else:
            title = f"[{item.get('category', '知识')}] {item.get('title', '')}"
        body = display_fn(item)
        return title, body

    # ========== 拼 context ==========

    def build_context(self, user_resources: List[Dict], kb_results: List[Dict], tracer = None) -> str:
        """拼 LLM 用的 context 文本"""
        ctx_parts = []
        if user_resources:
            ctx_parts.append("# 用户的资料和错题 (IMPORTANT: reference by code like M-001, S-001)")
            for r in user_resources:
                meta = r.get("metadata", {})
                code = meta.get("code", "")
                rtype = meta.get("type", "material")
                title = meta.get("title", "")
                subject = meta.get("subject", "")
                kp = meta.get("knowledge_point", "")
                file_path = meta.get("file_path", "")
                label = "错题" if rtype == "mistake" else "学习资料"
                code_str = code if code else f"ID{meta.get('resource_id', '?')}"
                ctx_parts.append(f"\n## [{label} {code_str}] {title}")
                if subject:
                    ctx_parts.append(f"学科: {subject}")
                if kp:
                    ctx_parts.append(f"知识点: {kp}")
                ctx_parts.append(f"内容:\n{r['content'][:1000]}")
                if file_path:
                    ctx_parts.append(f"附件: {file_path} (image/PDF — user has uploaded this file)")
            ctx_parts.append("\n# Instructions: Reference the user's resources by code (M-001, S-001). If they ask about a resource, use the content above.")
        if kb_results:
            ctx_parts.append("\n\n# 知识库检索结果 (built-in: 11 类 KB: colleges / majors / strategy / life_kb / admission / policy / cities / career / zhang_quotes / zhang_strategy_2026 / gaokao_2026)")
            ctx_parts.append("# 重要: 以下内容是用户问题的检索结果, 请优先基于这些内容回答, 不要以'我的知识不是实时的'拒绝。")
            for r in kb_results:
                ctx_parts.append(f"\n{r['content'][:500]}")
        final = "\n".join(ctx_parts) if ctx_parts else ""
        if tracer:
            tracer.add_stage("build_context",
                f"user_resources={len(user_resources)}, kb_results={len(kb_results)}",
                f"final context = {len(final)} chars",
                {
                    "user_resources_count": len(user_resources),
                    "kb_results_count": len(kb_results),
                    "final_length_chars": len(final),
                    "preview": final[:300] if final else "",
                })
        return final


# 模块级单例
rag_engine = AgentRAG()
embedding_service = rag_engine.embedding
