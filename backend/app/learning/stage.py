"""学段自适应 (v1.3.0)

为什么要做
----------
产品定位是"帮助中学生应对中高考", 但原来对学段的处理只有一句
"用户是初中生, 解题用初中方法, 不引入高中公式" —— 这不够。

真实的学段差异不只是"难度":
- 初中: 还没学函数 ⇒ 不能用"单调性"这个词; 题目有大量"结合生活实际"
- 高中: 已经学导数 ⇒ 可以用"求导判断单调性"; 题目抽象、题量大
- 职高/中专: 学的是专业课 + 就业技能, 不是高考科目
⇒ 同一道题, 讲给初中生和高中生听, 用的**方法**、**术语**、**例子**都不一样。

这个模块给每个学段一份**教学策略**, 让 prompt 层直接可用。

志愿工具按学段隐藏
------------------
`query_college` / `calculate_admission_probability` 这类工具对初中生毫无意义,
对高中生也只有每年 6 月有用。⇒ 非高中学段**从 schema 里直接摘掉**,
不是靠 prompt 说"你别用" —— 那是不管用的。
"""
from typing import Dict, List, Optional

# 学段 key → 中文标签 (与 users.education_stage 值域一致)
STAGE_LABELS = {
    "primary": "小学",
    "middle": "初中",
    "high": "高中",
    "vocational": "职高/中专",
    "junior_college": "大专",
    "bachelor": "本科",
    "master": "考研/硕士",
    "abroad": "留学",
    "working": "在职/工作",
    "other": "其他",
}

# 中文 stage → 英文 key (users.stage 存的是中文)
STAGE_FROM_CHINESE = {
    "小学": "primary",
    "初中": "middle",
    "高中": "high",
    "职高": "vocational",
    "中专": "vocational",
    "大专": "junior_college",
    "本科": "bachelor",
    "大学": "bachelor",
    "考研": "master",
    "硕士": "master",
    "留学": "abroad",
    "在职": "working",
    "工作": "working",
}

# ===== 每个学段的教学策略 =====

STAGE_PROFILES: Dict[str, Dict] = {
    "primary": {
        "teaching": (
            "用户是小学生。讲题必须用最朴素的方式: 多用具体数字和实物比喻, "
            "一次只推进一小步, 术语一律换成日常说法。不要出现方程、函数、几何证明这些词。"
        ),
        "focus": "计算准确、审题不跳步、单位不丢",
        "tools": ["search_web"],
        "exam_context": "小学以校内单元测为主, 题目短、坑少",
    },
    "middle": {
        "teaching": (
            "用户是初中生。**只用初中课程范围内的方法和术语** —— "
            "讲函数用「正比例/反比例/二次函数图像」, 不要用「单调性」「导数」「定义域」; "
            "讲几何用初中证明思路 (全等/相似/勾股定理/圆的性质), 不要用向量或解析几何; "
            "讲物理用初中模型 (受力分析/牛顿第一二定律/压强浮力/欧姆定律), "
            "不要用动量守恒、电磁感应。"
        ),
        "focus": (
            "中考是**全省统一命题**, 考纲明确、题型固定。"
            "重点是: 基础题不丢分、几何证明写规范、实验题答题格式、"
            "物理实验控制变量、函数实际应用题。"
        ),
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "add_exam_score", "search_knowledge_points"],
        "exam_context": (
            "中考关注: 语数英 + 物理化 + 道法历史 + 体育 + 实验操作 + 综合素质评价。"
            "不同省份差异很大 —— 涉及具体科目/分值时先问清楚是哪个省。"
        ),
        "high_school_only_tools": True,
    },
    "high": {
        "teaching": (
            "用户是高中生。可以用高中范围内的方法: 函数用单调性/导数, "
            "几何用向量/解三角形/立体几何, 物理用牛顿运动定律/动量能量/电磁感应。"
        ),
        "focus": (
            "高考是**全国卷/新高考为主**(按省不同)。重点是: "
            "中档题拿满分、压轴题前两问、答题卡规范、时间分配。"
        ),
        "tools": [
            "search_web", "add_mistake", "list_mistakes", "list_weak_points",
            "add_exam_score", "search_knowledge_points",
            "query_college", "analyze_major", "calculate_admission_probability",
            "calculate_match", "compare_schools", "search_school", "search_major",
            "query_school_admission", "search_policy",
        ],
        "exam_context": "高考分省命题, 志愿填报是每年 6 月的高频场景",
    },
    "vocational": {
        "teaching": (
            "用户在读职高/中专。课程是专业课 (数控/汽修/幼师/护理/电商/烹饪等) + 文化课基础。"
            "**不要用高考数学物理的深度**。给建议时优先考虑: "
            "专业技能怎么练、考证怎么排、实习怎么找。"
        ),
        "focus": "专业课实操 + 技能证书 + 就业竞争力",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"],
        "exam_context": "职高有文化课考试和技能考核两条线",
    },
    "junior_college": {
        "teaching": "用户在大专。聊课程设计、考证、实习、专升本、就业。",
        "focus": "实操能力 + 专升本路径",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"],
        "exam_context": "专升本/期末/技能证",
    },
    "bachelor": {
        "teaching": "用户在读本科。聊专业课、考研、科研、竞赛、实习。",
        "focus": "绩点 + 考研 + 实习 + 竞赛",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"],
        "exam_context": "期末/考研/四六级/竞赛",
    },
    "master": {
        "teaching": "用户在备考研究生。聊数学/英语/专业课的备考节奏和院校选择。",
        "focus": "考研科目 + 院校 + 复试",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points", "query_college", "search_policy"],
        "exam_context": "考研初试/复试",
    },
    "abroad": {
        "teaching": "用户准备留学。聊语言成绩、选校、文书、面试。",
        "focus": "语言 + 选校 + 文书",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points", "query_college", "compare_schools"],
        "exam_context": "雅思/托福/GRE/SAT + 申请季",
    },
    "working": {
        "teaching": "用户已工作。聊职业发展、转行、技能提升、考证。",
        "focus": "职业发展 + 可迁移技能",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"],
        "exam_context": "考证/职级",
    },
    "other": {
        "teaching": "先问清楚用户的学段和当前目标, 再给建议。",
        "focus": "先搞清楚需求",
        "tools": ["search_web", "add_mistake", "list_mistakes", "list_weak_points", "search_knowledge_points"],
        "exam_context": "未知",
    },
}

DEFAULT_PROFILE = STAGE_PROFILES["high"]


def normalize_stage(stage: Optional[str], education_stage: Optional[str] = None) -> str:
    """把任意来源的学段归一成受控 key

    支持中文 (users.stage) 和英文 (users.education_stage)。
    """
    s = (stage or "").strip()
    if s in STAGE_PROFILES:
        return s
    if s in STAGE_FROM_CHINESE:
        return STAGE_FROM_CHINESE[s]
    e = (education_stage or "").strip()
    if e in STAGE_PROFILES:
        return e
    return "high"


def get_profile(stage: Optional[str], education_stage: Optional[str] = None) -> Dict:
    key = normalize_stage(stage, education_stage)
    return dict(STAGE_PROFILES.get(key, DEFAULT_PROFILE), stage=key, label=STAGE_LABELS.get(key, key))


def allowed_tools(stage: Optional[str], education_stage: Optional[str] = None) -> List[str]:
    """该学段允许用的工具名 —— 志愿类工具只给高中生"""
    return get_profile(stage, education_stage)["tools"]


def is_high_school_stage(stage: Optional[str], education_stage: Optional[str] = None) -> bool:
    key = normalize_stage(stage, education_stage)
    return key == "high"


# ===== 情绪支持检测 (v1.3.0) =====

# 焦虑/崩溃信号 —— 命中就切换到"先安抚再拆解"模式
# 刻意保守: 只在**明确的**信号下触发, 否则会把正常提问都当成崩溃
ANXIOUS_PATTERNS = [
    # 明确的"完了"类
    "我完了", "完了", "没救了", "考不上", "上不了", "没希望", "放弃了",
    # 严重否定
    "我太差了", "我就是个废物", "废物", "垃圾", "什么都不行", "没救了",
    # 极端自责
    "都是我的错", "都怪我", "我不配", "恨自己",
    # 崩溃/哭
    "想哭", "哭了", "崩溃", "撑不住", "受不了了",
    # 考试后的极端反应
    "考砸了", "全错", "没及格", "垫底",
]

# 轻度过载信号 —— 不切换模式, 只是把讲题节奏放缓
OVERLOAD_PATTERNS = [
    "好多", "太多了", "学不完", "来不及", "压力好大", "焦虑", "慌",
    "烦", "累", "坚持不下去",
]


def detect_emotional_state(user_message: str) -> Dict:
    """检测学生的情绪状态

    Returns:
        {
          "state": "crisis" | "overloaded" | "normal",
          "signals": [...],       # 命中的信号
          "guidance": str,       # 给 prompt 的处理指引 (normal 时为空)
        }
    """
    if not user_message:
        return {"state": "normal", "signals": [], "guidance": ""}
    text = str(user_message)
    hit_crisis = [p for p in ANXIOUS_PATTERNS if p in text]
    hit_overload = [p for p in OVERLOAD_PATTERNS if p in text]

    if hit_crisis:
        return {
            "state": "crisis",
            "signals": hit_crisis,
            "guidance": (
                "⚠️ **学生现在情绪很糟, 先别讲道理、别讲方法、别甩知识点。**\n"
                "按这个顺序回应:\n"
                "1. **先接住情绪** (一句话): 承认他的感受是合理的, 不要立刻转折。\n"
                "2. **把问题缩小**: 别谈'中考'这种大词, 换成具体的一件小事 —— "
                "「先别管总分, 你把今天这张卷子拿出来, 我们只看选择题错的那几个」。\n"
                "3. **给一个今天就能做完的小动作**: 一个 15 分钟能完成的具体任务。\n"
                "4. **不要**在这次回答里堆方法论、堆知识点、堆鼓励的话。\n"
                "如果学生提到自伤/不想活这类的话, 立刻停止学习话题, "
                "明确建议他去找身边的大人 (父母/老师/心理老师) 或拨打心理援助热线。"
            ),
        }
    if hit_overload:
        return {
            "state": "overloaded",
            "signals": hit_overload,
            "guidance": (
                "学生有点吃力/焦虑 (但不是崩溃)。**把节奏降下来**: "
                "一次只讲一个点, 给具体的下一步动作, 少讲道理多讲动作。"
                "可以先问一句「你今天最想先解决哪一块?」帮他自己缩小范围。"
            ),
        }
    return {"state": "normal", "signals": [], "guidance": ""}
