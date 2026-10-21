"""LLM 基类 - 共享 client 初始化、fallback 框架、错误信息生成
所有具体 LLM 客户端继承自 BaseLLMClient
"""
from openai import AsyncOpenAI
import logging
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class BaseLLMClient:
    """LLM 客户端基类。封装 OpenAI SDK 兼容 client、OpenRouter headers、fallback 链。"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.base_url = base_url or settings.LLM_BASE_URL
        self.api_key = api_key or settings.LLM_API_KEY or "dummy-key"
        self.is_openrouter = "openrouter.ai" in self.base_url
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            default_headers=self._build_headers(),
        )
        self.temperature = settings.LLM_TEMPERATURE
        self.max_tokens = settings.LLM_MAX_TOKENS

    def _build_headers(self) -> dict:
        if self.is_openrouter:
            return {
                "HTTP-Referer": settings.OPENROUTER_REFERER,
                "X-Title": settings.OPENROUTER_TITLE,
            }
        return {}

    @staticmethod
    def _parse_model_list(raw: str, exclude: str = "") -> list[str]:
        """解析逗号分隔的模型列表，自动去重 + 排除主模型"""
        seen = {exclude} if exclude else set()
        out = []
        for m in (raw or "").split(","):
            m = m.strip()
            if m and m not in seen:
                seen.add(m)
                out.append(m)
        return out

    @staticmethod
    def _fallback_response(error: Exception) -> str:
        """给用户友好提示（不暴露技术细节）"""
        err_str = str(error).lower()
        # v1.2.3: 先判"模型名不认识" —— 这类错误重启 100 次也修不好,
        # 原来落到通用分支会叫用户去重启 启动.bat, 白折腾。
        if (
            "unknown model" in err_str
            or "model_not_found" in err_str
            or "invalid model" in err_str
            or "does not exist" in err_str
            or "model not found" in err_str
        ):
            hint = (
                "**原因**：当前 LLM 服务商不认这个模型名 (400 unknown model)。\n\n"
                "**解法**：\n"
                "1. 打开 `backend\\.env`, 确认 `LLM_BASE_URL=` 指向的是哪个服务商\n"
                "2. 模型名要跟服务商对得上:\n"
                "   - OpenRouter → `minimax/minimax-m3`、`z-ai/glm-5.2`\n"
                "   - MiniMax 直连 → `MiniMax-M3`（不带前缀）\n"
                "3. 档位模型在 `backend/app/agent/routing/model_whitelist.py` 里改\n"
                "   （注意: `.env` 里的 `TIER_MODEL_*` 当前不生效, 路由只认白名单）\n"
                "4. 改完保存, **重启** `启动.bat`"
            )
        elif "401" in err_str or "unauthorized" in err_str or "user not found" in err_str:
            hint = (
                "**原因**：LLM 服务商返回 401 (key/权限问题)。\n\n"
                "**解法**：\n"
                "1. 打开 `backend\\.env`\n"
                "2. 检查 `LLM_API_KEY=` 后面那串 key 是不是对的\n"
                "3. 去服务商后台（OpenRouter 等）确认 key 还活着、还有额度\n"
                "4. 改完保存，**重启** `启动.bat`"
            )
        elif "timeout" in err_str or "timed out" in err_str:
            hint = "**原因**：网络超时。\n\n**解法**：开代理后重启，或换国内模型（DeepSeek/通义）。"
        elif "404" in err_str or "not found" in err_str:
            hint = (
                "**原因**：LLM 服务商返回 404 (接口地址或模型路径不对)。\n\n"
                "**解法**：\n"
                "1. 打开 `backend\\.env`, 检查 `LLM_BASE_URL=` 是不是完整的 `/v1` 地址\n"
                "2. 确认服务商提供的模型 id 写法\n"
                "3. 改完保存，**重启** `启动.bat`"
            )
        else:
            hint = (
                "**原因**：后端服务有点问题。\n\n"
                "**解法**：\n"
                "1. 重启 `启动.bat`\n"
                "2. 还是不行就 `诊断.bat` 一份日志发给我看"
            )
        return f"""兄弟，我这儿现在接不上大脑 😅

{hint}

---

你先跟我说说你想咨询什么（志愿填报 / 备考 / 随便聊），记下你的问题，等后端恢复了我直接接上答你。"""
