# AGENTS.md — 学业参谋部 (xueye-canmou-bu)

> 给所有在这个仓库上干活的人 (和 AI) 看的。
> **动手前先读这份**, 别靠猜。

## 这是什么

本地部署的 AI 学习参谋。FastAPI (后端) + React/TS (前端) + SQLite。
通过 OpenRouter 或任意 OpenAI 兼容端点调 LLM。数据全部留在本机。

上游 fork: [ZhangXuefeng-Agent](https://github.com/lixvanran/ZhangXuefeng-Agent)，
分叉点 `v0.9.8`。本仓库 = 分叉点之后的全部开发。

## 目标 (决定做什么、不做什么)

**帮助中学生应对中高考。**

推论: 凡是**不服务于"中学生把学科学好、把考试考好"**的功能, 都是可疑的;
凡是**只在高考填志愿那几天才用得上**的功能, 优先级排在"每天都要用"的功能之后。
判断新功能要不要做时, 先问一句: "一个初二学生下周会用它吗?"

## 目录

```
backend/
  app/
    agent/
      orchestrator.py        调度 (场景路由 → pipeline → tool 循环)
      orchestrator_team.py   团队模式
      llm/                   LLM 客户端 (base / openrouter / deep_thinking / vision)
      memory/                长期事实抽取 + 存储
      pipeline/
        preprocessor.py       用户输入 → messages
        context_builder.py    system prompt + 画像注入 + RAG 注入
        llm_runner.py         模型调用 + tool 循环 (★ 失败语义在这里)
        postprocessor.py      输出清洗 (sanitize / think 剥离)
      prompts/
        style.py             16 个 persona 的思维框架 (51KB, 别乱改)
        scenarios/           chat / exam / volunteer 三个场景 prompt
        tools.py             ★ 给 LLM 的工具 schema (23 个)
        taggers/             错题自动打标
      rag/                   检索引擎 + 索引器
      routing/
        classifier.py        复杂度分类
        tier_router.py       low/medium/high 档位路由
        model_whitelist.py   ★ provider 感知的模型白名单
      search/                联网搜索 (duckduckgo / tavily / bing / wikipedia ...)
      tools/                 工具实现 + registry.py
    core/config.py           全部配置 (Pydantic Settings)
    db/database.py           SQLite ORM + 启动时 schema 迁移
    routers/                 FastAPI 路由
  learning/                  ★ 学习主线 (v1.3.0)
    db.py                    知识点掌握度 / 模考成绩 ORM
    srs.py                   间隔重复算法 (可解释, 不黑盒)
    service.py               错题 → 归因 → 掌握度 → 队列 → 复习 → 掌握度再更新
    knowledge.py             知识点库加载 + 闪卡生成
    stage.py                 学段策略 + 工具白名单 + 情绪检测
  knowledge_base/            内置 JSON KB
    01-10_*.json             院校/专业/分数线/政策/就业 (志愿系, 已冻结不维护)
    11_knowledge_points.json 学科知识点卡 (定义/公式/易错点/常考问法)
    12_recitation_cards.json 高一必修一背诵卡 (原藏跑酷游戏里, v1.3.0 抽出)
  db/                        大数据 (8.5万条录取分 / 3765所院校 / 585个专业)
  tests/                     pytest (离线, 不需要 LLM key)
frontend/
  src/pages/                 ChatPage / TodayPage / SchedulePage / ResourcesPage / ProfilePage / ReviewPage
  src/api/learning.ts        错题本 / 复习队列 / 掌握度 / 模考 API
  src/components/            SettingsModal
  src/api/                   API 封装 + SSE 解析
.github/workflows/ci.yml     CI: pytest + tsc + build
```

## 环境

```bash
# 后端 (Python 3.11+)
cd backend
python -m venv ../.venv
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端 (Node 20+)
cd frontend
npm install
npm run dev
```

Windows 用户双击 `启动.bat` / `停止.bat` / `诊断.bat`。

## 提交前必须跑

```bash
cd backend && ../.venv/bin/python -m pytest tests -q     # 必须全绿
cd backend && ../.venv/bin/python -m compileall -q app   # 语法
cd frontend && npx tsc --noEmit                          # 必须 0 错误
cd frontend && npm run build                             # 必须过
```

CI (`.github/workflows/ci.yml`) 跑的就是这四条。**没跑过别开 PR。**

## 硬规则 (踩过的坑, 别再踩)

### 1. 失败路径不许静默变成"成功"

这是本仓库最贵的一类 bug。v1.2.3 修了 3 个 P0, 全是这一类:

- ❌ `model_used = primary` 无条件赋值 → 所有模型挂掉, 遥测照样报"成功"
- ❌ `except Exception: return ""` → 失败伪装成空结果, 表格看着正常
- ❌ `x = a / max(b, 1)` → 分母为 0 时算出 0.0 而不是 NaN, "零错误=完美"

**规则**:
- 任何 `except` 分支, 要么**抛错**, 要么**返回一个能被上层识别的失败标记** (如 `model=None` + `error` 字段)
- 失败必须**可计数**: 失败率、进分母还是出分母, 都要在结果里报出来
- 遥测字段要么反映真实结果, 要么**不存在** —— 不许报一个"看起来正常"的值

### 2. "跑成功了" ≠ "产出有效"

两个独立闸门, 都要过:
- 跑完了吗 (执行成功)
- 产出有效吗 (内容非空 / 样本够 / 没全失败)

`content_length > 0` 但内容全是降级文案 = 失败, 不是成功。

### 3. 改了 TOOLS 就必须同步 registry

`app/agent/prompts/tools.py` 的 `TOOLS` 和 `app/agent/tools/registry.py` 的
`TOOL_REGISTRY` **必须一一对应**:

- registry 有、schema 没有 → LLM 根本调不到这个工具 (v1.2.3 的日程 5 个工具就这么丢的)
- schema 有、registry 没有 → LLM 调了必炸

`tools.py` 里有自检 `_assert_tools_match_registry()`, import 时会跑, 不一致直接抛。
CI 里也有独立的 schema 一致性检查。

### 4. 模型名必须跟服务商对得上

`model_whitelist.py` 按 provider ���别 (openrouter / minimax / deepseek / 智谱 / 硅基流动),
每家用自己的 model id 写法。改 `LLM_BASE_URL` 就要确认模型名跟着变:

- OpenRouter → `minimax/minimax-m3` (带前缀)
- MiniMax 直连 → `MiniMax-M3` (不带前缀)

`.env` 的 `TIER_MODEL_LOW/MEDIUM/HIGH` 留空 = 用 provider 默认; 填了 = 显式覆盖。

### 5. 学段不同, 方法就不同 —— 不是换个难度

初中生**不能用**高中方法: 讲函数用「正比例/二次函数图像」不用「单调性/导数」,
讲几何用初中证明思路不用向量/解析几何, 讲物理用初中模型不用动量/电磁感应。

更硬的: **志愿类工具对非高中学段要从 LLM schema 里直接摘掉**
(`app/learning/stage.py` 的 `allowed_tools` → `llm_runner._filter_tools`)。
靠 prompt 说「你别用」是**建议**, schema 层过滤才是**约束**。

### 6. 情绪状态差的时候不要讲道理

学生说「我完了 / 考不上 / 我太差了 / 想哭」⇒ 切换成
「先接住情绪 → 把问题缩小 → 给一个 15 分钟能做完的小动作」,
**不要**堆方法论、堆知识点、堆鼓励的话。检测在 `stage.detect_emotional_state()`。

### 7. key 校验不许写死服务商

用 `app/agent/llm/provider_check.py` 的 `check_llm_credentials()`, 它跟随
`LLM_BASE_URL`: OpenRouter 走 `/auth/key` (能查余额), 其他走极小 chat 探测 (1 token)。

**"拿不到账号信息" ≠ "key 无效"** —— 两者必须分开报。

### 8. 推理内容不能漏进用户气泡

MiniMax-M3 / GLM-5.x 把 reasoning 内联在 `content` 里。必须用
`postprocessor.strip_think_block` / `ThinkTagStripper` 剥掉。

### 9. 不要动这些

- `frontend/public/avatars/` — 16 张 persona 肖像 (已压到 256px / 共 173KB)
- `backend/db/*.json` — 8.5万条录取分 / 3765所院校 / 585个专业
- `backend/knowledge_base/*.json` — 10 个内置 KB
- `app/agent/prompts/style.py` — 16 个 persona 的思维框架, 改动会波及所有人格

## 加新功能

1. 先在 issue 里写清楚:**服务哪个学段? 解决什么学习问题? 多久用一次?**
2. 涉及 LLM 行为的 → 改 `prompts/scenarios/` 或 `prompts/style.py`, 并加测试
3. 涉及新工具的 → **同时**改 `tools/registry.py` 和 `prompts/tools.py`
4. 涉及新配置的 → 加进 `core/config.py` 并在 `.env.example` 补一行
5. 测试放 `backend/tests/`, 必须离线 (不发网络请求、不要 LLM key)

## 已知待办 (2026-10-21)

- [ ] 学科题库 (真实题目): v1.3.0 做的是**知识点卡**(定义/公式/易错点), 不是**题目**。
      讲题工作流第 1 步"用 RAG 拿题目原文"仍然落不了地 —— 需要真正的题库 (注意版权)。
- [ ] 计划→执行→复盘闭环: `suggest_schedule` 只出草稿, 没有复盘
- [ ] 模考录入的前端: 后端 API 有了, 前端还没有录入界面
- [ ] 前端巨型文件: ChatPage.tsx 84KB / SettingsModal.tsx 48KB / style.py 51KB
- [ ] 数据库迁移: 靠运行时 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`, 没有版本化迁移
- [ ] 志愿模块冻结: 23→28 个工具里 9 个是志愿类, 对初中生零价值, 已停止新增功能
