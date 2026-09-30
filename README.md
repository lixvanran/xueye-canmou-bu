# 学业参谋部 v1.2.2

> **Fork 声明**：本项目是 [ZhangXuefeng-Agent](https://github.com/lixvanran/ZhangXuefeng-Agent) 的 fork。  
> 分叉点：`v0.9.8`（commit `fdfd1ee`）。  
> - **`upstream` 分支** = ZhangXuefeng-Agent 原项目（含 `v0.9.8` 及之前的所有历史）  
> - **`main` 分支** = 学业参谋部（`v0.9.8` 之后的所有开发，包括 v0.9.9 → v1.1.5 → v2.0 → v0.1.6 → v0.1.7 → v1.1.9）  


**本地化 AI Agent 平台** — 多智能体协作 + RAG 知识库 + 工具调用。

本地部署、开箱即用的 Agent 框架: 三大核心场景(智能对话 / 资料库 / 个人中心)、3 种可切换 Persona(张雪峰 / 学姐 / 段子手, 蒸馏自 nuwa-skill 开源项目的真实思维框架)、完整运行过程可视化(8 步骤 trace 面板)、学情雷达 + 学习轨迹可视化。

仅供学习交流。

---

## 核心特性

- **讲题工作流**：四步引导式教学 —— 理解题目、引导思路、评估方案、给出答案，避免直接告知导致思维依赖
- **长期事实抽取**：对话结束后异步抽取用户关键信息（学科偏好、目标院校、错题模式），自动注入下次对话
- **RAG 知识库**：内置 10 个 JSON 知识库，覆盖院校 / 专业 / 分数线 / 招生政策 / 就业数据，支持混合检索
- **一 Key 全跑**：通过 OpenRouter 路由平台，单一 Key 调用 Claude / GPT / Qwen / DeepSeek 等模型，自动故障切换
- **本地部署**：数据全部留在本机，不上传第三方，对个人信息保护友好

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
   +--------+-------+  +-----+-----+  +-----+-------+ |
         |                |                |          |
         +----------------+----------------+----------+
                                     |
                          +----------v----------+
                          |   OpenRouter API    |
                          |   Claude / GPT etc  |
                          +---------------------+
```

核心流程：用户输入 → Orchestrator 选择场景 → LLM 调用（带 RAG + Tools + Memory）→ 流式返回 → 异步抽取事实入库。

---

## 快速开始

### 环境要求

- **Python 3.11+** （启动.bat 没装时会自动用 winget 装 — 仅限 Win10 1809+ / Win11）
- **Node.js 20+** （同上）
- Windows 10/11 或 macOS / Linux

> v1.1.9+: Windows 用户如果机器上 Python / Node 都没装，启动.bat 会**自动用 winget 装**（用户级安装，不用管理员权限）。装完需要重新跑一次 启动.bat（Windows 已知 PATH 刷新问题）。macOS / Linux 用户请用 brew / apt 手动装。

### 启动方式

Windows:

```cmd
双击 启动.bat
```

macOS / Linux:

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &

cd frontend
npm install
npm run dev
```

首次启动会自动安装依赖（5-10 分钟）。完成后浏览器访问 `http://localhost:3000`。

### 配置 API Key

进入系统设置 → API Key → 填入 OpenRouter Key → 测试 → 保存。

Key 申请地址：`https://openrouter.ai/keys`

---

## 三种使用方式

**对话模式** —— 自由提问，张雪峰风格回答
- 例：「湖北 620 想学 AI」 / 「M-001 这道题怎么解」 / 「该不该考研」

**资料库模式** —— 浏览内置知识库
- 例：错题统计表、专业查询、分数线对比

**个人中心** —— 查看历史对话与抽取的事实

---

## 三个对话场景

| 场景 | 用途 | 关键能力 |
|---|---|---|
| `chat` | 自由问答 | RAG 检索 + 工具调用 |
| `exam` | 讲题 / 错题 | 四步引导工作流 |
| `volunteer` | 志愿填报 | 院校查询 + 概率计算 + 政策检索 |

场景由 Orchestrator 根据用户输入自动分类（Classifier），无需手动选择。

---

## 技术栈

**后端**

- FastAPI 0.110+
- Pydantic v2
- SQLAlchemy 2.0 + SQLite
- OpenAI Python SDK（兼容 OpenRouter）
- DuckDuckGo Search（无 Key 联网搜索）

**前端**

- React 18 + TypeScript
- Vite 5
- TailwindCSS 3
- Axios + SSE

**LLM**

- 主模型：Claude Sonnet 4.6
- 备用：Claude Opus 4.6 / GLM 5 / DeepSeek V3 / Qwen 2.5
- Embedding：本地 TF-IDF（零依赖） / 可选 OpenAI

---

## 项目结构

```
LocalAgent/
├── 启动.bat / 停止.bat / 诊断.bat    # Windows 一键启停
├── README.md
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI 入口
│   │   ├── core/config.py            # 配置 (env + 版本号)
│   │   ├── agent/                    # Agent 核心
│   │   │   ├── orchestrator.py       # 调度
│   │   │   ├── prompts/scenarios/    # 三个场景 prompt
│   │   │   ├── memory/               # 长期事实抽取
│   │   │   ├── rag/                  # RAG 引擎
│   │   │   └── tools/                # 18 个 tool 注册
│   │   ├── routers/                  # API 路由
│   │   └── db/                       # SQLite + ORM
│   ├── knowledge_base/               # 10 个内置 JSON KB
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/ChatPage.tsx        # 智能对话
    │   ├── pages/ResourcesPage.tsx    # 资料库
    │   ├── pages/ProfilePage.tsx      # 个人中心
    │   └── components/SettingsModal.tsx
    └── package.json
```

---

## 隐私与本地化

- 所有对话历史与个人事实存储在本地 SQLite (`backend/data/`)
- API Key 仅用于调用 LLM，不上传任何业务数据
- 支持完全离线运行（除 LLM 调用外）

---

## 版本说明

当前版本 v1.2.2。开发采用迭代式小版本演进，每个版本聚焦一个改进点。

已知版本演进：

- v0.9.x：核心场景 + 讲题工作流 + 长期事实抽取
- v1.0.x：一键启动 + 知识库集成
- **v1.1.6**：5 页面架构（今日 / 会话 / 日程 / 资料库 / 画像）+ 会话防串台 + nuwa-skill 框架 + 个人画像精简 + 错题知识图谱 + 历史搜索 + 数据导出导入
- **v1.1.7**：Agent 完整运行过程可视化（8 步骤 trace 面板）+ 多角色实际接入（张雪峰 / 学姐 / 段子手 三种 persona，persona 真正生效到 system prompt）+ 画像可视化（学情雷达 SVG + 学习轨迹图）+ persona/agent_name 联动修复 + embedding 403 circuit breaker + schedule/toggle 真 toggle + api-key/test 可测当前 key + classifier markdown fence 解析 + ChatPage 切 tab 清 trace。修复下属测试 6 P0 + 4 P1。
- **v1.1.9**：项目改名「学习智囊团 → 学业参谋部」+ 启动.bat 重写修 cmd 中文乱码 bug + 自动检测 Python/Node + winget 自动装
- **v1.1.10**：5 P0 修复（persona dropdown 图层层级 / 快速模式 10s→2s 提速 / 切 tab 对话记忆串台 / 切页中断 Agent / 历史版本号残留）+ 版本全套同步
- **v1.1.11**：16 个 persona 全部加上 AI 生成的 Pixar 风肖像（ChatPage dropdown + trigger + 团队 chip + sub-agent 卡片全集成）+ 课间解压游戏（嵌入张雪峰快跑 + 高一必修一背诵 28 条知识点，只加不减）+ GamePage 新页面（侧栏画像与设置之间）
- **v1.2.2**：启动.bat 编码修复（加 chcp 65001 + UTF-8 BOM）+ OpenRouter key 替换 + 后端滚回 v1.1.9 仅换 key

详细变更见各 commit message。

---

## License

MIT —— 学习和交流用途。请勿商用。

---

## 致谢

- [nuwa-skill](https://github.com/alchaincyf) (alchaincyf, MIT) — 蒸馏张雪峰 / Naval / Musk 等真实人物的认知操作系统 (SKILL.md)
- Eric-Yibo-Shen 与 zouchenzhen 的开源知识库（CC BY 4.0 / MIT）
- OpenRouter 提供统一 LLM 路由
