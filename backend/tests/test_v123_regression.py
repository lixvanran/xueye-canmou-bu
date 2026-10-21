"""v1.2.3 修复的回归测试

覆盖三个 P0:
1. 全模型失败被遥测报成成功 (model_used 谎报)
2. <think> 内联推理泄漏到用户气泡
3. unknown model 错误落到"重启 启动.bat"的误导分支

跑法:  cd backend && ../.venv/bin/python -m pytest tests/test_v123_regression.py -v
      或: cd backend && ../.venv/bin/python tests/test_v123_regression.py
"""
import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.agent.pipeline.postprocessor import strip_think_block, ThinkTagStripper
from app.agent.llm.base import BaseLLMClient
from app.agent.pipeline import llm_runner

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(name)
        print(f"  FAIL  {name}  {detail}")


# ===== 1. <think> 剥离 =====

def test_strip_think_block():
    print("\n[1] <think> 内联推理剥离")
    raw = "<think>用户问什么是位次，我应该用张雪峰风格回答。</think>\n\n**位次就是全省排名。**"
    out = strip_think_block(raw)
    check("完整 think 块被剥掉", "<think>" not in out and "</think>" not in out, repr(out))
    check("正文保留", "位次就是全省排名" in out, repr(out))
    check("推理内容不残留", "我应该用张雪峰风格" not in out, repr(out))

    # 未闭合 (模型被截断)
    out2 = strip_think_block("前面正常<think>推理写到一半被截断")
    check("未闭合 think 块不泄漏", "<think>" not in out2, repr(out2))

    # 多个块
    out3 = strip_think_block("<think>a</think>正文<think>b</think>尾巴")
    check("多个 think 块全剥", "<think>" not in out3 and "正文" in out3 and "尾巴" in out3, repr(out3))

    # 无 think 的正常文本不能被破坏
    plain = "普通回答, 没有任何推理块"
    check("无 think 文本原样保留", strip_think_block(plain) == plain, repr(strip_think_block(plain)))


def test_think_stripper_stream():
    print("\n[2] 流式 <think> 剥离 (跨 chunk 边界)")
    # 模拟 MiniMax-M3 实际输出: think 标签和内容被切成多个 chunk
    chunks = ["<thi", "nk>用户", "在问位次", "，我要用", "张雪峰风格", "回答", "</think>", "\n\n位次就是排名。"]
    stripper = ThinkTagStripper()
    out = "".join(stripper.feed(c) for c in chunks)
    out += stripper.flush()
    check("跨 chunk 的 think 块被剥掉", "<think>" not in out and "</think>" not in out, repr(out))
    check("正文完整保留", "位次就是排名。" in out, repr(out))
    check("推理内容不泄漏", "我要用" not in out and "张雪峰风格回答" not in out, repr(out))

    # 未闭合的流
    stripper2 = ThinkTagStripper()
    out2 = "".join(stripper2.feed(c) for c in ["<think>推理", "中"])
    out2 += stripper2.flush()
    check("未闭合流不泄漏 think", "think" not in out2.lower(), repr(out2))


# ===== 2. 错误文案分支 =====

def test_fallback_response_branches():
    print("\n[3] 降级文案分支")
    unknown_model = BaseLLMClient._fallback_response(
        Exception("Error code: 400 - invalid params, unknown model 'minimax/minimax-m2.7' (2013)")
    )
    check("unknown model 不再说'重启 启动.bat'当唯一解法",
          "unknown model" in unknown_model and "model_whitelist.py" in unknown_model,
          unknown_model)
    check("unknown model 文案仍提到重启 (改完配置要重启)",
          "重启" in unknown_model, unknown_model)

    e401 = BaseLLMClient._fallback_response(Exception("401 User not found"))
    check("401 仍走 key 分支", "401" in e401 and "LLM_API_KEY" in e401, e401)

    etimeout = BaseLLMClient._fallback_response(Exception("Request timed out"))
    check("timeout 仍走网络分支", "超时" in etimeout, etimeout)

    e404 = BaseLLMClient._fallback_response(Exception("404 page not found"))
    check("404 走接口地址分支", "404" in e404 and "LLM_BASE_URL" in e404, e404)

    eother = BaseLLMClient._fallback_response(Exception("something weird"))
    check("未知错误仍走通用分支", "后端服务有点问题" in eother, eother)


# ===== 3. model_used 诚实性 =====

class _FakeMsg:
    def __init__(self, content):
        self.content = content
        self.tool_calls = None


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMsg(content)
        self.finish_reason = "stop"


class _FakeResp:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


async def test_model_used_truthful():
    print("\n[4] model_used 如实上报")

    # 3.1 成功: model_used = 真正用的那个模型
    calls = []

    async def fake_do_chat(model, messages, tools):
        calls.append(model)
        if model == "good-model":
            return {"content": "<think>思考</think>答案", "tool_calls": None, "finish_reason": "stop"}
        raise Exception(f"400 unknown model '{model}'")

    orig = llm_runner.llm_client._do_chat
    llm_runner.llm_client._do_chat = fake_do_chat
    try:
        res = await llm_runner._do_chat_with_models(
            "bad-model", ["bad2-model", "good-model"], [{"role": "user", "content": "hi"}]
        )
        check("成功时 model 回填为真正用的模型", res.get("model") == "good-model", repr(res.get("model")))
        check("成功时 think 块被剥掉", "<think>" not in res.get("content", ""), repr(res.get("content")))

        # 3.2 全失败: model = None, 带 error / failed_models
        res2 = await llm_runner._do_chat_with_models(
            "bad-model", ["bad2-model"], [{"role": "user", "content": "hi"}]
        )
        check("全失败时 model 为 None (不再谎报 primary)", res2.get("model") is None, repr(res2.get("model")))
        check("全失败时带 error 字段", bool(res2.get("error")), repr(res2.get("error")))
        check("全失败时带 failed_models 清单",
              res2.get("failed_models") == ["bad-model", "bad2-model"], repr(res2.get("failed_models")))
        check("全失败时 finish_reason=error", res2.get("finish_reason") == "error", repr(res2.get("finish_reason")))
        check("全失败时给的是可读降级文案", "接不上大脑" in res2.get("content", ""), repr(res2.get("content"))[:120])
    finally:
        llm_runner.llm_client._do_chat = orig


async def test_stream_status():
    print("\n[5] 流式路径 status 回填")

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
    try:
        async for c in llm_runner._do_stream_with_models(
            "m1", [], [{"role": "user", "content": "x"}], status=status
        ):
            chunks.append(c)
    finally:
        llm_runner.llm_client.client.chat.completions.create = orig_create
    check("流式成功时 status.model = 该模型", status.get("model") == "m1", repr(status))
    check("流式成功时内容完整透传", "".join(chunks) == "你好世界", repr("".join(chunks)))

    # 失败
    llm_runner.llm_client.client.chat.completions.create = create_fail
    status2 = {}
    try:
        async for c in llm_runner._do_stream_with_models(
            "m1", ["m2"], [{"role": "user", "content": "x"}], status=status2
        ):
            pass
    finally:
        llm_runner.llm_client.client.chat.completions.create = orig_create
    check("流式全失败时 status.model = None", status2.get("model") is None, repr(status2))
    check("流式全失败时 status.failed_models 有清单", status2.get("failed_models") == ["m1", "m2"], repr(status2))
    check("流式全失败时 status.error 存在", bool(status2.get("error")), repr(status2))


def main():
    print("=" * 62)
    print("v1.2.3 回归测试 — 全模型失败谎报 / think 泄漏 / 错误文案")
    print("=" * 62)
    test_strip_think_block()
    test_think_stripper_stream()
    test_fallback_response_branches()
    asyncio.run(test_model_used_truthful())
    asyncio.run(test_stream_status())
    print("\n" + "=" * 62)
    print(f"通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
    if FAIL:
        print("失败项:")
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    print("全部通过 ✅")
    print("=" * 62)


if __name__ == "__main__":
    main()
