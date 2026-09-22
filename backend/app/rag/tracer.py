"""RAG Tracer - 记录 RAG 完整过程
v0.1: 用于实验平台/聊天页面透明化展示
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class RAGStage:
    """RAG 单步记录"""
    stage: str  # tokenize / user_search / kb_search / boost / build_context / embed
    timestamp_ms: float
    input_summary: str = ""
    output_summary: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class RAGTrace:
    """一次完整 RAG 调用的 trace"""
    query: str
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    stages: List[RAGStage] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)

    def add_stage(
        self,
        stage: str,
        input_summary: str = "",
        output_summary: str = "",
        data: Optional[Dict[str, Any]] = None,
    ):
        self.stages.append(RAGStage(
            stage=stage,
            timestamp_ms=(time.time() - self.started_at) * 1000,
            input_summary=input_summary,
            output_summary=output_summary,
            data=data or {},
        ))

    def finish(self, summary: Optional[Dict[str, Any]] = None):
        self.finished_at = time.time()
        if summary:
            self.summary = summary
        # 自动加 summary
        self.summary.setdefault("total_stages", len(self.stages))
        self.summary.setdefault("latency_ms", round((self.finished_at - self.started_at) * 1000, 2))

    def to_dict(self) -> Dict:
        return {
            "query": self.query,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "latency_ms": self.summary.get("latency_ms"),
            "stages": [s.to_dict() for s in self.stages],
            "summary": self.summary,
        }


def make_tracer(query: str) -> RAGTrace:
    return RAGTrace(query=query)
