# 学业参谋部 v1.3.0

> **Fork 声明**：本项目是 [ZhangXuefeng-Agent](https://github.com/lixvanran/ZhangXuefeng-Agent) 的 fork。  
> 分叉点：`v0.9.8`（commit `fdfd1ee`）。  
> - **`upstream` 分支** = ZhangXuefeng-Agent 原项目（含 `v0.9.8` 及之前的所有历史）  
> - **`main` 分支** = 学业参谋部（`v0.9.8` 之后的所有开发，包括 v0.9.9 → v1.1.5 → v2.0 → v0.1.6 → v0.1.7 → v1.1.9）  


**本地化 AI 参谋 — 16 persona AI 头像 + 张雪峰快跑课间游戏 + 高一必修一背诵 + 一键 bat 启动。

本地部署、开箱即用的 Agent 框架: 三大核心场景(智能对话 / 资料库 / 个人中心)、3 种可切换 Persona(张雪峰 / 学姐 / 段子手, 蒸馏自 nuwa-skill 开源项目的真实思维框架)、完整运行过程可视化(8 步骤 trace 面板)、学情雷达 + 学习轨迹可视化。

仅供学习交流。

---

## 核心特性

- **讲题工作流**：四步引导式教学 —— 理解题目、引导思路、评估方案、给出答案，避免直接告知导致思维依赖
- **错题本 + 掌握度 + 间隔重复**：错题自动归档、知识点掌握度 0-5 级、今日复习队列、闪卡复习（v1.3.0）
- **长期事实抽取**：对话结束后异步抽取用户关键信息（学科偏好、目标院校、错题模式），自动注入下次对话
- **RAG 知识库**：内置 10 个 JSON 知识库，覆盖院校 / 专业 / 分数线 / 招生政策 / 就业数据，支持混合检索
  （⚠️ 目前**不含学科题目** —— 讲题工作流的数据基础是空的，见 AGENTS.md 待办）
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

当前版本 v1.3.0。开发采用迭代式小版本演进，每个版本聚焦一个改进点。

已知版本演进：

- v0.9.x：核心场景 + 讲题工作流 + 长期事实抽取
- v1.0.x：一键启动 + 知识库集成
- **v1.1.6**：5 页面架构（今日 / 会话 / 日程 / 资料库 / 画像）+ 会话防串台 + nuwa-skill 框架 + 个人画像精简 + 错题知识图谱 + 历史搜索 + 数据导出导入
- **v1.1.7**：Agent 完整运行过程可视化（8 步骤 trace 面板）+ 多角色实际接入（张雪峰 / 学姐 / 段子手 三种 persona，persona 真正生效到 system prompt）+ 画像可视化（学情雷达 SVG + 学习轨迹图）+ persona/agent_name 联动修复 + embedding 403 circuit breaker + schedule/toggle 真 toggle + api-key/test 可测当前 key + classifier markdown fence 解析 + ChatPage 切 tab 清 trace。修复下属测试 6 P0 + 4 P1。
- **v1.1.9**：项目改名「学习智囊团 → 学业参谋部」+ 启动.bat 重写修 cmd 中文乱码 bug + 自动检测 Python/Node + winget 自动装
- **v1.1.10**：5 P0 修复（persona dropdown 图层层级 / 快速模式 10s→2s 提速 / 切 tab 对话记忆串台 / 切页中断 Agent / 历史版本号残留）+ 版本全套同步
- **v1.1.11**：16 个 persona 全部加上 AI 生成的 Pixar 风肖像（ChatPage dropdown + trigger + 团队 chip + sub-agent 卡片全集成）+ 课间解压游戏（嵌入张雪峰快跑 + 高一必修一背诵 28 条知识点，只加不减）+ GamePage 新页面（侧栏画像与设置之间）
- **v1.2.2**：启动.bat 编码修复（加 chcp 65001 + UTF-8 BOM）+ OpenRouter key 替换 + 后端滚回 v1.1.9 仅换 key
- **v1.3.0**：**学习主线**（目标: 帮助中学生应对中高考）——
  这是产品从「高考志愿填报工具」转向「日常学业助手」的第一步。

  **新增功能**
  1. **错题本闭环**：AI 能主动调 `add_mistake` 归档错题（自动归一化错因：概念不清/计算失误/
     方法不会/题型不熟/粗心/时间不够），按知识点标签更新掌握度。复用既有 `resources` 表
     （它本来就是错题本），只补 3 个 SRS 字段。
  2. **知识点掌握度 + 间隔重复（SRS）**：0-5 级，间隔表 0/1/2/4/7/15/30 天，
     连续答对 3 次进 30 天。**每一道题的间隔都能说出理由**（不做黑盒）。
  3. **今日复习队列**：错题与薄弱知识点**分开给** —— 「重做旧错题」和「补薄弱点」是两件事。
  4. **闪卡**：知识点卡（含定义/公式/易错点/常考问法）+ 背诵卡，按掌握度排序。
  5. **模考归因**：录入各题失分 → 自动归因到知识点 → 「这次丢的 23 分丢在哪」。
  6. **学段自适应**：小学/初中/高中/职高/大专/本科/考研/留学/在职 各一套教学策略
     （初中明确禁用高中方法：不用导数/向量/动量/电磁感应）。
  7. **工具按学段硬过滤**：初中生的 LLM 请求里**根本不含**志愿工具（schema 层过滤，
     不是靠 prompt 说「你别用」）。
  8. **情绪支持**：识别「我完了 / 考不上 / 想哭」等信号 → 切换成「先接住情绪 →
     把问题缩小 → 给一个 15 分钟能做完的小动作」，不堆方法论。

  **删减**（合计减 13.6MB → 6.4MB）
  - 删 3 个声音克隆脚本 + `samples/`：TTS 早已改浏览器 Web Speech API，
    `ZHANG_VOICE_ID` **零消费者**，属纯死代码（且有真人声音克隆的合规风险）
  - 删「张雪峰快跑」跑酷游戏 + GamePage：里面 29 条「高一必修一背诵」知识点
    抽出来做成正经闪卡（`12_recitation_cards.json`），**内容没丢，形式从跑酷变闪卡**
  - 16 张 persona 头像 1024×1024 → 256×256：9.1MB → **173KB（省 98%）**，
    显示尺寸最大 36px，原图纯属浪费
  - 16 个 persona 加 `group` 分组：4 个「学习」类排前面，12 个成人商业/人生类归「通识」

  **测试**：新增 30 项（`backend/tests/test_learning_v130.py`），仓库共 **69 项**。
  测试当场抓到 2 个真 bug：① 答错后间隔硬编码 1 天，与 SRS「掌握度掉到 0 → 今天还要练」打架
  ② 错因归一化漏了「计算错误」（与「计算失误」只差一字，substring 匹配不到）。
- **v1.2.4**：工程稳定性一轮（目标: 帮助中学生应对中高考）——
  1. **CI 落地**：`.github/workflows/ci.yml` —— pytest + tsc + build 三道闸门。
     此前仓库零 CI、零测试，一个 PR 都没合过也没有任何提交前把关。
  2. **测试 39 项**（`backend/tests/`，全部离线，不需要 LLM key）：
     v1.2.3 的 10 项 + v1.2.4 的 29 项。测试环境 hermetic（不读本机 `.env`）。
  3. **日程工具 schema 补全**：5 个日程工具（create/list/update/delete/suggest_schedule）
     之前只注册在 `TOOL_REGISTRY`，**没进 `prompts/tools.py`** ⇒ LLM 的请求里根本不含它们
     ⇒ AI 永远调不到日程（SchedulePage 的 HTTP 端点能用，但"帮我安排学习计划"走不通）。
     现已补齐 + prompt 指引 + `TOOLS ↔ TOOL_REGISTRY` 导入时自检（防再漂移）。
  4. **模型白名单 provider 感知**：按 `LLM_BASE_URL` 自动识别 openrouter / minimax /
     deepseek / 智谱 / 硅基流动，每家用自己的 model id 写法。之前写死 OpenRouter 风格，
     换任何兼容端点 → 17 个模型全 400 → 整条链死。OpenRouter 默认值与 v1.2.3 逐条一致。
  5. **key 校验跟随 base_url**：`main.py` / `api_key.py` / `settings.py` 四处写死的
     `openrouter.ai/api/v1/auth/key` 换成统一的 `provider_check.check_llm_credentials()`
     —— OpenRouter 走 `/auth/key`（能查余额），其他走 1 token 的 chat 探测。
     之前换端点必然误报"401 User not found"，让用户白折腾自己的 key。
  6. **`TIER_MODEL_*` 不再是死配置**：此前 `tier_router` 只认 `model_whitelist.py`，
     从不读 `settings.TIER_MODEL_*` —— 用户改了 `.env` 静默无效。现在是显式覆盖语义
     （留空 = provider 默认，填了 = 覆盖）。
  7. **依赖钉死版本**：`requirements.txt` 从 `>=` 浮动改为精确版本（同一个 zip 今天能跑明天不能跑）。
  8. **AGENTS.md**：仓库此前没有任何开发规范，现在有（含 7 条硬规则 + 已知待办）。
- **v1.2.3**：3 个 P0 修复（真实 LLM 端到端验证）——
  1. **全模型失败不再被报成成功**：以前所有模型挂掉时 `model_used` 仍然上报 primary 模型名，
     前端 8 步 trace 面板显示绿色"LLM 完成"，实际上一条回答都没生成。现在失败时
     `model_used=null` + `failed=true`，trace 面板标红显示"LLM 失败 / 全部模型调用失败"。
  2. **剥离内联 `<think>` 推理块**：MiniMax-M3 / GLM-5.x 等模型把 reasoning 内联在 content 里返回，
     以前会直接漏进聊天气泡（用户能看到 `<think>用户…</think>` 原文）。现在后端统一剥离。
  3. **错误文案按根因分流**：以前 `400 unknown model` 会落到通用分支，叫用户"重启 启动.bat"——
     而模型名不匹配重启多少次都没用。现在会直指"模型名要跟服务商对得上"，
     并说明档位模型实际在 `backend/app/agent/routing/model_whitelist.py` 里改
     （`.env` 的 `TIER_MODEL_*` 当前不生效，路由只认白名单）。
  另附 `backend/tests/test_v123_regression.py`（28 项断言）—— 仓库此前没有自动化测试。

详细变更见各 commit message。

---

## License

MIT —— 学习和交流用途。请勿商用。

---

## 致谢

- [nuwa-skill](https://github.com/alchaincyf) (alchaincyf, MIT) — 蒸馏张雪峰 / Naval / Musk 等真实人物的认知操作系统 (SKILL.md)
- Eric-Yibo-Shen 与 zouchenzhen 的开源知识库（CC BY 4.0 / MIT）
- OpenRouter 提供统一 LLM 路由
