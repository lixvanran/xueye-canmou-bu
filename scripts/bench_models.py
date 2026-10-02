#!/usr/bin/env python3
"""v1.1.10 — 逐个 benchmark low 档白名单模型, 找出真正最快的 (给 speed 模式用)"""
import json, time, urllib.request, sys

URL = "http://127.0.0.1:8000/api/chat"
MSG = "简单说说什么是导数"

MODELS = [
    "minimax/minimax-m2.7",
    "qwen/qwen-2.5-7b-instruct",
    "deepseek/deepseek-chat-v3.1",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.1-8b-instruct",
]

def run(model: str, timeout=90):
    body = json.dumps({
        "message": MSG, "scenario": "chat", "stream": True,
        "tier_mode": "speed", "user_id": 1, "force_tier": None,
    }).encode()
    req = urllib.request.Request(URL, data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    first = None
    llm_ms = None
    chars = 0
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            try:
                obj = json.loads(line[5:].strip())
            except Exception:
                continue
            c = obj.get("content", "")
            if c and "[LLM_DONE]" in c:
                llm_ms = json.loads(c.split("[LLM_DONE]")[1].split("[/LLM_DONE]")[0]).get("latency_ms")
            if c and not c.startswith("["):
                chars += len(c)
                if first is None:
                    first = time.time() - t0
    return {"model": model, "first_token_s": round(first, 2) if first else None,
            "total_s": round(time.time() - t0, 2), "llm_ms": llm_ms, "chars": chars}

if __name__ == "__main__":
    # 通过 /api/settings/models 改 low 档 primary, 逐个测
    for m in MODELS:
        try:
            # 直接打 settings 改 low 档
            req = urllib.request.Request(
                "http://127.0.0.1:8000/api/settings/models",
                data=json.dumps({"tier": "low", "model": m}).encode(),
                headers={"Content-Type": "application/json"}, method="PUT")
            urllib.request.urlopen(req, timeout=10).read()
            print(json.dumps(run(m), ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"model": m, "error": str(e)[:80]}, ensure_ascii=False))
