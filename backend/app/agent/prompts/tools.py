"""Tool schema 定义 - 暴露给 LLM 的工具
暂放这里, Phase 1e 会拆到 tools/ 目录

v1.2.4: 补上 5 个日程工具的 schema (create/list/update/delete/suggest_schedule)。
        之前它们只注册在 TOOL_REGISTRY 里, **没进本列表** ⇒
        LLM 的请求里根本不含这些工具 ⇒ AI 永远调不到日程功能
        (SchedulePage 的 HTTP 端点能用, 但"帮我安排学习计划"这类话走不通)。
        另加一个自检 _assert_tools_match_registry(), 防止再漂移。
"""
import re as _re
from pathlib import Path

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_college",
            "description": "Find colleges based on score/rank/province. Returns 冲/稳/保 categories.",
            "parameters": {
                "type": "object",
                "properties": {
                    "score": {"type": "integer"},
                    "rank": {"type": "integer"},
                    "province": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["score", "province"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_major",
            "description": "Deep dive into a major: career, salary, traps, fit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "major_name": {"type": "string"},
                },
                "required": ["major_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_admission_probability",
            "description": "Estimate admission probability for a student at a college/major.",
            "parameters": {
                "type": "object",
                "properties": {
                    "user_rank": {"type": "integer"},
                    "college_name": {"type": "string"},
                    "major_name": {"type": "string"},
                    "year": {"type": "integer"},
                },
                "required": ["user_rank", "college_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_policy",
            "description": "Search for the latest gaokao policies for a province.",
            "parameters": {
                "type": "object",
                "properties": {
                    "province": {"type": "string"},
                    "year": {"type": "integer"},
                    "keyword": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_match",
            "description": "按考生分数+省份+科类+策略(冲/稳/保)推荐匹配院校. 真实按省录取数据 + 估算兜底. 返回 top 10 院校及录取概率/位次/分数.",
            "parameters": {
                "type": "object",
                "properties": {
                    "score": {"type": "integer", "description": "考生分数 (0-750)"},
                    "province": {"type": "string", "description": "考生所在省份, 如 '山东' '河南' '江苏'"},
                    "subject_type": {"type": "string", "description": "科类, '物理类'/'历史类'/'理科'/'文科'/'综合'"},
                    "strategy": {"type": "string", "description": "填报策略: '冲'/'稳'/'保' (默认稳)"},
                    "limit": {"type": "integer", "description": "返回结果数 (默认 10)"},
                },
                "required": ["score", "province", "subject_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_schools",
            "description": "多院校综合对比. 输入学校名称列表, 返回每个学校的层次/城市/排名/王炸专业/张雪峰点评.",
            "parameters": {
                "type": "object",
                "properties": {
                    "school_names": {"type": "array", "items": {"type": "string"}, "description": "学校名称列表, 如 ['北京大学','清华大学']"},
                    "dimensions": {"type": "array", "items": {"type": "string"}, "description": "对比维度 (可选), 如 ['tier','city','ranking','famous_majors']"},
                },
                "required": ["school_names"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_school",
            "description": "查院校信息（按名字/省份/985/211/类型）。v0.9.8 优先用掌上高考 API 实时数据，本地数据库兜底。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "院校名字（部分匹配）"},
                    "province": {"type": "string", "description": "所在省份，如 '江苏' / '北京'"},
                    "is_985": {"type": "boolean", "description": "是否 985"},
                    "is_211": {"type": "boolean", "description": "是否 211"},
                    "school_type": {"type": "string", "description": "类型：综合/理工/师范/农林/医药/财经/政法/语言/艺术/民族"},
                    "limit": {"type": "integer", "description": "返回数量（默认 10）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_school_admission",
            "description": "查询某院校在某省的历年录取分数+位次。v0.9.8 新增，走掌上高考 API 实时数据（公共免 key）。给志愿填报提供关键数据。",
            "parameters": {
                "type": "object",
                "properties": {
                    "school_name": {"type": "string", "description": "院校全名，如 '苏州大学' / '山东大学'"},
                    "province": {"type": "string", "description": "考生所在省份，如 '山东' / '江苏'。留空只查学校基本信息。"},
                    "years": {"type": "array", "items": {"type": "integer"}, "description": "年份列表，默认 [2024, 2023, 2022]"},
                },
                "required": ["school_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_major",
            "description": "查专业（按名字/学科门类/是否热门）",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "专业名（部分匹配）"},
                    "category": {"type": "string", "description": "学科门类: 工学/理学/文学/医学/经济学/管理学/法学/教育学/艺术学/农学/历史学/哲学/军事学"},
                    "sub_category": {"type": "string", "description": "专业类, 如 '计算机类'"},
                    "is_hot": {"type": "boolean", "description": "是否热门专业"},
                    "limit": {"type": "integer", "description": "返回数量（默认 10）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "联网深度搜索 — 像豆包/Perplexity 一样: 搜多 provider + 抓全文 + 子问题拆解 + 整合。返回带全文摘录的搜索结果。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "max_results": {"type": "integer", "description": "返回条数 (默认 8)"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "抓单个 URL 全文 (给 search_web 后续用, 也能直接调)",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "max_chars": {"type": "integer", "description": "最大字符数 (默认 6000)"},
                },
                "required": ["url"],
            },
        },
    },
    # ===== v0.8.0: workspace 文件夹操作 =====
    {
        "type": "function",
        "function": {
            "name": "workspace_info",
            "description": "看 workspace/ 整体信息 (在哪, 多少文件, 根目录列表)。给用户介绍 agent 能干啥时用, 或开始复杂任务前先看一眼。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_list",
            "description": "列出 workspace/ 下文件/目录。支持 glob 模式 (如 '*.md', '错题本/*')",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径, 默认 '.' (workspace 根)"},
                    "pattern": {"type": "string", "description": "glob 模式, 默认 '*' = 全部"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_read",
            "description": "读 workspace/ 下文件。自动跳过二进制, 大文件截断。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径, 如 '笔记/数学.md'"},
                    "max_chars": {"type": "integer", "description": "最大字符 (默认 50000)"},
                    "start_line": {"type": "integer", "description": "从第 N 行开始读"},
                },
                "required": ["path"],
            },
        },
    },
    # v0.9.6: 加 read_file 工具 stub — LLM 经常幻觉调 read_file (训练数据里太常见)
    # 路由到 workspace_read, 兼容 LLM 的"自然"反应
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读 workspace/ 下的文件。**两阶段处理 uploads 错题**: 1) 先调 path='uploads' 列出待处理文件; 2) 再对每个文件调 path='uploads/xxx.jpg', 图片会自动用 Vision 识别错题内容。等效 workspace_read, 是 LLM 容易想到的通用别名。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径。传 'uploads' 列出待处理文件, 传 'uploads/photo1.jpg' 读取并识别该图片, 传 '笔记/数学.md' 读文本文件"},
                    "max_chars": {"type": "integer", "description": "最大字符 (默认 50000)"},
                    "start_line": {"type": "integer", "description": "从第 N 行开始读"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_write",
            "description": "写 workspace/ 下文件。自动创建父目录。mode=overwrite 覆盖, append 追加。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径, 如 '错题本/圆.md'"},
                    "content": {"type": "string", "description": "完整文件内容"},
                    "mode": {"type": "string", "description": "'overwrite' 或 'append', 默认 overwrite"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_search",
            "description": "在 workspace/ 下搜文件内容 (中文友好)。返回匹配行+文件名+行号。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "path": {"type": "string", "description": "搜索根目录, 默认 '.' = 全部"},
                    "max_results": {"type": "integer", "description": "默认 20"},
                    "file_pattern": {"type": "string", "description": "文件名 glob, 默认 '*'"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_delete",
            "description": "删除 workspace/ 下文件或空目录 (安全, 不递归删非空目录)",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                },
                "required": ["path"],
            },
        },
    },
]


# ===== v1.2.4: 日程工具 (v2.0 加的, 之前漏了 schema, LLM 调不到) =====

_SCHEDULE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_schedule",
            "description": "创建一条日程/学习计划. 学生说'帮我安排明天下午复习数学'时用.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "日期 'YYYY-MM-DD'"},
                    "content": {"type": "string", "description": "内容 (短文本, 一行)"},
                    "type": {"type": "string", "description": "类型: study/exam/rest/custom", "default": "study"},
                    "note": {"type": "string", "description": "备注 (可选)"},
                    "resource_id": {"type": "integer", "description": "关联的资料/错题 ID (可选)"},
                },
                "required": ["date", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_schedule",
            "description": "查日程/学习计划. 学生问'我明天有什么安排'/'这周计划'时用.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_range": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "[开始日期, 结束日期] 'YYYY-MM-DD'. 不传 = 查全部",
                    },
                    "type": {"type": "string", "description": "类型过滤: study/exam/rest/custom"},
                    "include_completed": {"type": "boolean", "description": "是否含已完成, 默认 true"},
                    "limit": {"type": "integer", "description": "最多返回条数, 默认 100"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_schedule",
            "description": "更新一条日程 (改时间/内容/标记完成). 学生说'把明天那项改到后天'/'这项搞定了'时用.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "日程 ID (先用 list_schedule 拿到)"},
                    "date": {"type": "string", "description": "新日期 'YYYY-MM-DD'"},
                    "content": {"type": "string", "description": "新内容"},
                    "type": {"type": "string", "description": "新类型: study/exam/rest/custom"},
                    "note": {"type": "string", "description": "新备注"},
                    "completed": {"type": "boolean", "description": "是否完成"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_schedule",
            "description": "删除一条日程. 学生说'删掉那条'时用.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer", "description": "日程 ID (先用 list_schedule 拿到)"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_schedule",
            "description": "根据目标自动生成 N 天学习计划草稿 (只返回草稿, 不直接入库, 需要用户确认后再 create_schedule). 学生说'帮我安排学习计划'/'离期末还有两周怎么排'时用.",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "学生目标, 如 '期末数学冲120' '中考物理提20分'"},
                    "days": {"type": "integer", "description": "生成天数, 默认 7"},
                    "start_date": {"type": "string", "description": "起始日期 'YYYY-MM-DD', 不传 = 今天"},
                },
                "required": ["goal"],
            },
        },
    },
]

TOOLS.extend(_SCHEDULE_TOOLS)


def _assert_tools_match_registry() -> None:
    """自检: TOOLS 的工具名 必须和 TOOL_REGISTRY 的键一致

    v1.2.4: 日程 5 个工具就是栽在这 —— registry 有、schema 没有,
    于是 LLM 调不到, 而"一切正常"。

    规则: registry 里的每个工具都必须在 TOOLS 里出现 (schema ⊇ registry)。
    schema 多出 registry 没有的 → 也要报错 (LLM 会调到不存在的工具)。
    """
    import sys
    reg_path = Path(__file__).resolve().parents[1] / "tools" / "registry.py"
    try:
        src = reg_path.read_text(encoding="utf-8")
    except OSError:
        return
    m = _re.search(r"TOOL_REGISTRY[^=]*=\s*\{(.*?)\n\}", src, _re.S)
    if not m:
        return
    registered = set(_re.findall(r'"([a-z_]+)":', m.group(1)))
    declared = {t["function"]["name"] for t in TOOLS}

    missing = registered - declared          # 注册了但 LLM 看不见 → 调不到
    extra = declared - registered            # schema 有但没实现 → 调了必炸
    if missing or extra:
        msg = (
            f"TOOLS 与 TOOL_REGISTRY 不一致! "
            f"注册了但 LLM 调不到: {sorted(missing)}; "
            f"schema 有但未注册: {sorted(extra)}"
        )
        print(f"\n[TOOL SCHEMA MISMATCH] {msg}", file=sys.stderr)
        raise RuntimeError(msg)


_assert_tools_match_registry()
