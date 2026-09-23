# 张雪峰智能体

> 一个本地部署的 AI 学习与志愿助手，专为高考场景设计 —— 通过多智能体协作、RAG 知识库与工具调用，让备考与志愿填报不再是盲选。

[MIT](#license) · 仅供学习交流 · Windows / macOS / Linux · 完全本地化

---

## 目录

- [它能做什么](#它能做什么)
- [5 分钟上手](#5-分钟上手)
- [三种使用方式](#三种使用方式)
- [系统架构](#系统架构)
- [三个对话场景](#三个对话场景)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [API Key 配置](#api-key-配置)
- [常见问题](#常见问题)
- [开发路线图](#开发路线图)
- [隐私与安全](#隐私与安全)
- [贡献指南](#贡献指南)
- [致谢](#致谢)

---

## 它能做什么

张雪峰智能体不是聊天机器人 —— 它是一个**场景化的本地 Agent 平台**。系统会根据你的输入自动路由到三个对话场景，每个场景都有专属 prompt 与工具链。

### 智能对话（chat）

自由问答场景。系统会用 RAG 检索 10 个内置知识库（院校 / 专业 / 分数线 / 招生政策 / 就业数据），并自动调取合适的工具（查概率、算匹配、抓政策）。

```
你: 湖北 620 想学 AI
它: 根据湖北 2025 物理类分数线，620 分处于「211 中段 + 985 边缘」。
    推荐三档：
    冲: 华中科技大学（电子信息）
    稳: 武汉理工大学（计算机）
    保: 湖北大学（数据科学）
    ...
```

### 讲题模式（exam）

四步引导式教学，不是直接给答案 —— 先理解题、引导思路、评估方案、给出答案，避免思维依赖。

```
你: M-001 这道题怎么解
它: 让我看看这道题...
    1. 请问你觉得题目考察什么知识点？
    2. 你现在的思路是什么？
    3. 给出 3 种思路，逐一评估
    4. 真正卡住再给完整答案
```

### 志愿模式（volunteer）

针对志愿填报专项优化。整合院校查询、概率计算、政策检索，专门处理「冲稳保」组合、文理科选科、招生章程等场景。

### 资料库

浏览内置知识库（10 个 JSON 文件）：
- `01_persona.json` —— 人格设定与话术
- `03_majors.json` —— 高校专业目录
- `04_universities.json` —— 院校信息
- `08_admission_scores.json` —— 历年分数线
- `09_policies.json` —— 招生政策
- `10_external_kb.json` —— 外部补充资料（124 条）

### 个人中心

查看历史对话、长期事实、抽取的学生信息（如「偏好计算机」「目标 985」「对数学应用题反复错」）。下次对话自动注入。

---

## 5 分钟上手

### 环境要求

- Python 3.11 或更高
- Node.js 20 或更高
- Windows 10/11、macOS 12+、Ubuntu 22.04+

### Windows 用户（最简单）

```cmd
1. 下载 zip，解压到任意文件夹
2. 双击 启动.bat
3. 浏览器自动打开 http://localhost:3000
4. 进入系统设置 → API Key → 填入 → 完成
```

首次启动会自动安装依赖（5-10 分钟），之后秒开。

### macOS / Linux 用户

```bash
git clone https://github.com/lixvanran/ZhangXuefeng-Agent.git
cd ZhangXuefeng-Agent

# 启动后端
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# 启动前端（新终端）
cd ../frontend
npm install
npm run dev
```

### 配置 API Key

进入前端系统设置 → API Key → 填入 OpenRouter Key → 测试 → 保存。重启服务后生效。

详细步骤见 [API Key 配置](#api-key-配置)。

---

## 三种使用方式

张雪峰智能体的三个对话场景由 **Orchestrator 自动路由**，无需手动选择。系统会根据你的输入内容，调用对应的 prompt 与工具链。

| 输入示例 | 路由到 | 关键能力 |
|---|---|---|
| 「湖北 620 想学 AI」 | volunteer | RAG 院校库 + 概率计算 |
| 「M-001 这道题怎么解」 | exam | 4 步引导工作流 |
| 「该不该考研」 | chat | 自由问答 + 事实抽取 |
| 「数学应用题老错怎么办」 | exam | 错题模式匹配 + 长期事实 |

路由由 Classifier 模块决策，可在前端调试页查看分类概率。

---

## 系统架构

```
                          +---------------------+
                          |   Frontend (React)  |
                          |   ChatPage / Library|
                          +----------+----------+
                                     |
                                     |  SSE Stream
                                     |
                          +----------v----------+
                          |   FastAPI Backend   |
                          +----------+----------+
                                     |
            +----------------+-------+-------+----------------+
            |                |               |                |
   +--------v-------+  +-----v------+  +-----v-------+  +-----v------+
   |   Orchestrator |  |  RAG Engine|  |Tool Registry|  |Memory Mgr  |
   |   (Scenario    |  | (10 KB    | | (18 tools)  |  |(Facts+Hist)|
   |   Router)      |  |  hybrid   |  |             |  |            |
   +--------+-------+  +-----+-----+  +-----+-------+ +-----+------+
            |                |               |               |
            +----------------+-------+-------+---------------+
                                     |
                          +----------v----------+
                          |   OpenRouter API    |
                          |   Claude / GPT etc  |
                          +---------------------+
```

### 核心模块

| 模块 | 作用 |
|---|---|
| **Orchestrator** | 调度中心，根据场景选择 prompt + 工具 + 记忆 |
| **Classifier** | 输入分类，决定走 chat / exam / volunteer |
| **RAG Engine** | 知识库混合检索（向量 + 关键词），支持 10 个内置 KB |
| **Tool Registry** | 18 个工具注册（院校查询、概率计算、政策检索等） |
| **Memory Manager** | 短期历史 + 长期事实，自动抽取与注入 |
| **Fact Extractor** | 对话结束异步抽取 1-3 个关键事实 |
| **LLM Client** | 通过 OpenRouter 统一调用 Claude / GPT / Qwen |

---

## 三个对话场景

### exam —— 讲题工作流（核心创新）

四步引导式教学 —— 这是与「直接给答案」聊天机器人的根本区别。

| 步骤 | 目的 |
|---|---|
| 1. 理解题目 | 通过 RAG / 错题查询理解考点 |
| 2. 引导思路 | 询问学生的现有思路，**永远不直接给答案** |
| 3. 评估方案 | 给出 3 种思路（A 正确 / B 方向对细节错 / C 全错），逐一评估 |
| 4. 给出答案 | 仅当学生真正卡住时给出完整解答 |

### volunteer —— 志愿填报

针对高考志愿场景专项优化：
- 院校库（985 / 211 / 双一流全覆盖）
- 专业库（含就业率与薪资中位数）
- 历年分数线（按省份 / 选科 / 文理分类）
- 概率计算（一分一段表 + 等效分算法）
- 招生政策实时检索

### chat —— 自由问答

不预设结构，按用户问题自由回答。调用 RAG 与工具链，但 prompt 较为开放。

---

## 技术栈

### 后端

| 类别 | 技术 |
|---|---|
| 框架 | FastAPI 0.110+ / Pydantic v2 |
| 数据库 | SQLite 3 + SQLAlchemy 2.0 |
| LLM SDK | OpenAI Python（兼容 OpenRouter） |
| 搜索 | DuckDuckGo Search（无需 Key） |
| 异步 | asyncio + aiohttp |

### 前端

| 类别 | 技术 |
|---|---|
| 框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| 样式 | TailwindCSS 3 |
| 数据 | Axios + Server-Sent Events |

### LLM

| 档位 | 模型 |
|---|---|
| 主力 | Claude Sonnet 4.6 |
| 高级 | Claude Opus 4.6 |
| 中级 | GLM 5 / GLM 5.2 / DeepSeek V3.2 |
| 备用 | Qwen 2.5-72B / Llama 3.1 / MiniMax M3 |

故障切换：主力失败自动降级到下一档，token 计费为主。

---

## 项目结构

```
LocalAgent/
├── 启动.bat / 停止.bat / 诊断.bat    # Windows 一键启停
├── README.md                         # 你正在读这个
├── LICENSE                           # MIT
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI 入口
│   │   ├── core/config.py            # 配置加载（env + 版本号）
│   │   ├── agent/                    # Agent 核心
│   │   │   ├── orchestrator.py       # 调度
│   │   │   ├── routing/              # Classifier + 模型路由
│   │   │   ├── prompts/scenarios/    # 三个场景 prompt
│   │   │   │   ├── chat.py           # 自由问答
│   │   │   │   ├── exam.py           # 讲题
│   │   │   │   ├── volunteer.py      # 志愿
│   │   │   │   └── base.py           # 共享基类
│   │   │   ├── memory/               # 记忆系统
│   │   │   │   ├── manager.py        # 短期历史 + 长期事实
│   │   │   │   ├── store.py          # DB CRUD
│   │   │   │   └── fact_extractor.py # LLM 抽取事实
│   │   │   ├── rag/                  # RAG 引擎
│   │   │   │   └── engine.py         # 混合检索
│   │   │   └── tools/                # 18 个 tool
│   │   │       ├── registry.py       # 总入口
│   │   │       ├── college.py        # 院校查询
│   │   │       ├── major.py          # 专业分析
│   │   │       ├── admission.py      # 概率 + 政策
│   │   │       └── web.py            # 联网 + 抓全文
│   │   ├── routers/                  # API 路由
│   │   │   ├── chat.py
│   │   │   ├── resources.py
│   │   │   ├── conversations.py
│   │   │   ├── settings.py          # 模型 + 系统设置
│   │   │   └── api_key.py           # v1.1.5: API Key 配置
│   │   ├── services/                 # 外部服务
│   │   │   └── external/             # 掌上高考等
│   │   └── db/                       # SQLite + ORM
│   ├── knowledge_base/               # 10 个内置 JSON KB
│   ├── data/                         # 运行期数据（gitignore）
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── ChatPage.tsx           # 智能对话主界面
    │   │   ├── ResourcesPage.tsx      # 资料库浏览
    │   │   └── ProfilePage.tsx        # 个人中心
    │   ├── components/
    │   │   └── SettingsModal.tsx      # 系统设置（4 个 tab）
    │   └── api/                       # 后端 API 封装
    └── package.json
```

---

## API Key 配置

张雪峰智能体**通过 OpenRouter 调用所有 LLM**。OpenRouter 是一个路由平台 —— 一把 Key 可以调用 Claude / GPT / Qwen / DeepSeek 等几十家模型，自动按价格路由。

### 步骤

1. 访问 [openrouter.ai/keys](https://openrouter.ai/keys) 申请 Key（需登录）
2. 复制 Key（`sk-or-v1-xxx...` 格式）
3. 启动张雪峰智能体，浏览器进入**系统设置**
4. 选择 **API Key** tab
5. 粘贴 Key → **测试 Key**（验证有效性 + 显示账户余额）→ **保存到 .env**
6. 重启服务（双击 启动.bat）生效

### 自动写入

服务会自动把 Key 写入 `backend/.env`，保留原有注释与环境变量。**当前进程**的 Key 不会立即更新，需要重启服务生效（这是 FastAPI 启动加载配置的设计）。

### 切换 Key

如果想更换 Key，直接在系统设置里填入新的，旧 Key 会被覆盖。无需手动编辑文件。

---

## 常见问题

### Q1：第一次启动很慢？

正常。首次启动会下载 Python 包（pip install）和 Node 包（npm install），总共约 500 MB，5-10 分钟。后续秒开。

### Q2：LLM 调用很贵？

张雪峰智能体默认用 Claude Sonnet，中等题目每次对话约 $0.01-0.05。OpenRouter 提供一些免费模型（如 Qwen 2.5）可在系统设置里切换。

### Q3：能不能完全离线？

**部分可以**。本地 TF-IDF Embedding 零依赖；DuckDuckGo 搜索无需 Key；只有 LLM 调用需要联网。如果你用本地模型（如 Ollama），可以改造 `LLMClient` 指向本地服务。

### Q4：数据安全吗？

完全本地化。所有对话历史、长期事实、个人偏好存储在 `backend/data/sqlite.db`，**不上传任何第三方**。API Key 只用于调用 LLM。

### Q5：报错"key 无效"怎么办？

- 检查 Key 格式：`sk-or-v1-xxx...`
- 到 [openrouter.ai/keys](https://openrouter.ai/keys) 确认 Key 状态
- 系统设置 → API Key → 测试按钮可显示 OpenRouter 返回的具体错误
- 仍然失败？看 [诊断.bat](诊断.bat) 输出

### Q6：怎么升级到新版本？

```cmd
1. 双击 停止.bat
2. 解压新 zip 覆盖
3. 双击 启动.bat
```

数据（`backend/data/`）会自动保留。`.env` 文件也会保留，不会丢 Key。

### Q7：怎么贡献？

见 [贡献指南](#贡献指南)。

---

## 开发路线图

- [x] v0.9.x —— 核心场景 + 讲题工作流 + 长期事实抽取
- [x] v1.0.x —— 一键启动 + 知识库集成
- [x] v1.1.x —— API Key 前端配置 + 项目清理
- [ ] v1.2.x —— 学习轨迹图 + 演示模式 + 录屏备份
- [ ] v2.0.x —— 班级视角 + 共性错题分析
- [ ] v3.0.x —— 跨领域 Agent 框架（拆出独立项目）

---

## 隐私与安全

### 数据存储

- **对话历史**：SQLite 本地数据库
- **长期事实**：同数据库，独立表
- **个人偏好**：同数据库
- **配置**：`.env` 文件

### 第三方调用

- **OpenRouter**：仅发送你的对话内容用于 LLM 推理，OpenRouter 隐私政策适用
- **DuckDuckGo**：搜索时发送搜索关键词
- **无埋点、无统计、无广告 SDK**

### 数据导出

所有数据可在 `backend/data/` 找到，标准 SQLite 格式，可用 `sqlite3` 命令行或 DB Browser 查看。

---

## 贡献指南

欢迎贡献代码、文档、知识库内容、bug 报告。

### 提 Issue

发现 bug 或想加功能？开 [GitHub Issue](https://github.com/lixvanran/ZhangXuefeng-Agent/issues)。

### 提 PR

1. Fork 仓库
2. 创建特性分支 (`git checkout -b feature/xxx`)
3. 提交改动 (`git commit -m 'feat: xxx'`)
4. 推送分支 (`git push origin feature/xxx`)
5. 开 Pull Request

### 贡献知识库

最实用的贡献！`backend/knowledge_base/` 是 JSON 格式，添加新院校 / 专业 / 政策信息即可让系统自动使用。格式见 `01_persona.json` 等示例文件。

---

## 致谢

- **张雪峰老师** —— 公开内容启发了产品方向（**不冒名**，仅作灵感）
- **Eric-Yibo-Shen** —— CC BY 4.0 高校数据
- **zouchenzhen** —— MIT 志愿填报工具集
- **OpenRouter** —— LLM 路由平台
- **Anthropic / OpenAI / 阿里 / DeepSeek** —— 底层模型支持

---

## License

MIT License —— 详见 [LICENSE](LICENSE) 文件。

学习交流用途，请勿商用。