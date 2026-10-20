"""pytest 公共 fixture

原则: **测试必须离线** —— 不发网络请求、不需要 LLM key、不碰用户真实数据。
"""
import os
import sys
from pathlib import Path

import pytest

# 让 app.* 可导入 (backend/ 是包根)
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# 在 import app.* 之前把环境固定住 —— 否则测试会读到开发者本机的 .env,
# 同一份代码在不同机器上跑出不同结果 (provider 识别最典型)。
os.environ["XUYE_SKIP_DOTENV"] = "1"
os.environ["LLM_API_KEY"] = ""
os.environ["LLM_BASE_URL"] = "https://openrouter.ai/api/v1"
# 测试用独立的 db 目录, 绝不碰用户的 backend/data
os.environ.setdefault("XUYE_DATA_DIR", str(BACKEND_DIR / "data" / "_test"))


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    """给需要落盘的测试一个隔离目录"""
    monkeypatch.setenv("XUYE_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def app_client():
    """FastAPI TestClient (不起真实端口)"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
