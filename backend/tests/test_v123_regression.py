"""v1.2.3 修复的回归测试 (pytest 版)

覆盖三个 P0:
1. 全模型失败被遥测报成成功 (model_used 谎报)
2. <think> 内联推理泄漏到用户气泡
3. unknown model 错误落到"重启 启动.bat"的误导分支

跑法: cd backend && ../.venv/bin/python -m pytest tests/test_v123_regression.py -v
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.agent.pipeline.postprocessor import strip_think_block, ThinkTagStripper
from app.agent.llm.base import BaseLLMClient
from app.agent.pipeline import llm_runner


# ===== 1. <think> 内联推理剥离 =====

def test_strip_think_block():
    raw = "<think>用户问什么是位次，我应该用张雪峰风格回答。</think>\n\n**位次就是全省排名。**"
    out = strip_think_block(raw)
    assert "<think>" not in out and "</think>" not in out, out
    assert "位次就是全省排名" in out, out
    assert "我应该用张雪峰风格" not in out, out

    # 未闭合 (模型被截断)
    out2 = strip_think_block("前面正常<think>推理写到一半被截断")
    assert "<think>" not in out2, out2

    # 多个块
    out3 = strip_think_block("<think>a</think>正文<think>b</think>尾巴")
    assert "<think>" not in out3 and "正文" in out3 and "尾巴" in out3, out3

    # 无 think 的正常文本不能被破坏
    plain = "普通回答, 没有任何推理块"
    assert strip_think_block(plain) == plain


def test_think_stripper_stream():
    """模拟 MiniMax-M3 实际输出: think 标签和内容被切成多个 chunk"""
    chunks = ["<thi", "nk>用户", "在问位次", "，我要用", "张雪峰风格", "回答", "</think>", "\n\n位次就是排名。"]
    stripper = ThinkTagStripper()
    out = "".join(stripper.feed(c) for c in chunks)
    out += stripper.flush()
    assert "<think>" not in out and "</think>" not in out, out
    assert "位次就是排名。" in out, out
    assert "我要用" not in out and "张雪峰风格回答" not in out, out


def test_think_stripper_unclosed():
    stripper = ThinkTagStripper()
    out = "".join(stripper.feed(c) for c in ["<think>推理", "中"])
    out += stripper.flush()
    assert "think" not in out.lower(), out


# ===== 2. 错误文案分支 =====

def test_fallback_response_unknown_model_branch():
    unknown_model = BaseLLMClient._fallback_response(
        Exception("Error code: 400 - invalid params, unknown model 'minimax/minimax-m2.7' (2013)")
    )
    assert "unknown model" in unknown_model, unknown_model
    assert "model_whitelist.py" in unknown_model, unknown_model
    assert "重启" in unknown_model, unknown_model


def test_fallback_response_401_branch():
    e401 = BaseLLMClient._fallback_response(Exception("401 User not found"))
    assert "401" in e401 and "LLM_API_KEY" in e401, e401


def test_fallback_response_timeout_branch():
    etimeout = BaseLLMClient._fallback_response(Exception("Request timed out"))
    assert "超时" in etimeout, etimeout


def test_fallback_response_404_branch():
    e404 = BaseLLMClient._fallback_response(Exception("404 page not found"))
    assert "404" in e404 and "LLM_BASE_URL" in e404, e404


def test_fallback_response_generic_branch():
    eother = BaseLLMClient._fallback_response(Exception("something weird"))
    assert "后端服务有点问题" in eother, eother


# ===== 3. model_used 诚实性 =====

class _FakeMsg:
    def __init__(self, content):
        self.content = content
        self.tool_calls = None


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMsg(content)
        self.finish_reason = "stop"


def test_model_used_truthful():
    """成功时 model = 真正用的模型; 全失败时 model = None (不再谎报 primary)"""
    calls = []

    async def fake_do_chat(model, messages, tools):
        calls.append(model)
        if model == "good-model":
            return {"content": "<think>思考</think>答案", "tool_calls": None, "finish_reason": "stop"}
        raise Exception("400 unknown model '%s'" % model)

    orig = llm_runner.llm_client._do_chat
    llm_runner.llm_client._do_chat = fake_do_chat
    try:
        res = asyncio.run(llm_runner._do_chat_with_models(
            "bad-model", ["bad2-model", "good-model"], [{"role": "user", "content": "hi"}]
        ))
        assert res.get("model") == "good-model", res.get("model")
        assert "<think>" not in res.get("content", ""), res.get("content")

        res2 = asyncio.run(llm_runner._do_chat_with_models(
            "bad-model", ["bad2-model"], [{"role": "user", "content": "hi"}]
        ))
        assert res2.get("model") is None, res2.get("model")
        assert res2.get("error"), res2
        assert res2.get("failed_models") == ["bad-model", "bad2-model"], res2.get("failed_models")
        assert res2.get("finish_reason") == "error", res2.get("finish_reason")
        assert "接不上大脑" in res2.get("content", ""), res2.get("content")
    finally:
        llm_runner.llm_client._do_chat = orig


def test_stream_status():
    """流式路径: 成功回填 model, 全失败 model=None + failed_models"""
    class _Delta:
        def __init__(self, content):
            self.content = content

    class _Choice:
        def __init__(self, content):
            self.delta = _Delta(content)

    class _Chunk:
        def __init__(self, content):
            self.choices = [_Choice(content)]

    class _FakeStream:
        def __init__(self, items, fail=False):
            self.items = list(items)
            self.fail = fail

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self.fail:
                raise Exception("400 unknown model 'x'")
            if not self.items:
                raise StopAsyncIteration
            return _Chunk(self.items.pop(0))

    orig_create = llm_runner.llm_client.client.chat.completions.create

    async def create_ok(**kwargs):
        return _FakeStream(["你好", "世界"])

    async def create_fail(**kwargs):
        return _FakeStream([], fail=True)

    # 成功
    llm_runner.llm_client.client.chat.completions.create = create_ok
    status = {}
    chunks = []

    async def _run_ok():
        async for c in llm_runner._do_stream_with_models(
            "m1", [], [{"role": "user", "content": "x"}], status=status
        ):
            chunks.append(c)

    try:
        asyncio.run(_run_ok())
    finally:
        llm_runner.llm_client.client.chat.completions.create = orig_create
    assert status.get("model") == "m1", status
    assert "".join(chunks) == "你好世界", "".join(chunks)

    # 失败
    llm_runner.llm_client.client.chat.completions.create = create_fail
    status2 = {}

    async def _run_fail():
        async for _ in llm_runner._do_stream_with_models(
            "m1", ["m2"], [{"role": "user", "content": "x"}], status=status2
        ):
            pass

    try:
        asyncio.run(_run_fail())
    finally:
        llm_runner.llm_client.client.chat.completions.create = orig_create
    assert status2.get("model") is None, status2
    assert status2.get("failed_models") == ["m1", "m2"], status2
    assert status2.get("error"), status2
