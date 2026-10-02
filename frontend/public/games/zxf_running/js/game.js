(function () {
    "use strict";
    var ZXF = window.ZXF;
    if (!ZXF) return;

    // ========== 玩家形态更新 ==========
    function updatePlayerShape() {
        var player = ZXF.player;
        var wasH = player.h;

        player.ducking = ZXF.input.duckHeld && player.grounded;
        player.w = player.ducking ? player.duckW : player.standW;
        player.h = player.ducking ? player.duckH : player.standH;

        if (player.grounded || player.h !== wasH) {
            player.y = ZXF.GROUND_Y - player.h;
        }
    }

    // ========== 碰撞检测 ==========
    function getPlayerHitBox() {
        var player = ZXF.player;
        if (player.ducking) {
            var d = ZXF.HITBOX_DUCK;
            return {
                x: player.x + d.x,
                y: player.y + d.y,
                w: player.w - d.wPad,
                h: player.h - d.hPad
            };
        }
        var s = ZXF.HITBOX_STAND;
        return {
            x: player.x + s.x,
            y: player.y + s.y,
            w: player.w - s.wPad,
            h: player.h - s.hPad
        };
    }

    function collides(obstacle) {
        var pb = getPlayerHitBox();
        var ob = {
            x: obstacle.x + obstacle.hitPad,
            y: obstacle.y + obstacle.hitPad,
            w: obstacle.w - obstacle.hitPad * 2,
            h: obstacle.h - obstacle.hitPad * 2
        };
        return pb.x < ob.x + ob.w &&
               pb.x + pb.w > ob.x &&
               pb.y < ob.y + ob.h &&
               pb.y + pb.h > ob.y;
    }

    // ========== 生成障碍物 ==========
    var MIN_SPAWN_TIMER = 0.48;
    var MIN_OBSTACLE_GAP = 299;

    function getFlyingY(lane) {
        var cfg = ZXF.FLYING_LANES[lane];
        return ZXF.GROUND_Y - cfg.baseY - Math.random() * cfg.rangeY;
    }

    function spawnObstacle() {
        var game = ZXF.game;
        var W = ZXF.CANVAS_W;
        var groundY = ZXF.GROUND_Y;
        var speed = game.speed;

        // 动态最小间距（速度越快，间距越大）
        var dynamicMinGap = Math.max(MIN_OBSTACLE_GAP, speed * 0.55);

        // 检查与上一个障碍物的间距
        var lastObs = game.obstacles[game.obstacles.length - 1];
        if (lastObs && lastObs.x + lastObs.w > W - dynamicMinGap) {
            ZXF.spawnTimer = 0.1;
            return;
        }

        var flying = game.score > ZXF.FLYING_SCORE_THRESHOLD && Math.random() < ZXF.FLYING_CHANCE;

        if (flying) {
            spawnFlyingObstacle();
        } else {
            spawnGroundObstacle();
        }

        // 动态生成间隔
        var baseTimer = 0.92 + Math.random() * 0.78 - Math.min(game.score / 3200, 0.32);
        var speedAdjustedMin = Math.max(MIN_SPAWN_TIMER, dynamicMinGap / Math.max(speed, 1));
        ZXF.spawnTimer = Math.max(baseTimer, speedAdjustedMin) / ZXF.modifiers.densityMult;
    }

    // ========== v1.1.11+ 学业参谋部 — 知识点生成 (只加不减) ==========
    // 高一必修一背诵卡: 漂浮在空中, 玩家跳起来碰到 → +50 知识点分 + 屏幕飘字.
    // 不伤害玩家, 不替换任何原障碍物, 玩家可以选择不跳 (不会死).
    var STUDY_NOTE_SPAWN_INTERVAL = 2.2;   // 秒, 比原障碍物节奏慢很多, 不喧宾夺主
    var STUDY_NOTE_BONUS = 50;
    var STUDY_NOTE_FLY_Y_OFFSET = 240;     // 距 GROUND_Y 向上 240 px (跳跃高峰 ~ 150, 所以必须跳一下)
    var STUDY_NOTE_W = 110;
    var STUDY_NOTE_H = 56;

    function spawnStudyNote() {
        var game = ZXF.game;
        var pool = ZXF.STUDY_NOTES;
        if (!pool || !pool.length) return;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        game.studyNotes.push({
            x: ZXF.CANVAS_W + 20,
            y: ZXF.GROUND_Y - STUDY_NOTE_FLY_Y_OFFSET,
            w: STUDY_NOTE_W,
            h: STUDY_NOTE_H,
            subject: pick.subject,
            content: pick.content,
            from: pick.from,
            bobPhase: Math.random() * Math.PI * 2  // 浮动动画相位
        });
    }

    function spawnFlyingObstacle() {
        var game = ZXF.game;
        var W = ZXF.CANVAS_W;
        var lane = pickFlyingLane();
        var lcfg = ZXF.FLYING_LANES[lane];
        var speedMult = lcfg.speedMin + Math.random() * lcfg.speedRange;
        var cfg = ZXF.OBSTACLE_CFG.spriteBottle;

        game.obstacles.push({
            type: "spriteBottle",
            img: ZXF.images.spriteBottle,
            x: W + 30,
            y: getFlyingY(lane),
            w: cfg.w,
            h: cfg.h,
            hitPad: cfg.hitPad,
            lane: lane,
            speedMultiplier: speedMult
        });

        game.lastObstacleWasGround = false;
    }

    function pickFlyingLane() {
        var game = ZXF.game;
        var roll = Math.random();

        // 如果上一个障碍物是地面障碍物，避免生成 jump 高度（玩家正在跳跃）
        if (game.lastObstacleWasGround) {
            if (roll < 0.55) {
                return "duck";
            }
            return "high";
        }

        // 正常概率分布
        if (roll < 0.45) {
            return "duck";
        } else if (roll < 0.78) {
            return "jump";
        }
        return "high";
    }

    function spawnGroundObstacle() {
        var game = ZXF.game;
        var W = ZXF.CANVAS_W;
        var groundY = ZXF.GROUND_Y;
        var useAlt = Math.random() < 0.5;
        var type = useAlt ? "qiaoleziAlt" : "qiaolezi";
        var cfg = useAlt ? ZXF.OBSTACLE_CFG.qiaoleziAlt : ZXF.OBSTACLE_CFG.qiaolezi;

        game.obstacles.push({
            type: type,
            img: useAlt ? ZXF.images.qiaoleziAlt : ZXF.images.qiaolezi,
            x: W + 30,
            y: groundY - cfg.yOff,
            w: cfg.w,
            h: cfg.h,
            hitPad: cfg.hitPad,
            speedMultiplier: 1
        });

        game.lastObstacleWasGround = true;
    }

    // ========== 粒子效果 ==========
    ZXF.makeDust = function (x, y) {
        var dust = ZXF.game.dust;
        for (var i = 0; i < 6; i += 1) {
            dust.push({
                x: x - Math.random() * 18,
                y: y + Math.random() * 10,
                r: 2 + Math.random() * 4,
                vx: -80 - Math.random() * 120,
                life: 0.35 + Math.random() * 0.22
            });
        }
    };

    // ========== 得分显示 ==========
    function padScore(value) {
        return String(value).padStart(5, "0");
    }

    ZXF.updateScoreDisplay = function () {
        var scoreEl = ZXF.dom.scoreEl;
        var newText = padScore(ZXF.game.score || 0);
        if (scoreEl.textContent !== newText && ZXF.phase === "playing") {
            scoreEl.classList.remove("pop");
            void scoreEl.offsetWidth;
            scoreEl.classList.add("pop");
        }
        scoreEl.textContent = newText;
        ZXF.dom.bestEl.textContent = "BEST " + padScore(ZXF.bestScore);
    };

    // ========== 游戏状态管理 ==========
    ZXF.resetGame = function () {
        var input = ZXF.input;
        var player = ZXF.player;
        var game = ZXF.game;

        // 确保无敌模式关闭
        ZXF.modifiers.invincible = false;
        input.jumpHeld = false;
        input.duckHeld = false;
        player.w = player.standW;
        player.h = player.standH;
        player.y = ZXF.GROUND_Y - player.h;
        player.vy = 0;
        player.grounded = true;
        player.ducking = false;
        player.jumpHold = 0;
        game.speed = ZXF.INITIAL_SPEED * ZXF.modifiers.speedMult;
        game.distance = 0;
        game.score = 0;
        game.obstacles = [];
        game.dust = [];
        game.lastObstacleWasGround = false;
        game.dayTime = 6;
        // v1.1.11+ [学业参谋部] 重置知识点状态 (只加不减, 原 game 字段不动)
        game.studyNotes = [];
        game.studyNoteSpawnTimer = 1.5;  // 第一次延迟 1.5 秒出现, 让玩家先稳定节奏
        game.studyScore = 0;
        game.toasts = [];
        ZXF.spawnTimer = ZXF.INITIAL_SPAWN_TIMER / ZXF.modifiers.densityMult;
        ZXF.lastTime = performance.now();
    };

    ZXF.startGame = function () {
        if (ZXF.loadedCount !== Object.keys(ZXF.ASSET_PATHS).length) {
            ZXF.dom.overlayText.textContent = "素材还在加载，马上就能跑。";
            return;
        }

        if (ZXF.playBgm) ZXF.playBgm();
        ZXF.resetGame();
        ZXF.phase = "playing";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        ZXF.dom.overlay.classList.add("hidden");
        requestAnimationFrame(ZXF.loop);
    };

    ZXF.endGame = function () {
        if (ZXF.phase === "gameover") return;

        // PK 模式下玩家死亡：不走普通结束流程，进入等待对手状态
        if (ZXF.pk.mode === "racing" && !ZXF.pk.selfFinished) {
            if (ZXF.playDeathSound) ZXF.playDeathSound();
            ZXF.bestScore = Math.max(ZXF.bestScore, ZXF.game.score);
            localStorage.setItem("zhang-runner-best", String(ZXF.bestScore));
            ZXF.updateScoreDisplay();
            if (ZXF.saveScore) ZXF.saveScore(ZXF.game.score);
            ZXF.endPKGame();
            return;
        }

        ZXF.phase = "gameover";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        if (ZXF.playDeathSound) ZXF.playDeathSound();

        ZXF.bestScore = Math.max(ZXF.bestScore, ZXF.game.score);
        localStorage.setItem("zhang-runner-best", String(ZXF.bestScore));
        ZXF.updateScoreDisplay();
        if (ZXF.saveScore) ZXF.saveScore(ZXF.game.score);

        ZXF.dom.overlayText.textContent = "你跑不过我你信吗！按空格 / ↑ / 点击再跑一把。";
        ZXF.dom.startButton.textContent = "重来";
        ZXF.dom.overlay.classList.remove("hidden");
    };

    // ========== 跳跃 ==========
    ZXF.jump = function () {
        if (ZXF.phase === "ready" || ZXF.phase === "gameover") {
            ZXF.startGame();
            return;
        }

        var player = ZXF.player;
        if (player.grounded) {
            ZXF.input.duckHeld = false;
            player.ducking = false;
            player.vy = ZXF.JUMP_VELOCITY;
            player.grounded = false;
            player.jumpHold = ZXF.MAX_JUMP_HOLD;
            ZXF.makeDust(player.x + 36, ZXF.GROUND_Y - 9);
        }
    };

    // ========== 暂停 / 继续 ==========
    ZXF.pauseGame = function () {
        if (ZXF.phase !== "playing") return;
        ZXF._pausedPhase = ZXF.phase;
        ZXF.phase = "paused";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
    };

    ZXF.resumeGame = function () {
        if (ZXF.phase !== "paused") return;
        ZXF.phase = ZXF._pausedPhase || "playing";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        ZXF.lastTime = performance.now();
        requestAnimationFrame(ZXF.loop);
    };

    ZXF.restartFromPause = function () {
        ZXF.phase = "ready";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        ZXF.resetGame();
        ZXF.updateScoreDisplay();
        ZXF.drawFrame(0);
    };

    // ========== 3 秒倒计时 ==========
    ZXF.startCountdown = function (callback) {
        var overlay = document.getElementById("countdownOverlay");
        var text = document.getElementById("countdownText");
        if (!overlay || !text) {
            if (callback) callback();
            return;
        }

        var count = 3;
        var savedPhase = ZXF.phase;
        overlay.classList.remove("hidden");
        ZXF.phase = "countdown";

        function tick() {
            if (count > 0) {
                text.textContent = count;
                text.style.animation = "none";
                void text.offsetWidth;
                text.style.animation = "countBounce 0.6s ease";
                count--;
                setTimeout(tick, 900);
            } else {
                text.textContent = "GO!";
                text.style.animation = "none";
                void text.offsetWidth;
                text.style.animation = "countBounce 0.6s ease";
                setTimeout(function () {
                    overlay.classList.add("hidden");
                    text.textContent = "3";
                    ZXF.phase = savedPhase;
                    ZXF.lastTime = performance.now();
                    if (callback) callback();
                }, 600);
            }
        }

        tick();
    };

    // ========== 下蹲 ==========
    ZXF.setDuck = function (ducking) {
        ZXF.input.duckHeld = ducking;
        if (ZXF.phase !== "playing") return;

        var player = ZXF.player;
        if (!player.grounded && ducking && player.vy < 900) {
            player.vy += 420;
        }
    };

    // ========== 配置玩家精灵尺寸 ==========
    ZXF.configurePlayerSprites = function () {
        var player = ZXF.player;
        var imgs = ZXF.images;

        if (imgs.runner && imgs.runner.naturalWidth) {
            player.standH = 141;
            player.standW = Math.round(player.standH * imgs.runner.naturalWidth / imgs.runner.naturalHeight);
        }
        if (imgs.duck && imgs.duck.naturalWidth) {
            player.duckH = 97;
            player.duckW = Math.round(player.duckH * imgs.duck.naturalWidth / imgs.duck.naturalHeight);
        }
    };

    // ========== 主更新循环 ==========
    // ========== PK 辅助函数 ==========

    // 死亡后轮询对手结果（先 POST 自己再 GET 对手，每 2s 一次）
    var _pkPollTimer = null;
    var _pkPollCount = 0;
    var _pkMaxPollCount = 60;
    var _pkLastLiveSyncAt = 0;
    var _pkLiveSyncPending = false;
    var PK_LIVE_SYNC_INTERVAL = 1000;

    function pushPKProgress(alive, finished) {
        if (!ZXF.api || !ZXF.userId || !ZXF.pk.matchId) return Promise.resolve();
        return ZXF.api.syncPKProgress(ZXF.userId, ZXF.pk.matchId, {
            score: ZXF.game.score,
            distance: ZXF.game.distance,
            speed: ZXF.game.speed,
            alive: alive !== false,
            finished: finished === true
        });
    }

    ZXF.pk.syncLiveProgress = function (force) {
        var pk = ZXF.pk;
        if (!ZXF.api || !ZXF.userId || !pk.matchId) return;
        if (pk.mode !== "racing" || pk.selfFinished) return;

        var now = Date.now();
        if (!force && now - _pkLastLiveSyncAt < PK_LIVE_SYNC_INTERVAL) return;
        if (_pkLiveSyncPending) return;

        _pkLastLiveSyncAt = now;
        _pkLiveSyncPending = true;
        pushPKProgress(true, false).catch(function () {}).finally(function () {
            _pkLiveSyncPending = false;
        });
    };

    function applyPKSyncData(data) {
        if (!data || data.error) return false;

        var pk = ZXF.pk;
        pk.opponent.score = data.opponentScore || 0;
        pk.opponent.distance = data.opponentDistance || 0;
        pk.opponent.alive = data.opponentAlive !== false;
        pk.opponent.finished = data.opponentFinished === true;
        pk.selfFinished = data.selfFinished === true || pk.selfFinished;
        pk.bothFinished = data.bothFinished === true;
        pk.matchStatus = data.matchStatus || pk.matchStatus || "";
        return true;
    }

    function shouldSettlePK(data) {
        if (!data || data.error) return false;
        return data.bothFinished === true ||
            data.opponentFinished === true ||
            data.opponentAlive === false ||
            data.matchStatus === "completed";
    }

    ZXF.pk.startDeathPolling = function () {
        _pkPollCount = 0;
        if (_pkPollTimer) clearInterval(_pkPollTimer);

        function poll() {
            var pk = ZXF.pk;
            if (!ZXF.api || !pk.matchId) return;
            if (pk.mode === "result" || pk.finalizing) return;

            _pkPollCount++;

            // 每轮都确认自己的 finished 已落库，避免第一次 POST 失败后双方永远等待。
            pushPKProgress(false, true).then(function () {
                return ZXF.api.getOpponentProgress(pk.matchId, ZXF.userId);
            }).then(function (data) {
                if (applyPKSyncData(data) && shouldSettlePK(data)) {
                    ZXF.pk.finalizePKMatch(data);
                }
            }).catch(function () {});

            if (_pkPollCount >= _pkMaxPollCount) {
                ZXF.pk.finalizePKMatch();
            }
        }

        // 立即执行第一轮，后续每 2s 轮询
        poll();
        _pkPollTimer = setInterval(poll, 2000);
    };

    ZXF.pk.stopDeathPolling = function () {
        if (_pkPollTimer) {
            clearInterval(_pkPollTimer);
            _pkPollTimer = null;
        }
    };

    // PK 结算
    ZXF.pk.finalizePKMatch = function (latestData) {
        var pk = ZXF.pk;
        if (pk.mode === "result" || pk.finalizing) return;
        pk.finalizing = true;
        ZXF.pk.stopDeathPolling();

        function settle() {
            var myDistance = ZXF.game.distance;
            var oppDistance = pk.opponent.distance;
            var myScore = ZXF.game.score;
            var oppScore = pk.opponent.score;

            // 按距离判断胜负
            if (myDistance > oppDistance) {
                pk.result = "win";
            } else if (myDistance < oppDistance) {
                pk.result = "lose";
            } else {
                pk.result = "draw";
            }

            pk.mode = "result";
            pk.finalizing = false;
            ZXF.phase = "gameover";
            if (ZXF.refreshPresence) ZXF.refreshPresence();

            // 提交分数到排行榜。第四个参数确保 PK 成绩不进入纯净榜。
            if (ZXF.api && ZXF.userId) {
                ZXF.api.submitScore(
                    ZXF.userId,
                    myScore,
                    ZXF.modifiers.speedMult !== 1 || ZXF.modifiers.densityMult !== 1 || ZXF.modifiers.invincible,
                    true
                );
            }

            // 显示 PK 结果 UI
            if (ZXF.showPKResult) {
                ZXF.showPKResult(pk.result, myScore, oppScore, pk.opponentNickname, myDistance, oppDistance);
            }
        }

        applyPKSyncData(latestData);

        if (ZXF.api && ZXF.userId && pk.matchId) {
            var chain = Promise.resolve();
            if (pk.selfFinished) {
                chain = pushPKProgress(false, true);
            }
            chain.then(function () {
                return ZXF.api.getOpponentProgress(pk.matchId, ZXF.userId);
            }).then(function (data) {
                applyPKSyncData(data);
                settle();
            }).catch(function () {
                settle();
            });
        } else {
            settle();
        }
    };

    // 强制退出 PK（等待中点击按钮）
    ZXF.pk.forceQuitPK = function () {
        ZXF.pk.stopDeathPolling();
        // 确保服务器收到自己的死亡数据
        if (ZXF.api && ZXF.userId && ZXF.pk.matchId) {
            pushPKProgress(false, true).catch(function () {});
        }
        if (ZXF.resetToSoloMode) ZXF.resetToSoloMode();
    };

    // 玩家在 PK 中死亡
    ZXF.endPKGame = function () {
        var pk = ZXF.pk;
        pk.selfFinished = true;

        // 开始轮询（首次会先 POST 自己结果再 GET 对手）
        ZXF.pk.startDeathPolling();

        // 继续渲染循环（保持画面）
        ZXF.phase = "playing";
        ZXF.updateScoreDisplay();

        // 显示等待对手的提示
        if (ZXF.showPKWaiting) {
            ZXF.showPKWaiting(pk.opponentNickname);
        }
    };

    // 启动 PK 比赛（倒计时后调用）
    ZXF.pk.startPKRace = function () {
        var pk = ZXF.pk;

        // 强制重置所有关键状态
        ZXF.modifiers.invincible = false;
        pk.mode = "racing";
        pk.selfFinished = false;
        pk.bothFinished = false;
        pk.matchStatus = "";
        pk.finalizing = false;
        pk.result = null;
        pk.opponent.score = 0;
        pk.opponent.distance = 0;
        pk.opponent.alive = true;
        pk.opponent.finished = false;

        // 停止任何残留轮询
        ZXF.pk.stopDeathPolling();
        _pkLastLiveSyncAt = 0;
        _pkLiveSyncPending = false;

        // 隐藏所有可能阻挡的弹窗
        ZXF.dom.overlay.classList.add("hidden");
        var els = document.querySelectorAll(
            ".pk-result-overlay,.pk-matchmaking-overlay,.pk-match-found-overlay," +
            ".pk-waiting-overlay,.pk-invite-overlay,.player-popup,.profile-modal,.settings-modal,.help-modal"
        );
        for (var i = 0; i < els.length; i++) {
            els[i].classList.add("hidden");
        }
        var cdOv = document.getElementById("countdownOverlay");
        if (cdOv) cdOv.classList.add("hidden");

        ZXF.resetGame();
        ZXF.phase = "playing";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        ZXF.lastTime = performance.now();

        if (ZXF.playBgm) ZXF.playBgm();

        ZXF.drawFrame(0);
        ZXF.pk.syncLiveProgress(true);
        requestAnimationFrame(ZXF.loop);
    };

    ZXF.update = function (dt) {
        var player = ZXF.player;
        var game = ZXF.game;
        var input = ZXF.input;
        var groundY = ZXF.GROUND_Y;

        // PK 模式下自己已死亡，跳过物理但仍更新障碍物（保持画面滚动）
        if (ZXF.pk.selfFinished) {
            for (var i = 0; i < game.obstacles.length; i++) {
                game.obstacles[i].x -= game.speed * (game.obstacles[i].speedMultiplier || 1) * dt;
            }
            game.obstacles = game.obstacles.filter(function (obs) {
                return obs.x + obs.w > -40;
            });
            // 轮询由 endPKGame 中启动的 setInterval 处理
            return;
        }

        updatePlayerShape();

        // 跳跃蓄力
        if (input.jumpHeld && player.jumpHold > 0 && player.vy < 0 && !input.duckHeld) {
            player.vy += ZXF.JUMP_HOLD_FORCE * dt;
            player.jumpHold -= dt;
        } else {
            player.jumpHold = 0;
        }

        // 重力
        player.vy += (input.duckHeld && !player.grounded ? ZXF.FAST_DROP_GRAVITY : ZXF.GRAVITY) * dt;
        player.y += player.vy * dt;

        // 落地检测
        if (player.y >= groundY - player.h) {
            player.y = groundY - player.h;
            player.vy = 0;
            player.grounded = true;
            player.jumpHold = 0;
            updatePlayerShape();
        }

        // 速度与分数（分段加速，越跑越快）
        var speedStage = 1 + Math.floor(game.score / 800);
        var stageAccel = ZXF.SPEED_ACCEL * (1 + speedStage * 0.5) * ZXF.modifiers.speedMult;
        var speedCap = ZXF.MAX_SPEED * ZXF.modifiers.speedMult;
        game.speed = Math.min(speedCap, game.speed + stageAccel * dt);
        game.distance += game.speed * dt;
        game.dayTime += dt;
        game.score = Math.floor(game.distance / ZXF.SCORE_DIVISOR);
        if (ZXF.pk.mode === "racing") {
            ZXF.pk.syncLiveProgress(false);
        }

        // 生成障碍物
        ZXF.spawnTimer -= dt;
        if (ZXF.spawnTimer <= 0) {
            spawnObstacle();
        }

        // v1.1.11+ [学业参谋部] 知识点计时 (与原障碍物并行, 不影响节奏)
        game.studyNoteSpawnTimer -= dt;
        if (game.studyNoteSpawnTimer <= 0 && game.phase !== "dead") {
            spawnStudyNote();
            // 间隔随机: 2.0 ~ 4.0 秒 (原障碍物密度不变, 知识点稀疏, 不会冲突)
            game.studyNoteSpawnTimer = STUDY_NOTE_SPAWN_INTERVAL + Math.random() * 1.8;
        }

        // 更新障碍物位置
        for (var i = 0; i < game.obstacles.length; i++) {
            game.obstacles[i].x -= game.speed * (game.obstacles[i].speedMultiplier || 1) * dt;
        }
        game.obstacles = game.obstacles.filter(function (obs) {
            return obs.x + obs.w > -40;
        });

        // v1.1.11+ [学业参谋部] 更新知识点位置 + 收集碰撞 (不扣血, 只加分)
        var notes = game.studyNotes;
        var playerBox = getPlayerHitBox();
        for (var ni = notes.length - 1; ni >= 0; ni--) {
            var note = notes[ni];
            note.x -= game.speed * dt;
            // 浮动 bob 动画
            note.bobPhase += dt * 3.0;
            note._renderY = note.y + Math.sin(note.bobPhase) * 6;
            // 收集碰撞 (注: 玩家跳跃高度足以触到)
            if (playerBox.x < note.x + note.w &&
                playerBox.x + playerBox.w > note.x &&
                playerBox.y < note._renderY + note.h &&
                playerBox.y + playerBox.h > note._renderY) {
                // 命中: 飘字 + 加分 + 删除
                game.studyScore += STUDY_NOTE_BONUS;
                game.toasts.push({
                    text: "+" + STUDY_NOTE_BONUS + " " + note.subject + " · " + note.content,
                    x: note.x + note.w / 2,
                    y: note._renderY,
                    life: 1.4,
                    maxLife: 1.4,
                    color: ZXF.SUBJECT_COLORS[note.subject] || "#10b981"
                });
                notes.splice(ni, 1);
                continue;
            }
            // 飞出屏幕就清掉
            if (note.x + note.w < -40) {
                notes.splice(ni, 1);
            }
        }

        // v1.1.11+ 飘字 fade-out (从右往左上飘 + 渐隐)
        for (var ti = game.toasts.length - 1; ti >= 0; ti--) {
            var t = game.toasts[ti];
            t.life -= dt;
            t.y -= dt * 32;  // 向上飘
            t.x += dt * 24;  // 略微往右飘
            if (t.life <= 0) game.toasts.splice(ti, 1);
        }

        // 更新粒子
        for (var j = 0; j < game.dust.length; j++) {
            game.dust[j].x += game.dust[j].vx * dt;
            game.dust[j].life -= dt;
        }
        game.dust = game.dust.filter(function (dot) {
            return dot.life > 0;
        });

        // 碰撞检测（无敌模式下跳过）
        if (!ZXF.modifiers.invincible) {
            for (var k = 0; k < game.obstacles.length; k++) {
                if (collides(game.obstacles[k])) {
                    ZXF.endGame();
                    return;
                }
            }
        }

    };
})();
