#!/usr/bin/env python3
"""v1.1.10 速度 benchmark — 测各 tier_mode 的端到端耗时 + 首字延迟"""
import json, sys, time, urllib.request

URL = "http://127.0.0.1:8000/api/chat"

def run(mode: str, msg: str, timeout=120):
    body = json.dumps({
        "message": msg, "scenario": "chat",
        "stream": True, "tier_mode": mode, "user_id": 1,
    }).encode()
    req = urllib.request.Request(URL, data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    first_content_t = None
    events = {}
    tool_calls = 0
    with urllib.request.urlopen(req, timeout=timeout) as r:
        buf = ""
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            try:
                obj = json.loads(payload)
            except Exception:
                continue
            c = obj.get("content", "")
            if c and "[LLM_DONE]" in c:
                events["LLM_DONE"] = json.loads(
                    c.split("[LLM_DONE]")[1].split("[/LLM_DONE]")[0])
            if c and "[END]" in c:
                events["END"] = json.loads(
                    c.split("[END]")[1].split("[/END]")[0])
            if c and "[ROUTE]" in c:
                events["ROUTE"] = json.loads(
                    c.split("[ROUTE]")[1].split("[/ROUTE]")[0])
            if c and "[CTX]" in c:
                events["CTX"] = json.loads(
                    c.split("[CTX]")[1].split("[/CTX]")[0])
            if c and "[TOOL_CALLS]" in c:
                tool_calls += 1
            # 首字: 纯文本内容 (不在任何 [TAG] 里)
            if first_content_t is None and c and not c.startswith("["):
                first_content_t = time.time() - t0
    total = time.time() - t0
    return {
        "mode": mode,
        "total_s": round(total, 2),
        "first_token_s": round(first_content_t, 2) if first_content_t else None,
        "ctx_ms": events.get("CTX", {}).get("latency_ms"),
        "route_ms": events.get("ROUTE", {}).get("latency_ms"),
        "llm_ms": events.get("LLM_DONE", {}).get("latency_ms"),
        "model": events.get("LLM_DONE", {}).get("model_used"),
        "tool_rounds": tool_calls,
    }

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "简单说说什么是导数"
    for mode in ["speed", "normal"]:
        try:
            r = run(mode, msg)
            print(json.dumps(r, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"mode": mode, "error": str(e)}, ensure_ascii=False))
