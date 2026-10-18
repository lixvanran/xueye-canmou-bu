"""后处理 - 清理 LLM 输出的 raw tool call / 占位文本
v0.7.5: 防止 LLM 漏出 <invoke>/<tool_call>/<minimax> 等 tag
v1.2.3: 剥离内联 <think> 推理块 (MiniMax-M3 / GLM-5.x 等把 reasoning 内联在 content 里)
"""
import re as _re


def sanitize_llm_output(text: str) -> str:
    """Strip accidental tool-call XML / placeholder text that some LLMs
    write into the visible narrative.

    处理:
    - 零宽字符 ( etc)
    - <invoke name="...">...</invoke>
    - <tool_call>...</tool_call>
    - ]<minimax>[<query>...
    - ]<]minimax[>[
    - query_college<arg_key>...</arg_key>... 这种 raw function call
    - 单独 <arg_key>/<arg_value> tags
    - v0.9.8: <invokename="...">Args<parametername="..."><parameter>...</parameter>...
            (Anthropic 风格幻觉 tool_call, 一些 LLM 训练数据里的格式)
    """
    if not text:
        return text
    s = text
    # 零宽字符
    s = s.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "").replace("\ufeff", "")
    # <invoke name="...">...</invoke>
    s = _re.sub(r'<invoke\b[^>]*>[\s\S]*?</invoke>', '', s)
    # <tool_call>...</tool_call>
    s = _re.sub(r'<\s*/?\s*tool_call\s*>', '', s)
    s = _re.sub(r'<\s*/?\s*invoke\s*>', '', s)
    # v0.9.8: Anthropic 风格幻觉 — <invokename="xxx">Args<parametername="..."><parameter>{...}</parameter>
    # 这种格式 LLM 经常误用, 整段去掉
    s = _re.sub(
        r'<\s*invokename\s*=\s*"[^"]+"\s*>[\s\S]*?(?=\n\n|\Z)',
        '',
        s,
    )
    # 单独的 <parameter>/<parametername>/<parameter_value> 等标签
    s = _re.sub(r'<\s*/?\s*parametername\s*>', '', s)
    s = _re.sub(r'<\s*/?\s*parameter_value\s*>', '', s)
    s = _re.sub(r'<\s*/?\s*parameter\s*>', '', s)
    s = _re.sub(r'>\s*Args\s*<', ' ', s)  # ">Args<" → 空格
    # raw "Args" 单独出现
    s = _re.sub(r'\bArgs\b', '', s)
    # ]<minimax>[<query>...</query>]
    s = _re.sub(r'\]\s*<\s*minimax\s*>\s*\[\s*<query>[\s\S]*?</query>\s*\]', '', s)
    # ]<]minimax[>[
    s = _re.sub(r'\]<\]minimax\[>\[', '', s)
    # ]<minimax[>[ or ]<minimax>[
    s = _re.sub(r'\]<[^\[]*?minimax[^\]]*?>\[', '', s)
    # 单行 ]<...>[ 纯占位
    s = _re.sub(r'^\s*\][^\n]*?>\[\s*$', '', s, flags=_re.MULTILINE)
    # 独立 <minimax> 标签
    s = _re.sub(r'<\s*minimax\s*>', '', s)
    s = _re.sub(r'<\s*/\s*minimax\s*>', '', s)
    # raw function call blocks: query_college<arg_key>...
    s = _re.sub(
        r'\b(?:query_college|query_major|query_admission|search_web|get_weather)\s*<\s*arg_key\b[\s\S]*?(?:</arg_key>|$)',
        '', s
    )
    # orphan <arg_key>/<arg_value> tags
    s = _re.sub(r'<\s*/?\s*arg_(?:key|value)\s*>', '', s)
    # 压缩空白
    s = _re.sub(r'[ \t]+', ' ', s)
    s = _re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


# ===== v1.2.3: 内联 <think> 推理块 =====

_THINK_BLOCK = _re.compile(r'<think>([\s\S]*?)</think>', _re.IGNORECASE)
_THINK_OPEN = _re.compile(r'<think>', _re.IGNORECASE)


def strip_think_block(text: str) -> str:
    """整块剥掉 <think>...</think> (非流式场景, 全文一次性拿到时用)

    只保留正文; 推理内容不进最终答案。
    未闭合的 <think> (模型被截断) 也会连同其后内容一起丢掉 ——
    宁可少显示, 也不能把 <think> 原文漏到用户气泡里。
    """
    if not text or "think" not in text.lower():
        return text
    s = _THINK_BLOCK.sub("", text)
    # 残留的孤立开标签 (未闭合) → 砍掉它以及后面所有内容
    idx = _THINK_OPEN.search(s)
    if idx:
        s = s[:idx.start()]
    # 孤立闭标签
    s = _re.sub(r'</think>', '', s, flags=_re.IGNORECASE)
    return s.strip()


class ThinkTagStripper:
    """流式剥离 <think>...</think> 推理块

    背景: MiniMax-M3 / GLM-5.x 等模型把 reasoning 直接内联在 content 里返回。
    本项目的架构假设 reasoning 走独立通道 (reasoning / thinking 事件),
    所以内联推理会直接漏进聊天气泡 —— 实测 MiniMax-M3 的回答里肉眼可见
    "<think>用户...</think>" 原文。

    用法:
        stripper = ThinkTagStripper()
        for chunk in stream:
            visible = stripper.feed(chunk)   # 可展示给用户的内容
        stripper.flush()                    # 收尾, 处理未闭合的块
    """

    OPEN = "<think>"
    CLOSE = "</think>"
    MAX_BUFFER = 8000  # 未闭合 think 块的最大缓冲, 超过就强制归入丢弃区

    def __init__(self):
        self._buf = ""
        self._in_think = False

    def _pending_prefix_len(self) -> int:
        """缓冲区尾部可能是被 chunk 边界截断的 "<think>" 前缀 → 返回需要保留的字符数

        只保留"确实是 <think> 前缀"的那几个字符, 正常文本立即透传, 不引入延迟。
        """
        for n in range(min(len(self.OPEN) - 1, len(self._buf)), 0, -1):
            if self.OPEN.lower().startswith(self._buf[-n:].lower()):
                return n
        return 0

    def feed(self, chunk: str) -> str:
        """喂入一个 chunk, 返回可以展示给用户的内容"""
        if not chunk:
            return ""
        self._buf += chunk
        out = []
        while True:
            if not self._in_think:
                idx = self._buf.lower().find(self.OPEN)
                if idx >= 0:
                    out.append(self._buf[:idx])
                    self._buf = self._buf[idx + len(self.OPEN):]
                    self._in_think = True
                    continue
                # 可能是被 chunk 边界截断的 "<think" → 留住这几个字符, 其余立即输出
                keep = self._pending_prefix_len()
                if len(self._buf) > keep:
                    out.append(self._buf[:len(self._buf) - keep])
                    self._buf = self._buf[len(self._buf) - keep:]
                break
            else:
                idx = self._buf.lower().find(self.CLOSE)
                if idx >= 0:
                    self._buf = self._buf[idx + len(self.CLOSE):]
                    self._in_think = False
                    continue
                if len(self._buf) > self.MAX_BUFFER:
                    # 没闭合且超长: 丢弃, 避免无限缓冲
                    self._buf = ""
                break
        return "".join(out)

    def flush(self) -> str:
        """收尾: 输出残余缓冲; 未闭合的 think 块整段丢弃"""
        if self._in_think:
            self._buf = ""
            self._in_think = False
            return ""
        rest = self._buf
        self._buf = ""
        # 残余若只是 "<think" 的残缺前缀 → 丢掉, 免得漏半个 tag
        if rest and self.OPEN.lower().startswith(rest.lower()):
            return ""
        return rest

