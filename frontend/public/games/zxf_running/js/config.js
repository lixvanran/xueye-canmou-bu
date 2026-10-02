(function () {
    "use strict";
    var ZXF = window.ZXF || {};
    window.ZXF = ZXF;

    // ========== 移动端检测 ==========
    ZXF.isMobile = window.innerWidth <= 640;

    // ========== 画布尺寸 ==========
    ZXF.CANVAS_W = 1024;
    ZXF.CANVAS_H = 576;

    // ========== 物理常量 ==========
    ZXF.GROUND_Y = 475;
    ZXF.GRAVITY = 2507;
    ZXF.JUMP_VELOCITY = -875;
    ZXF.JUMP_HOLD_FORCE = -1547;
    ZXF.MAX_JUMP_HOLD = 0.18;
    ZXF.FAST_DROP_GRAVITY = 4160;

    // ========== 游戏参数 ==========
    ZXF.INITIAL_SPEED = 437;
    ZXF.MAX_SPEED = 768;
    ZXF.SPEED_ACCEL = 8;
    ZXF.SCORE_DIVISOR = 10;
    ZXF.MAX_DT = 0.033;
    ZXF.INITIAL_SPAWN_TIMER = 0.65;
    ZXF.FLYING_SCORE_THRESHOLD = 235;
    ZXF.FLYING_CHANCE = 0.35;

    // ========== 碰撞盒边距 ==========
    ZXF.HITBOX_STAND = { x: 12, y: 9, wPad: 21, hPad: 13 };
    ZXF.HITBOX_DUCK = { x: 11, y: 16, wPad: 19, hPad: 32 };

    // ========== 障碍物配置 ==========
    ZXF.OBSTACLE_CFG = {
        qiaolezi:      { w: 77,  h: 154, yOff: 126, hitPad: 10 },
        qiaoleziAlt:   { w: 70,  h: 143, yOff: 119, hitPad: 10 },
        spriteBottle:  { w: 143, h: 81,  hitPad: 14 }
    };

    // ========== 飞行障碍物高度配置 ==========
    ZXF.FLYING_LANES = {
        duck: { baseY: 177, rangeY: 13, speedMin: 1.04, speedRange: 0.28 },
        jump: { baseY: 102, rangeY: 17, speedMin: 0.94, speedRange: 0.22 },
        high: { baseY: 237, rangeY: 28, speedMin: 1.12, speedRange: 0.38 }
    };

    // ========== 资源路径 ==========
    ZXF.ASSET_PATHS = {
        runner: "assets/zhang-runner-v2.webp",
        duck: "assets/zhang-duck-v2.webp",
        qiaolezi: "assets/qiaolezi-v2.webp",
        qiaoleziAlt: "assets/qiaolezi-alt-v2.webp",
        spriteBottle: "assets/sprite-bottle-v2.webp"
    };

    // ========== 玩家初始状态 ==========
    ZXF.player = {
        x: 113,
        standW: 104,
        standH: 141,
        duckW: 111,
        duckH: 97,
        w: 104,
        h: 141,
        vy: 0,
        grounded: true,
        ducking: false,
        jumpHold: 0
    };
    ZXF.player.y = ZXF.GROUND_Y - ZXF.player.standH;

    // ========== 游戏状态 ==========
    ZXF.game = {
        speed: ZXF.INITIAL_SPEED,
        distance: 0,
        score: 0,
        obstacles: [],
        dust: [],
        lastObstacleWasGround: false,
        dayTime: 6,  // 游戏内起始时间（6点，日出）
        // ========== 学业参谋部 v1.1.11+ 课间解压：高一必修一背诵知识点（只加不减，不改原游戏） ==========
        studyNotes: [],
        studyNoteSpawnTimer: 0,
        studyScore: 0,       // 答对的知识点数（与原 game.score 独立累加）
        toasts: []            // 屏幕飘字: ['+50 语文·床前明月光', ...]
    };

    // ========== 高一必修一背诵知识点（来自人教版教材） ==========
    // 玩家跳跃碰到 → +50 知识点分 + 屏幕飘字. 不碰到不扣血, 不冲突原障碍物.
    // 设计: 知识点固定高度 = GROUND_Y - 240, 玩家跳跃高峰 ≈ 150, 所以"必须跳一下"才能吃到,
    //       但和"蹲避雪碧瓶"完全不冲突 (知识点在 jump lane 中部).
    ZXF.STUDY_NOTES = [
        // —— 语文 高一必修一 (古诗/课文) ——
        { subject: '语文', content: '床前明月光，疑是地上霜', from: '李白《静夜思》' },
        { subject: '语文', content: '会当凌绝顶，一览众山小', from: '杜甫《望岳》' },
        { subject: '语文', content: '少壮不努力，老大徒伤悲', from: '《长歌行》' },
        { subject: '语文', content: '学而不思则罔，思而不学则殆', from: '《论语》' },
        // —— 数学 高一必修一 (公式/概念) ——
        { subject: '数学', content: 'sin²α + cos²α = ?', from: '1' },
        { subject: '数学', content: '对数公式 logₐ(MN) = ?', from: 'logₐM + logₐN' },
        { subject: '数学', content: '集合交集 A∩B = ?', from: '{x|x∈A 且 x∈B}' },
        { subject: '数学', content: '一元二次方程求根公式', from: 'x = [-b±√(b²-4ac)] / 2a' },
        // —— 英语 高一必修一 (单词/词组) ——
        { subject: '英语', content: '你好', from: 'hello' },
        { subject: '英语', content: '谢谢你', from: 'thank you' },
        { subject: '英语', content: '再见', from: 'goodbye' },
        { subject: '英语', content: '一节课 45 分钟', from: 'a class lasts 45 minutes' },
        // —— 物理 高一必修一 (概念/定律) ——
        { subject: '物理', content: '牛顿第二定律 F = ?', from: 'ma (力=质量×加速度)' },
        { subject: '物理', content: '光在真空中的速度 c ≈ ?', from: '3×10⁸ m/s' },
        { subject: '物理', content: '自由落体加速度 g ≈ ?', from: '9.8 m/s²' },
        { subject: '物理', content: '动能公式 Eₖ = ?', from: '½mv²' },
        // —— 化学 高一必修一 (元素/方程式) ——
        { subject: '化学', content: '水的化学式', from: 'H₂O' },
        { subject: '化学', content: '二氧化碳的化学式', from: 'CO₂' },
        { subject: '化学', content: '氯化钠（食盐）的化学式', from: 'NaCl' },
        { subject: '化学', content: '1 mol 物质含粒子数', from: '6.02×10²³ (阿伏伽德罗常数)' },
        // —— 生物 高一必修一 ——
        { subject: '生物', content: '细胞的基本结构', from: '细胞膜·细胞质·细胞核' },
        { subject: '生物', content: 'DNA 双螺旋结构发现者', from: 'Watson & Crick (1953)' },
        { subject: '生物', content: '有丝分裂间期主要变化', from: 'DNA 复制 + 有关蛋白质合成' },
        // —— 政治 高一必修一 ——
        { subject: '政治', content: '我国根本政治制度', from: '人民代表大会制度' },
        { subject: '政治', content: '我国基本经济制度', from: '公有制为主体、多种所有制经济共同发展' },
        // —— 历史 高一必修一 ——
        { subject: '历史', content: '鸦片战争爆发于', from: '1840 年' },
        { subject: '历史', content: '中国共产党成立于', from: '1921 年 7 月 (中共一大)' },
        // —— 地理 高一必修一 ——
        { subject: '地理', content: '地球最厚的一层', from: '地幔' },
        { subject: '地理', content: '地球大气主要成分', from: 'N₂ (78%) + O₂ (21%)' }
    ];

    // ========== 知识点学科配色 (渲染用) ==========
    ZXF.SUBJECT_COLORS = {
        '语文': '#dc2626',  // 红
        '数学': '#2563eb',  // 蓝
        '英语': '#7c3aed',  // 紫
        '物理': '#0891b2',  // 青
        '化学': '#16a34a',  // 绿
        '生物': '#65a30d',  // 黄绿
        '政治': '#ea580c',  // 橙
        '历史': '#a16207',  // 棕
        '地理': '#0e7490'   // 深青
    };

    // ========== 输入状态 ==========
    ZXF.input = {
        jumpHeld: false,
        duckHeld: false
    };

    // ========== 游戏修改器 ==========
    ZXF.modifiers = {
        speedMult: 1,
        densityMult: 1,
        invincible: false
    };

    // ========== 音效设置 ==========
    ZXF.sound = {
        bgmVolume: 0.5,
        sfxVolume: 0.9,
        bgmMuted: false,
        sfxMuted: false
    };

    // ========== 运行时变量（非配置，由 main.js 初始化） ==========
    ZXF.phase = "ready";
    ZXF.spawnTimer = ZXF.INITIAL_SPAWN_TIMER;
    ZXF.lastTime = 0;
    ZXF.bestScore = 0;
    ZXF.images = {};

    // ========== 后端/用户 ==========
    ZXF.userId = null;
    ZXF.nickname = null;
    ZXF.friends = [];           // [{ userId, nickname, bestScore }]

    // ========== PK 模式状态 ==========
    ZXF.pk = {
        mode: "solo",           // "solo" | "matchmaking" | "friend_waiting" | "friend_invite" | "matched" | "countdown" | "racing" | "result"
        matchId: null,
        opponentId: null,
        opponentNickname: null,
        startAt: null,
        isFriendPK: false,      // 是否为好友对战
        opponent: {             // 对手最终结果（死亡后轮询获取）
            score: 0,
            distance: 0,
            alive: true,
            finished: false,
            lastUpdate: 0
        },
        result: null,           // "win" | "lose" | "draw" 比赛结束后
        queuePollTimer: null,   // 匹配轮询定时器 ID
        selfFinished: false,    // 自己是否已结束（等待对手）
        bothFinished: false,
        matchStatus: "",
        finalizing: false
    };
})();
