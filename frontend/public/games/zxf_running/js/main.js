(function () {
    "use strict";
    var ZXF = window.ZXF;
    if (!ZXF) return;

    // ========== DOM 引用 ==========
    ZXF.dom = {
        canvas: document.getElementById("game"),
        scoreEl: document.getElementById("score"),
        bestEl: document.getElementById("best"),
        overlay: document.getElementById("overlay"),
        overlayText: document.getElementById("overlayText"),
        startButton: document.getElementById("startButton"),
        jumpButton: document.getElementById("jumpButton"),
        duckButton: document.getElementById("duckButton")
    };

    // ========== Canvas 上下文 ==========
    ZXF.ctx = ZXF.dom.canvas.getContext("2d");
    ZXF.dom.canvas.width = ZXF.CANVAS_W;
    ZXF.dom.canvas.height = ZXF.CANVAS_H;

    // ========== 音效 ==========
    var bgm = new Audio();
    bgm.loop = true;
    bgm.preload = "none";
    bgm.src = "assets/bgm.m4a";

    var deathSound = new Audio();
    deathSound.preload = "none";
    deathSound.src = "assets/death.mp3";

    var bgmPlayPending = false;
    var bgmShouldPlay = false;
    var bgmPausedByPage = false;
    var bgmResumeTimer = null;

    function applySoundSettings() {
        var s = ZXF.sound;
        bgm.volume = s.bgmMuted ? 0 : s.bgmVolume;
        deathSound.volume = s.sfxMuted ? 0 : s.sfxVolume;
    }
    applySoundSettings();

    function playBgmElement() {
        if (!bgm.paused || bgmPlayPending) return;
        bgmPlayPending = true;
        var playPromise = bgm.play();
        if (!playPromise || typeof playPromise.then !== "function") {
            bgmPlayPending = false;
            return;
        }
        playPromise.then(function () {
            bgmPlayPending = false;
        }).catch(function () {
            bgmPlayPending = false;
        });
    }

    function shouldResumeBgmAfterPageShow() {
        return ZXF.phase === "playing" ||
            ZXF.phase === "paused" ||
            ZXF.phase === "countdown";
    }

    function scheduleBgmResume() {
        if (!bgmShouldPlay || document.hidden) return;
        if (bgmResumeTimer) clearTimeout(bgmResumeTimer);
        bgmResumeTimer = setTimeout(function () {
            bgmResumeTimer = null;
            if (bgmShouldPlay && !document.hidden) {
                playBgmElement();
            }
        }, 80);
    }

    // 音量更新函数
    ZXF.setBgmVolume = function (v) {
        ZXF.sound.bgmVolume = v;
        ZXF.sound.bgmMuted = false;
        applySoundSettings();
    };
    ZXF.setSfxVolume = function (v) {
        ZXF.sound.sfxVolume = v;
        ZXF.sound.sfxMuted = false;
        applySoundSettings();
    };
    ZXF.toggleBgmMute = function () {
        ZXF.sound.bgmMuted = !ZXF.sound.bgmMuted;
        applySoundSettings();
        return ZXF.sound.bgmMuted;
    };
    ZXF.toggleSfxMute = function () {
        ZXF.sound.sfxMuted = !ZXF.sound.sfxMuted;
        applySoundSettings();
        return ZXF.sound.sfxMuted;
    };

    ZXF.playBgm = function () {
        bgmShouldPlay = true;
        scheduleBgmResume();
    };

    ZXF.pauseBgm = function () {
        bgmShouldPlay = false;
        if (bgmResumeTimer) {
            clearTimeout(bgmResumeTimer);
            bgmResumeTimer = null;
        }
        bgm.pause();
    };

    ZXF.toggleBgm = function () {
        if (bgm.paused) {
            ZXF.playBgm();
            return true;
        } else {
            ZXF.pauseBgm();
            return false;
        }
    };

    ZXF.isBgmPlaying = function () {
        return !bgm.paused;
    };

    ZXF.playDeathSound = function () {
        deathSound.currentTime = 0;
        deathSound.play().catch(function () {});
    };

    // ========== 切屏自动暂停/恢复音频 ==========
    function handlePageHide() {
        if (bgmPausedByPage) return;
        bgmPausedByPage = bgmShouldPlay && !bgm.paused;
        if (bgmPausedByPage) {
            bgm.pause();
        }
        // 同时暂停死亡音效
        deathSound.pause();
    }

    function handlePageShow() {
        if (bgmPausedByPage && shouldResumeBgmAfterPageShow()) {
            bgmShouldPlay = true;
            scheduleBgmResume();
        }
        bgmPausedByPage = false;
    }

    bgm.addEventListener("waiting", scheduleBgmResume);
    bgm.addEventListener("stalled", scheduleBgmResume);
    bgm.addEventListener("suspend", scheduleBgmResume);
    bgm.addEventListener("canplay", scheduleBgmResume);

    // visibilitychange：切标签页
    document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
            handlePageHide();
        } else {
            handlePageShow();
        }
    });

    // pagehide：退到桌面 / 锁屏（移动端更可靠）
    window.addEventListener("pagehide", function () {
        handlePageHide();
    });

    // pageshow：从后台恢复
    window.addEventListener("pageshow", function () {
        handlePageShow();
    });

    // freeze：页面被冻结（某些移动浏览器会冻结标签页）
    window.addEventListener("freeze", function () {
        handlePageHide();
    });

    // resume：页面解冻
    window.addEventListener("resume", function () {
        handlePageShow();
    });

    // ========== 最高分 ==========
    ZXF.bestScore = Number(localStorage.getItem("zhang-runner-best") || 0);

    // ========== 得分记录 ==========
    var SCORE_HISTORY_KEY = "zhang-runner-history";
    var MAX_HISTORY = 20;

    function getScoreHistory() {
        try {
            return JSON.parse(localStorage.getItem(SCORE_HISTORY_KEY) || "[]");
        } catch (e) {
            return [];
        }
    }

    ZXF.saveScore = function (score) {
        if (score <= 0) return;
        // 本地记录（保留作为备份）
        var history = getScoreHistory();
        history.push({ score: score, date: Date.now() });
        history.sort(function (a, b) { return b.score - a.score; });
        if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
        localStorage.setItem(SCORE_HISTORY_KEY, JSON.stringify(history));
        renderScoreHistory();

        // 在线提交分数
        if (ZXF.api && ZXF.userId && ZXF.pk.mode !== "racing") {
            var modifiersUsed = ZXF.modifiers.speedMult !== 1 || ZXF.modifiers.densityMult !== 1 || ZXF.modifiers.invincible;
            ZXF.api.submitScore(ZXF.userId, score, modifiersUsed).then(function (result) {
                if (result && !result.error && result.rank) {
                    // 可选：显示排名提示
                }
                // 提交后刷新排行榜
                if (ZXF.fetchLeaderboard) ZXF.fetchLeaderboard();
            }).catch(function () {});
        }
    };

    function renderScoreHistory() {
        var history = getScoreHistory();
        var list = document.getElementById("historyList");
        var count = document.getElementById("historyCount");
        if (!list || !count) return;
        count.textContent = history.length;
        list.innerHTML = history.map(function (entry, i) {
            var d = new Date(entry.date);
            var dateStr = d.getMonth() + 1 + "/" + d.getDate() + " " +
                          String(d.getHours()).padStart(2, "0") + ":" +
                          String(d.getMinutes()).padStart(2, "0");
            return "<li><span class=\"hist-rank\">#" + (i + 1) + "</span>" +
                   "<span class=\"hist-score\">" + String(entry.score).padStart(5, "0") + "</span>" +
                   "<span class=\"hist-date\">" + dateStr + "</span></li>";
        }).join("") || "<li class=\"hist-empty\">暂无记录</li>";
    }

    // ========== 在线排行榜 ==========
    ZXF.currentLeaderboardTab = true; // true = 纯净化

    ZXF.fetchLeaderboard = function () {
        if (!ZXF.api) return;
        var pureOnly = ZXF.currentLeaderboardTab;
        ZXF.api.getLeaderboard(20, 0, pureOnly).then(function (data) {
            if (data && !data.error && data.entries) {
                renderOnlineLeaderboard(data.entries, data.total);
            }
        }).catch(function () {});
    };

    function renderOnlineLeaderboard(entries, total) {
        var list = document.getElementById("leaderboardList");
        var lbCount = document.getElementById("lbCount");
        if (!list) return;
        if (lbCount) lbCount.textContent = total || entries.length;

        if (!entries.length) {
            list.innerHTML = "<li class=\"hist-empty\">暂无排行记录</li>";
            return;
        }

        list.innerHTML = entries.map(function (entry) {
            var isMe = ZXF.userId && entry.userId === ZXF.userId;
            var rowClass = isMe ? "lb-row lb-is-me" : "lb-row";
            var rankIcon = entry.rank <= 3
                ? ["🥇", "🥈", "🥉"][entry.rank - 1]
                : "#" + entry.rank;
            return "<li class=\"" + rowClass + "\" data-user-id=\"" + entry.userId + "\" data-nickname=\"" + escapeHtml(entry.nickname) + "\" data-score=\"" + entry.score + "\">" +
                   "<span class=\"lb-rank\">" + rankIcon + "</span>" +
                   "<span class=\"lb-dot\" data-uid=\"" + entry.userId + "\"></span>" +
                   "<span class=\"lb-nickname\">" + escapeHtml(entry.nickname) + "</span>" +
                   "<span class=\"lb-score\">" + String(entry.score).padStart(5, "0") + "</span>" +
                   "</li>";
        }).join("");

        // 批量查询在线状态
        var userIds = entries.map(function (e) { return e.userId; });
        if (userIds.length > 0 && ZXF.api) {
            ZXF.api.getOnlineStatus(userIds).then(function (data) {
                if (data && data.online) {
                    var dots = list.querySelectorAll(".lb-dot");
                    for (var d = 0; d < dots.length; d++) {
                        var uid = dots[d].getAttribute("data-uid");
                        dots[d].className = "lb-dot " + (data.online[uid] ? "online" : "");
                    }
                }
            }).catch(function () {});
        }

        // 绑定点击 → 弹出玩家资料
        var rows = list.querySelectorAll(".lb-row");
        for (var i = 0; i < rows.length; i++) {
            rows[i].addEventListener("click", function () {
                var uid = this.getAttribute("data-user-id");
                var nick = this.getAttribute("data-nickname");
                var score = this.getAttribute("data-score");
                if (uid && uid !== ZXF.userId) {
                    showPlayerPopup(uid, nick, score);
                }
            });
        }
    }

    // ========== 排行榜玩家弹窗 ==========
    function initPlayerPopup() {
        var popup = document.getElementById("playerPopup");
        var backdrop = popup ? popup.querySelector(".player-popup-backdrop") : null;
        var closeBtn = document.getElementById("popupClose");
        var addBtn = document.getElementById("popupAddFriend");

        if (!popup) return;

        function closePopup() {
            popup.classList.add("hidden");
            var msg = document.getElementById("popupMsg");
            if (msg) { msg.classList.add("hidden"); msg.textContent = ""; }
        }

        if (backdrop) backdrop.addEventListener("click", function (e) { e.stopPropagation(); closePopup(); });
        if (closeBtn) closeBtn.addEventListener("click", function (e) { e.stopPropagation(); closePopup(); });
        popup.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

        if (addBtn) {
            addBtn.addEventListener("click", function () {
                var targetId = addBtn.getAttribute("data-target-id");
                if (!targetId || !ZXF.api || !ZXF.userId) return;
                ZXF.api.addFriend(ZXF.userId, targetId).then(function (result) {
                    var msg = document.getElementById("popupMsg");
                    if (!msg) return;
                    msg.classList.remove("hidden");
                    if (result && result.ok) {
                        msg.textContent = "已添加好友!";
                        msg.className = "popup-msg success";
                        addBtn.disabled = true;
                        addBtn.textContent = "已添加";
                        renderFriendsSidebar();
                    } else if (result && result.error === "cannot_add_self") {
                        msg.textContent = "不能添加自己";
                        msg.className = "popup-msg error";
                    } else if (result && result.error === "user_not_found") {
                        msg.textContent = "未找到该用户";
                        msg.className = "popup-msg error";
                    } else {
                        msg.textContent = "添加失败，请稍后重试";
                        msg.className = "popup-msg error";
                    }
                }).catch(function () {});
            });
        }
    }

    function showPlayerPopup(userId, nickname, score) {
        var popup = document.getElementById("playerPopup");
        var nickEl = document.getElementById("popupNickname");
        var scoreEl = document.getElementById("popupBestScore");
        var addBtn = document.getElementById("popupAddFriend");
        var msg = document.getElementById("popupMsg");
        if (!popup) return;

        if (nickEl) nickEl.textContent = nickname;
        if (scoreEl) scoreEl.textContent = String(score).padStart(5, "0");
        if (addBtn) {
            addBtn.setAttribute("data-target-id", userId);
            addBtn.disabled = false;
            addBtn.textContent = "🤝 发送好友请求";
        }
        if (msg) { msg.classList.add("hidden"); msg.textContent = ""; }

        popup.classList.remove("hidden");
    }

    function escapeHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ========== PK 流程状态机 ==========
    var pkMatchmakingPollTimer = null;
    var pkMatchmakingCancelTimer = null;
    var pkCountdownTimer = null;

    function stopPKPolling() {
        if (pkMatchmakingPollTimer) {
            clearInterval(pkMatchmakingPollTimer);
            pkMatchmakingPollTimer = null;
        }
        if (pkMatchmakingCancelTimer) {
            clearTimeout(pkMatchmakingCancelTimer);
            pkMatchmakingCancelTimer = null;
        }
    }

    function stopPKCountdown() {
        if (pkCountdownTimer) {
            clearTimeout(pkCountdownTimer);
            pkCountdownTimer = null;
        }
    }

    function applyPKMatchInfo(result, fallbackName) {
        ZXF.pk.matchId = result.matchId;
        ZXF.pk.opponentId = result.opponentId;
        ZXF.pk.opponentNickname = result.opponentNickname || fallbackName || "对手";
        ZXF.pk.startAt = result.startAt || null;
        ZXF.pk.isFriendPK = result.isFriendPK === true;
        ZXF.pk.result = null;
        ZXF.pk.selfFinished = false;
        ZXF.pk.bothFinished = false;
        ZXF.pk.matchStatus = "";
        ZXF.pk.finalizing = false;
    }

    function showFriendInvitePrompt(invite) {
        var overlay = document.getElementById("pkInviteOverlay");
        var text = document.getElementById("pkInviteText");
        var acceptBtn = document.getElementById("pkInviteAccept");
        var declineBtn = document.getElementById("pkInviteDecline");
        if (!overlay || !acceptBtn || !declineBtn) return;

        applyPKMatchInfo(invite, "好友");
        ZXF.pk.mode = "friend_invite";
        if (text) text.textContent = (ZXF.pk.opponentNickname || "好友") + " 邀请你进行 PK，是否接受？";
        overlay.classList.remove("hidden");
        if (ZXF.refreshPresence) ZXF.refreshPresence();

        var newAccept = acceptBtn.cloneNode(true);
        var newDecline = declineBtn.cloneNode(true);
        acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
        declineBtn.parentNode.replaceChild(newDecline, declineBtn);

        newAccept.addEventListener("click", function (e) {
            e.stopPropagation();
            newAccept.disabled = true;
            newDecline.disabled = true;
            ZXF.api.respondFriendPK(ZXF.userId, invite.matchId, "accept").then(function (result) {
                if (result && !result.error && result.status === "matched") {
                    overlay.classList.add("hidden");
                    applyPKMatchInfo(result, "好友");
                    ZXF.pk.mode = "matched";
                    ZXF.startPKCountdown();
                } else {
                    overlay.classList.add("hidden");
                    ZXF.pk.mode = "solo";
                    alert("该 PK 邀请已失效");
                    if (ZXF.refreshPresence) ZXF.refreshPresence();
                }
            }).catch(function () {
                overlay.classList.add("hidden");
                ZXF.pk.mode = "solo";
                alert("网络错误");
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            });
        });

        newDecline.addEventListener("click", function (e) {
            e.stopPropagation();
            newAccept.disabled = true;
            newDecline.disabled = true;
            ZXF.api.respondFriendPK(ZXF.userId, invite.matchId, "decline").finally(function () {
                overlay.classList.add("hidden");
                ZXF.pk.mode = "solo";
                ZXF.pk.matchId = null;
                ZXF.pk.opponentId = null;
                ZXF.pk.opponentNickname = null;
                ZXF.pk.startAt = null;
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            });
        });
    }

    function waitForFriendPKAccept(matchId) {
        stopPKPolling();
        var overlay = document.getElementById("pkMatchmakingOverlay");
        var text = document.getElementById("pkMatchmakingText");
        if (overlay) overlay.classList.remove("hidden");
        if (text) text.textContent = "等待好友接受 PK...";

        var startTime = Date.now();
        pkMatchmakingPollTimer = setInterval(function () {
            if (ZXF.pk.mode !== "friend_waiting") return;
            ZXF.api.pollMatchStatus(ZXF.userId).then(function (result) {
                if (ZXF.pk.mode !== "friend_waiting") return;
                if (result && !result.error && result.status === "matched") {
                    stopPKPolling();
                    if (overlay) overlay.classList.add("hidden");
                    applyPKMatchInfo(result, "好友");
                    ZXF.pk.mode = "matched";
                    ZXF.startPKCountdown();
                } else if (result && !result.error && result.status === "pending") {
                    if (text) {
                        var elapsed = Math.floor((Date.now() - startTime) / 1000);
                        text.textContent = "等待好友接受 PK... (已等待 " + elapsed + "s)";
                    }
                } else if (result && (result.status === "not_in_queue" || result.status === "cancelled")) {
                    stopPKPolling();
                    if (overlay) overlay.classList.add("hidden");
                    ZXF.pk.mode = "solo";
                    ZXF.pk.matchId = null;
                    alert("好友已拒绝或邀请已失效");
                    if (ZXF.refreshPresence) ZXF.refreshPresence();
                }
            }).catch(function () {});
        }, 2000);

        pkMatchmakingCancelTimer = setTimeout(function () {
            if (ZXF.pk.mode === "friend_waiting") {
                ZXF.cancelPKMatchmaking();
                alert("好友长时间未响应，PK 邀请已取消");
            }
        }, 30000);
    }

    ZXF.startPKMatchmaking = function () {
        if (!ZXF.api || !ZXF.userId) return;
        if (ZXF.phase !== "ready" && ZXF.phase !== "gameover") return;

        ZXF.pk.mode = "matchmaking";
        ZXF.pk.matchId = null;
        ZXF.pk.opponentId = null;
        ZXF.pk.opponentNickname = null;
        ZXF.pk.startAt = null;
        ZXF.pk.isFriendPK = false;
        ZXF.pk.result = null;
        ZXF.pk.selfFinished = false;
        ZXF.pk.bothFinished = false;
        ZXF.pk.matchStatus = "";
        ZXF.pk.finalizing = false;
        stopPKCountdown();
        if (ZXF.refreshPresence) ZXF.refreshPresence();

        var overlay = document.getElementById("pkMatchmakingOverlay");
        var text = document.getElementById("pkMatchmakingText");
        if (overlay) overlay.classList.remove("hidden");
        if (text) text.textContent = "正在匹配对手...";

        var startTime = Date.now();
        var joined = false;

        function doJoin() {
            ZXF.api.joinPKQueue(ZXF.userId).then(function (result) {
                if (ZXF.pk.mode !== "matchmaking") return;

                if (result && !result.error) {
                    if (result.status === "matched") {
                        // 匹配成功！
                        applyPKMatchInfo(result, "对手");
                        stopPKPolling();
                        ZXF.pk.mode = "matched";
                        if (overlay) overlay.classList.add("hidden");
                        ZXF.startPKCountdown();
                    } else if (result.status === "waiting") {
                        joined = true;
                        if (text) {
                            var elapsed = Math.floor((Date.now() - startTime) / 1000);
                            text.textContent = "正在匹配对手... (已等待 " + elapsed + "s)";
                        }
                    }
                }
            }).catch(function () {});
        }

        // 立即加入队列，然后每 2s 轮询
        doJoin();
        pkMatchmakingPollTimer = setInterval(doJoin, 2000);

        // 60s 超时
        pkMatchmakingCancelTimer = setTimeout(function () {
            if (ZXF.pk.mode === "matchmaking") {
                ZXF.cancelPKMatchmaking();
                if (text) text.textContent = "匹配超时，请稍后重试";
                setTimeout(function () {
                    if (overlay) overlay.classList.add("hidden");
                }, 2000);
            }
        }, 60000);
    };

    ZXF.cancelPKMatchmaking = function () {
        stopPKPolling();
        stopPKCountdown();
        if (ZXF.api && ZXF.userId) {
            ZXF.api.cancelPKQueue(ZXF.userId).catch(function () {});
        }
        ZXF.pk.mode = "solo";
        ZXF.pk.startAt = null;
        if (ZXF.refreshPresence) ZXF.refreshPresence();
        var overlay = document.getElementById("pkMatchmakingOverlay");
        if (overlay) overlay.classList.add("hidden");
        var inviteOverlay = document.getElementById("pkInviteOverlay");
        if (inviteOverlay) inviteOverlay.classList.add("hidden");
    };

    ZXF.startPKCountdown = function () {
        stopPKCountdown();
        ZXF.pk.mode = "countdown";

        // 隐藏所有弹窗
        ZXF.dom.overlay.classList.add("hidden");
        var matchFoundOverlay = document.getElementById("pkMatchFoundOverlay");
        var matchFoundText = document.getElementById("pkMatchFoundText");
        if (matchFoundOverlay && matchFoundText) {
            matchFoundText.textContent = "找到对手: " + (ZXF.pk.opponentNickname || "对手");
            matchFoundOverlay.classList.remove("hidden");
        }
        var inviteOverlay = document.getElementById("pkInviteOverlay");
        if (inviteOverlay) inviteOverlay.classList.add("hidden");

        // 用 countdownOverlay 显示倒计时，并尽量按服务端 startAt 同步开赛
        var cdOverlay = document.getElementById("countdownOverlay");
        var cdText = document.getElementById("countdownText");
        if (!cdOverlay || !cdText) {
            // 没有倒计时元素，直接开跑
            if (matchFoundOverlay) matchFoundOverlay.classList.add("hidden");
            ZXF.pk.startPKRace();
            return;
        }

        // 阻止可能干扰的状态
        ZXF.pk.mode = "countdown";
        ZXF.phase = "countdown";
        cdOverlay.classList.remove("hidden");
        if (ZXF.refreshPresence) ZXF.refreshPresence();

        var startAt = Number(ZXF.pk.startAt || 0);
        if (!startAt || startAt < Date.now() + 500) {
            startAt = Date.now() + 3300;
            ZXF.pk.startAt = startAt;
        }
        var lastShown = null;

        function tick() {
            var remaining = startAt - Date.now();
            if (remaining > 0) {
                var shown = Math.max(1, Math.ceil(remaining / 1000));
                cdText.textContent = shown;
                if (shown !== lastShown) {
                    cdText.style.animation = "none";
                    void cdText.offsetWidth;
                    cdText.style.animation = "countBounce 0.6s ease";
                    lastShown = shown;
                }
                pkCountdownTimer = setTimeout(tick, Math.min(200, remaining));
            } else {
                cdText.textContent = "GO!";
                cdText.style.animation = "none";
                void cdText.offsetWidth;
                cdText.style.animation = "countBounce 0.6s ease";
                pkCountdownTimer = setTimeout(function () {
                    pkCountdownTimer = null;
                    cdOverlay.classList.add("hidden");
                    cdText.textContent = "3";
                    if (matchFoundOverlay) matchFoundOverlay.classList.add("hidden");
                    // 直接启动 PK，不依赖 savedPhase
                    ZXF.pk.startPKRace();
                }, 600);
            }
        }
        tick();
    };

    ZXF.showPKResult = function (result, myScore, oppScore, oppName, myDistance, oppDistance) {
        var overlay = document.getElementById("pkResultOverlay");
        var title = document.getElementById("pkResultTitle");
        var detail = document.getElementById("pkResultDetail");

        if (!overlay) return;

        // 隐藏等待界面
        var waitingOverlay = document.getElementById("pkWaitingOverlay");
        if (waitingOverlay) waitingOverlay.classList.add("hidden");

        overlay.classList.remove("hidden");

        if (title) {
            if (result === "win") {
                title.textContent = "你赢了! 🎉";
                title.className = "pk-result-win";
            } else if (result === "lose") {
                title.textContent = "你输了! 💀";
                title.className = "pk-result-lose";
            } else {
                title.textContent = "平局! 🤝";
                title.className = "pk-result-draw";
            }
        }

        // 显示分数和距离
        var myDist = myDistance || 0;
        var oppDist = oppDistance || 0;
        if (detail) {
            detail.innerHTML =
                "<div class=\"pk-result-row\"><span>你</span><span class=\"pk-result-score\">" + String(myScore).padStart(5, "0") + "分</span><span class=\"pk-result-dist\">" + Math.floor(myDist) + "m</span></div>" +
                "<div class=\"pk-result-row\"><span>" + escapeHtml(oppName || "对手") + "</span><span class=\"pk-result-score\">" + String(oppScore).padStart(5, "0") + "分</span><span class=\"pk-result-dist\">" + Math.floor(oppDist) + "m</span></div>";
        }

        // 刷新排行榜
        if (ZXF.fetchLeaderboard) ZXF.fetchLeaderboard();
    };

    ZXF.showPKWaiting = function (oppName) {
        var overlay = document.getElementById("pkWaitingOverlay");
        var text = document.getElementById("pkWaitingText");
        if (!overlay) return;
        overlay.classList.remove("hidden");
        if (text) {
            text.textContent = "你已阵亡！等待 " + (oppName || "对手") + " 结束比赛...";
        }
        // 绑定强制退出按钮（每次 show 都重新绑定，确保事件有效）
        var quitBtn = document.getElementById("pkForceQuitBtn");
        if (quitBtn) {
            var newBtn = quitBtn.cloneNode(true);
            quitBtn.parentNode.replaceChild(newBtn, quitBtn);
            newBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                ZXF.pk.forceQuitPK();
            });
        }
    };

    ZXF.resetToSoloMode = function () {
        ZXF.pk.stopDeathPolling();
        stopPKCountdown();
        ZXF.pk.mode = "solo";
        ZXF.pk.matchId = null;
        ZXF.pk.opponentId = null;
        ZXF.pk.opponentNickname = null;
        ZXF.pk.startAt = null;
        ZXF.pk.isFriendPK = false;
        ZXF.pk.result = null;
        ZXF.pk.selfFinished = false;
        ZXF.pk.bothFinished = false;
        ZXF.pk.matchStatus = "";
        ZXF.pk.finalizing = false;
        ZXF.pk.opponent = { score: 0, distance: 0, alive: true, finished: false, lastUpdate: 0 };
        ZXF.phase = "ready";
        ZXF.resetGame();
        ZXF.updateScoreDisplay();
        ZXF.drawFrame(0);

        var resultOverlay = document.getElementById("pkResultOverlay");
        if (resultOverlay) resultOverlay.classList.add("hidden");
        var waitingOverlay = document.getElementById("pkWaitingOverlay");
        if (waitingOverlay) waitingOverlay.classList.add("hidden");
        var matchFoundOverlay = document.getElementById("pkMatchFoundOverlay");
        if (matchFoundOverlay) matchFoundOverlay.classList.add("hidden");
        var inviteOverlay = document.getElementById("pkInviteOverlay");
        if (inviteOverlay) inviteOverlay.classList.add("hidden");

        ZXF.dom.overlay.classList.remove("hidden");
        ZXF.dom.overlayText.textContent = "长按跳更高，按 ↓ 下蹲躲避雪碧<br>点击按钮或按空格开始游戏";
        ZXF.dom.startButton.textContent = "开始游戏";
        if (ZXF.refreshPresence) ZXF.refreshPresence();
    };

    function clearScoreHistory() {
        localStorage.removeItem(SCORE_HISTORY_KEY);
        renderScoreHistory();
    }

    // ========== 资源加载 ==========
    ZXF.loadedCount = 0;
    var assetKeys = Object.keys(ZXF.ASSET_PATHS);

    function loadAssets() {
        assetKeys.forEach(function (key) {
            var img = new Image();
            img.decoding = "async";
            img.fetchPriority = key === "runner" ? "high" : "auto";
            img.onload = onAssetLoad;
            img.onerror = onAssetLoad;
            img.src = ZXF.ASSET_PATHS[key];
            ZXF.images[key] = img;
        });
    }

    function onAssetLoad() {
        ZXF.loadedCount += 1;
        if (ZXF.loadedCount === assetKeys.length) {
            ZXF.configurePlayerSprites();
            updatePlayerShape();
            ZXF.drawFrame(0);
        }
    }

    function updatePlayerShape() {
        var player = ZXF.player;
        player.w = player.standW;
        player.h = player.standH;
        player.y = ZXF.GROUND_Y - player.h;
    }

    // ========== 游戏主循环 ==========
    ZXF.loop = function (now) {
        if (ZXF.phase !== "playing") return;

        var dt = Math.min((now - ZXF.lastTime) / 1000, ZXF.MAX_DT);
        ZXF.lastTime = now;

        ZXF.update(dt);
        ZXF.drawFrame(dt);
        ZXF.updateScoreDisplay();

        if (ZXF.phase === "playing") {
            requestAnimationFrame(ZXF.loop);
        }
    };

    // ========== 修改器面板 ==========
    function initModifierPanel() {
        var panel = document.getElementById("modifierPanel");
        if (!panel) return;

        // 折叠/展开
        var toggle = document.getElementById("modifierToggle");
        var body = document.getElementById("modifierBody");
        toggle.addEventListener("click", function () {
            var collapsed = body.classList.toggle("collapsed");
            toggle.querySelector(".toggle-arrow").textContent = collapsed ? "▶" : "▼";
        });

        // 选项按钮事件委托
        panel.addEventListener("click", function (e) {
            var btn = e.target.closest(".mod-option");
            if (!btn) return;
            var group = btn.closest(".modifier-options");
            var key = group.getAttribute("data-key");
            var value = parseFloat(btn.getAttribute("data-value"));

            ZXF.modifiers[key] = value;

            group.querySelectorAll(".mod-option").forEach(function (b) {
                b.classList.remove("active");
            });
            btn.classList.add("active");
        });
    }

    // ========== 帮助弹窗 ==========
    function initHelpModal() {
        var modal = document.getElementById("helpModal");
        var helpBtn = document.getElementById("helpButton");
        var closeBtn = document.getElementById("helpClose");
        var backdrop = modal ? modal.querySelector(".help-backdrop") : null;
        if (!modal || !helpBtn) return;

        var wasPlaying = false;

        function openModal() {
            wasPlaying = ZXF.phase === "playing";
            if (wasPlaying) ZXF.pauseGame();
            modal.classList.remove("hidden");
        }
        function closeModal() {
            modal.classList.add("hidden");
            localStorage.setItem("zxf_rules_read", "1");
            if (wasPlaying && ZXF.phase === "paused") {
                wasPlaying = false;
                ZXF.startCountdown(function () {
                    ZXF.resumeGame();
                });
            }
        }

        helpBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            openModal();
        });

        if (closeBtn) {
            closeBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                closeModal();
            });
        }

        if (backdrop) {
            backdrop.addEventListener("click", function (e) {
                e.stopPropagation();
                closeModal();
            });
        }

        // 阻止帮助弹窗内的点击事件传递到画布（避免触发跳跃）
        modal.addEventListener("pointerdown", function (e) {
            e.stopPropagation();
        });

        // ESC 关闭
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) {
                closeModal();
            }
        });
    }

    // ========== 设置面板 ==========
    function initSettingsModal() {
        var modal = document.getElementById("settingsModal");
        var btn = document.getElementById("settingsButton");
        var resumeBtn = document.getElementById("resumeButton");
        var restartBtn = document.getElementById("restartButton");
        var bgmSlider = document.getElementById("bgmVolume");
        var sfxSlider = document.getElementById("sfxVolume");
        var bgmLabel = document.getElementById("bgmVolumeLabel");
        var sfxLabel = document.getElementById("sfxVolumeLabel");

        if (!modal || !btn) return;

        function openSettings() {
            if (ZXF.phase === "playing") {
                ZXF.pauseGame();
            }
            modal.classList.remove("hidden");
        }

        function closeSettings() {
            modal.classList.add("hidden");
            if (ZXF.phase === "paused") {
                ZXF.resumeGame();
            }
        }

        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            openSettings();
        });

        // 面板内阻止事件冒泡到画布
        modal.addEventListener("pointerdown", function (e) {
            e.stopPropagation();
        });

        if (resumeBtn) {
            resumeBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                modal.classList.add("hidden");
                ZXF.startCountdown(function () {
                    ZXF.resumeGame();
                });
            });
        }

        if (restartBtn) {
            restartBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                ZXF.restartFromPause();
                modal.classList.add("hidden");
                ZXF.startCountdown(function () {
                    ZXF.startGame();
                });
            });
        }

        // 音量滑块
        if (bgmSlider) {
            bgmSlider.value = ZXF.sound.bgmVolume * 100;
            bgmSlider.addEventListener("input", function () {
                var v = bgmSlider.value / 100;
                ZXF.setBgmVolume(v);
                if (bgmLabel) bgmLabel.textContent = bgmSlider.value + "%";
            });
        }
        if (sfxSlider) {
            sfxSlider.value = ZXF.sound.sfxVolume * 100;
            sfxSlider.addEventListener("input", function () {
                var v = sfxSlider.value / 100;
                ZXF.setSfxVolume(v);
                if (sfxLabel) sfxLabel.textContent = sfxSlider.value + "%";
            });
        }

        // ESC 关闭
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) {
                closeSettings();
            }
        });

        // 防止设置面板打开时触发游戏控制
        window.addEventListener("keydown", function (e) {
            if (!modal.classList.contains("hidden") &&
                (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown")) {
                e.stopImmediatePropagation();
            }
        }, true);
    }

    // ========== 得分记录面板 ==========
    function initScoreHistoryPanel() {
        var toggle = document.getElementById("historyToggle");
        var body = document.getElementById("historyBody");
        if (!toggle || !body) return;

        toggle.addEventListener("click", function () {
            var expanded = body.classList.toggle("hidden");
            toggle.querySelector(".toggle-arrow").textContent = expanded ? "▶" : "▼";
        });

        var clearBtn = document.getElementById("clearHistory");
        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                clearScoreHistory();
            });
        }
    }

    // ========== 豆瓣二维码弹窗 ==========
    function initDouyinModal() {
        var modal = document.getElementById("douyinModal");
        var link = document.getElementById("douyinLink");
        var closeBtn = document.getElementById("douyinClose");
        var backdrop = modal ? modal.querySelector(".douyin-backdrop") : null;
        var qrImage = modal ? modal.querySelector("img[data-src]") : null;

        if (!modal || !link) return;

        var wasPlaying = false;

        link.addEventListener("click", function (e) {
            e.preventDefault();
            if (qrImage && !qrImage.src) {
                qrImage.src = qrImage.getAttribute("data-src");
            }
            wasPlaying = ZXF.phase === "playing";
            if (wasPlaying) ZXF.pauseGame();
            modal.classList.remove("hidden");
        });

        function closeModal() {
            modal.classList.add("hidden");
            if (wasPlaying && ZXF.phase === "paused") {
                wasPlaying = false;
                ZXF.startCountdown(function () {
                    ZXF.resumeGame();
                });
            }
        }

        if (closeBtn) {
            closeBtn.addEventListener("click", closeModal);
        }
        if (backdrop) {
            backdrop.addEventListener("click", closeModal);
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) {
                closeModal();
            }
        });
    }

    // ========== 好友侧边栏 ==========
    var friendsOnlineMap = {};
    var friendsAvailableMap = {};
    var onlinePollTimer = null;
    var heartbeatTimer = null;
    var incomingPKPollTimer = null;

    function initFriendsSidebar() {
        var toggle = document.getElementById("friendsToggle");
        var body = document.getElementById("friendsBody");
        if (!toggle || !body) return;

        toggle.addEventListener("click", function () {
            var collapsed = body.classList.toggle("hidden");
            toggle.querySelector(".toggle-arrow").textContent = collapsed ? "▶" : "▼";
            if (!collapsed) renderFriendsSidebar();
        });
    }

    function renderFriendsSidebar() {
        var container = document.getElementById("sidebarFriendsList");
        var countEl = document.getElementById("friendsOnlineCount");
        if (!container || !ZXF.api || !ZXF.userId) return;

        ZXF.api.getFriendsList(ZXF.userId).then(function (data) {
            if (!data || !data.friends) return;
            ZXF.friends = data.friends;

            if (data.friends.length === 0) {
                container.innerHTML = "<p class=\"friends-empty\">暂无好友</p>";
                if (countEl) countEl.textContent = "0";
                return;
            }

            // 拉在线状态（失败也继续渲染）
            var ids = data.friends.map(function (f) { return f.userId; });
            var onlinePromise = ZXF.api.getOnlineStatus(ids).then(function (onlineData) {
                if (onlineData && onlineData.online) {
                    friendsOnlineMap = onlineData.online;
                    friendsAvailableMap = onlineData.available || {};
                }
            }).catch(function () {});

            onlinePromise.then(function () {
                var onlineCount = 0;
                var html = "";
                for (var i = 0; i < data.friends.length; i++) {
                    var f = data.friends[i];
                    var isOnline = friendsOnlineMap[f.userId] === true;
                    var canPK = isOnline && friendsAvailableMap[f.userId] === true;
                    if (isOnline) onlineCount++;
                    html += "<div class=\"sidebar-friend-row\" data-friend-id=\"" + f.userId + "\">" +
                            "<span class=\"sidebar-online-dot " + (isOnline ? "online" : "offline") + "\"></span>" +
                            "<span class=\"sidebar-friend-name\">" + escapeHtml(f.nickname) + "</span>" +
                            "<span class=\"sidebar-friend-best\">" + String(f.bestScore || 0) + "</span>" +
                            "<button class=\"sidebar-pk-btn\" data-friend-id=\"" + f.userId + "\" title=\"" + (canPK ? "发起PK" : (isOnline ? "好友正忙" : "好友不在线")) + "\"" + (canPK ? "" : " disabled") + " style=\"opacity:" + (canPK ? "1" : "0.4") + "\">⚔</button>" +
                            "<button class=\"sidebar-del-btn\" data-friend-id=\"" + f.userId + "\" title=\"删除\">✕</button>" +
                            "</div>";
                }
                container.innerHTML = html;

                if (countEl) countEl.textContent = String(data.friends.length);

                // 绑定 PK 按钮
                var pkBtns = container.querySelectorAll(".sidebar-pk-btn");
                for (var p = 0; p < pkBtns.length; p++) {
                    pkBtns[p].addEventListener("click", function (e) {
                        e.stopPropagation();
                        var fid = this.getAttribute("data-friend-id");
                        if (friendsOnlineMap[fid] !== true || friendsAvailableMap[fid] !== true) {
                            alert(friendsOnlineMap[fid] === true ? "好友正忙，无法发起PK" : "好友不在线，无法发起PK");
                            return;
                        }
                        if (ZXF.phase === "playing" || ZXF.pk.mode === "racing") return;
                        startFriendPK(fid);
                    });
                }

                // 绑定删除按钮
                var delBtns = container.querySelectorAll(".sidebar-del-btn");
                for (var d = 0; d < delBtns.length; d++) {
                    delBtns[d].addEventListener("click", function (e) {
                        e.stopPropagation();
                        var fid = this.getAttribute("data-friend-id");
                        if (!ZXF.api || !ZXF.userId) return;
                        ZXF.api.removeFriend(ZXF.userId, fid).then(function () {
                            renderFriendsSidebar();
                        }).catch(function () {});
                    });
                }
            });
        }).catch(function () {});
    }

    // ========== 在线状态轮询 ==========
    function startOnlinePolling() {
        if (onlinePollTimer) return;
        doHeartbeat();
        heartbeatTimer = setInterval(doHeartbeat, 15000);
        onlinePollTimer = setInterval(refreshOnlineStatus, 5000);
        incomingPKPollTimer = setInterval(checkIncomingPKMatch, 2000);
    }

    function doHeartbeat() {
        if (!ZXF.api || !ZXF.userId) return;
        ZXF.api.heartbeat(ZXF.userId).then(function (res) {
            if (res && res.ok) {
                console.log('[online] heartbeat ok, userId=' + ZXF.userId);
            } else {
                console.warn('[online] heartbeat failed:', res);
            }
        }).catch(function (e) {
            console.warn('[online] heartbeat error:', e);
        });
    }
    ZXF.refreshPresence = doHeartbeat;

    function refreshOnlineStatus() {
        if (!ZXF.api || !ZXF.userId) return;

        var ids = ZXF.friends.map(function (f) { return f.userId; });
        if (ids.length > 0) {
            ZXF.api.getOnlineStatus(ids).then(function (data) {
                console.log('[online] status check:', data);
                if (data && data.online) {
                    friendsOnlineMap = data.online;
                    friendsAvailableMap = data.available || {};
                    updateOnlineDotsAndCount();
                }
            }).catch(function (e) {
                console.warn('[online] status check error:', e);
            });
        }
    }

    function updateOnlineDotsAndCount() {
        var dots = document.querySelectorAll(".sidebar-online-dot");
        var onlineCount = 0;
        for (var i = 0; i < dots.length; i++) {
            var row = dots[i].closest(".sidebar-friend-row");
            if (!row) continue;
            var fid = row.getAttribute("data-friend-id");
            var online = friendsOnlineMap[fid] === true;
            var canPK = online && friendsAvailableMap[fid] === true;
            if (online) onlineCount++;
            dots[i].className = "sidebar-online-dot " + (online ? "online" : "offline");
            var pkBtn = row.querySelector(".sidebar-pk-btn");
            if (pkBtn) {
                pkBtn.disabled = !canPK;
                pkBtn.style.opacity = canPK ? "1" : "0.4";
                pkBtn.title = canPK ? "发起PK" : (online ? "好友正忙" : "好友不在线");
            }
        }
        // 更新好友总数
        var countEl = document.getElementById("friendsOnlineCount");
        if (countEl) countEl.textContent = String(ZXF.friends.length);
    }

    function checkIncomingPKMatch() {
        if (!ZXF.api || !ZXF.userId) return;
        if (ZXF.pk.mode !== "solo") return;
        if (ZXF.phase !== "ready" && ZXF.phase !== "gameover") return;

        ZXF.api.pollMatchStatus(ZXF.userId).then(function (result) {
            if (!result || result.error) return;
            if (ZXF.pk.mode !== "solo") return;
            if (ZXF.phase !== "ready" && ZXF.phase !== "gameover") return;

            if (result.status === "pending" && result.isFriendPK && result.requiresResponse) {
                showFriendInvitePrompt(result);
                return;
            }

            if (result.status === "matched") {
                applyPKMatchInfo(result, "对手");
                ZXF.pk.mode = "matched";
                ZXF.startPKCountdown();
            }
        }).catch(function () {});
    }

    // ========== 个人中心 + 好友 ==========
    function initProfileUI() {
        var modal = document.getElementById("profileModal");
        var nickBtn = document.getElementById("nicknameDisplay");
        var closeBtn = document.getElementById("profileClose");
        var backdrop = modal ? modal.querySelector(".profile-backdrop") : null;
        var copyBtn = document.getElementById("copyUserId");
        var saveNickBtn = document.getElementById("saveNickname");
        var addFriendBtn = document.getElementById("addFriendBtn");
        var nickInput = document.getElementById("profileNicknameInput");

        if (!modal) return;

        var wasPlaying = false;

        function openProfile() {
            wasPlaying = ZXF.phase === "playing";
            if (wasPlaying) ZXF.pauseGame();
            modal.classList.remove("hidden");
            renderProfile();
        }

        function closeProfile() {
            modal.classList.add("hidden");
            if (wasPlaying && ZXF.phase === "paused") {
                wasPlaying = false;
                ZXF.startCountdown(function () { ZXF.resumeGame(); });
            }
        }

        if (nickBtn) {
            nickBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                openProfile();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                closeProfile();
            });
        }

        if (backdrop) {
            backdrop.addEventListener("click", function (e) {
                e.stopPropagation();
                closeProfile();
            });
        }

        // 阻止弹窗内点击冒泡
        modal.addEventListener("pointerdown", function (e) { e.stopPropagation(); });

        // 复制 ID
        if (copyBtn) {
            copyBtn.addEventListener("click", function () {
                var uidEl = document.getElementById("profileUserId");
                if (!uidEl) return;
                var text = uidEl.textContent;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(function () {
                        copyBtn.textContent = "已复制!";
                        setTimeout(function () { copyBtn.textContent = "复制"; }, 1500);
                    });
                }
            });
        }

        // 保存昵称
        if (saveNickBtn && nickInput) {
            saveNickBtn.addEventListener("click", function () {
                var newNick = nickInput.value.trim();
                if (!newNick || newNick.length < 1 || newNick.length > 20) return;
                if (!ZXF.api || !ZXF.userId) return;
                ZXF.api.updateNickname(ZXF.userId, newNick).then(function (result) {
                    if (result && !result.error) {
                        ZXF.nickname = result.nickname;
                        localStorage.setItem('zxf_nickname', result.nickname);
                        var display = document.getElementById("nicknameDisplay");
                        if (display) display.textContent = result.nickname;
                        saveNickBtn.textContent = "已保存!";
                        setTimeout(function () { saveNickBtn.textContent = "保存"; }, 1500);
                        if (ZXF.fetchLeaderboard) ZXF.fetchLeaderboard();
                    }
                }).catch(function () {});
            });
        }

        // 添加好友（直接添加，无需对方同意）
        if (addFriendBtn) {
            addFriendBtn.addEventListener("click", function () {
                var input = document.getElementById("addFriendInput");
                var msg = document.getElementById("addFriendMsg");
                if (!input || !msg || !ZXF.api || !ZXF.userId) return;
                var friendId = input.value.trim();
                if (!friendId) return;
                ZXF.api.addFriend(ZXF.userId, friendId).then(function (result) {
                    msg.classList.remove("hidden");
                    if (result && result.ok) {
                        msg.textContent = "已添加好友!";
                        msg.className = "profile-add-msg success";
                        input.value = "";
                        renderFriendsSidebar();
                    } else if (result && result.error === "cannot_add_self") {
                        msg.textContent = "不能添加自己";
                        msg.className = "profile-add-msg error";
                    } else if (result && result.error === "user_not_found") {
                        msg.textContent = "未找到该用户";
                        msg.className = "profile-add-msg error";
                    } else {
                        msg.textContent = "添加失败";
                        msg.className = "profile-add-msg error";
                    }
                }).catch(function () {
                    msg.classList.remove("hidden");
                    msg.textContent = "网络错误";
                    msg.className = "profile-add-msg error";
                });
            });
        }

        // ESC 关闭
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) {
                closeProfile();
            }
        });
    }

    function renderProfile() {
        var uidEl = document.getElementById("profileUserId");
        var nickInput = document.getElementById("profileNicknameInput");
        var bestEl = document.getElementById("profileBestScore");
        if (uidEl) uidEl.textContent = ZXF.userId || "";
        if (nickInput) nickInput.value = ZXF.nickname || "";
        if (bestEl) bestEl.textContent = String(ZXF.bestScore || 0).padStart(5, "0");
    }

    function startFriendPK(friendUserId) {
        if (!ZXF.api || !ZXF.userId) return;
        if (ZXF.phase === "playing" || ZXF.pk.mode === "racing") return;

        var profileModal = document.getElementById("profileModal");
        if (profileModal) profileModal.classList.add("hidden");

        ZXF.pk.mode = "friend_waiting";
        ZXF.pk.isFriendPK = true;
        ZXF.pk.startAt = null;
        ZXF.pk.result = null;
        ZXF.pk.selfFinished = false;
        ZXF.pk.bothFinished = false;
        ZXF.pk.matchStatus = "";
        ZXF.pk.finalizing = false;
        if (ZXF.refreshPresence) ZXF.refreshPresence();

        ZXF.api.joinFriendPK(ZXF.userId, friendUserId).then(function (result) {
            if (result && !result.error && result.status === "matched") {
                applyPKMatchInfo(result, "好友");
                ZXF.pk.mode = "matched";
                ZXF.startPKCountdown();
            } else if (result && !result.error && result.status === "pending") {
                applyPKMatchInfo(result, "好友");
                ZXF.pk.mode = "friend_waiting";
                waitForFriendPKAccept(result.matchId);
            } else if (result && result.error === "not_friends") {
                alert("请先添加好友后再发起PK");
                ZXF.pk.mode = "solo";
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            } else if (result && result.error === "friend_offline") {
                alert("好友不在线，无法发起PK");
                ZXF.pk.mode = "solo";
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            } else if (result && result.error === "friend_busy") {
                alert("好友正在对战中，请稍后再试");
                ZXF.pk.mode = "solo";
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            } else if (result && result.error === "self_busy") {
                alert("你已经在匹配或对战中");
                ZXF.pk.mode = "solo";
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            } else {
                alert("发起对战失败，好友可能离线");
                ZXF.pk.mode = "solo";
                ZXF.pk.isFriendPK = false;
                if (ZXF.refreshPresence) ZXF.refreshPresence();
            }
        }).catch(function () {
            alert("网络错误");
            ZXF.pk.mode = "solo";
            ZXF.pk.isFriendPK = false;
            if (ZXF.refreshPresence) ZXF.refreshPresence();
        });
    }

    // ========== PK UI 初始化 ==========
    function initPKUI() {
        // PK 对战按钮
        var pkButton = document.getElementById("pkButton");
        if (pkButton) {
            pkButton.addEventListener("click", function (e) {
                e.stopPropagation();
                if (ZXF.phase === "playing" || ZXF.pk.mode === "racing") return;
                ZXF.startPKMatchmaking();
            });
        }

        // 取消匹配按钮
        var pkCancelBtn = document.getElementById("pkCancelButton");
        if (pkCancelBtn) {
            pkCancelBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                ZXF.cancelPKMatchmaking();
            });
        }

        // PK 结果关闭按钮
        var pkResultClose = document.getElementById("pkResultClose");
        if (pkResultClose) {
            pkResultClose.addEventListener("click", function (e) {
                e.stopPropagation();
                ZXF.resetToSoloMode();
            });
        }

        // 阻止 PK 弹窗内的点击冒泡
        var pkOverlays = document.querySelectorAll(".pk-matchmaking-overlay, .pk-result-overlay, .pk-match-found-overlay, .pk-invite-overlay");
        for (var i = 0; i < pkOverlays.length; i++) {
            pkOverlays[i].addEventListener("pointerdown", function (e) {
                e.stopPropagation();
            });
        }
    }

    // ========== 在线排行榜 UI 初始化 ==========
    function initOnlineLeaderboardUI() {
        // 纯净/全部 tab 切换
        var tabs = document.querySelectorAll(".lb-tab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener("click", function () {
                var pure = this.getAttribute("data-pure") === "true";
                ZXF.currentLeaderboardTab = pure;
                // 更新 tab 激活状态
                var allTabs = document.querySelectorAll(".lb-tab");
                for (var j = 0; j < allTabs.length; j++) {
                    allTabs[j].classList.remove("active");
                }
                this.classList.add("active");
                if (ZXF.fetchLeaderboard) ZXF.fetchLeaderboard();
            });
        }

        // 刷新按钮
        var refreshBtn = document.getElementById("refreshLeaderboard");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                if (ZXF.fetchLeaderboard) ZXF.fetchLeaderboard();
            });
        }

        // 排行榜面板折叠
        var lbToggle = document.getElementById("leaderboardToggle");
        var lbBody = document.getElementById("leaderboardBody");
        if (lbToggle && lbBody) {
            lbToggle.addEventListener("click", function () {
                var collapsed = lbBody.classList.toggle("hidden");
                lbToggle.querySelector(".toggle-arrow").textContent = collapsed ? "▶" : "▼";
            });
        }
    }

    // ========== 禁止长按弹出菜单/选择（全局，输入框和弹窗除外） ==========
    function isEditable(el) {
        if (!el) return false;
        var tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function isInAllowedZone(el) {
        if (!el) return false;
        return !!(el.closest("#douyinModal") || el.closest("#profileModal") ||
                  el.closest("#helpModal") || el.closest("#settingsModal"));
    }

    document.addEventListener("contextmenu", function (e) {
        if (isInAllowedZone(e.target)) return;
        e.preventDefault();
    });
    document.addEventListener("selectstart", function (e) {
        if (isEditable(e.target) || isInAllowedZone(e.target)) return;
        e.preventDefault();
    });
    document.addEventListener("selectionchange", function () {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            var node = range.commonAncestorContainer;
            var el = node.nodeType === 3 ? node.parentElement : node;
            if (isEditable(el) || isInAllowedZone(el)) return;
            sel.removeAllRanges();
        }
    });

    // ========== 启动 ==========
    function initApp() {
        // 设置 API 基地址
        ZXF.api.BASE = window.location.origin;

        ZXF.updateScoreDisplay();
        ZXF.initInput();
        initModifierPanel();
        initScoreHistoryPanel();
        initHelpModal();
        initSettingsModal();
        initDouyinModal();
        initPKUI();
        initOnlineLeaderboardUI();
        initProfileUI();
        initFriendsSidebar();
        initPlayerPopup();
        renderScoreHistory();
        loadAssets();

        // 初始化昵称
        if (ZXF.api) {
            ZXF.api.getOrCreateNickname().then(function (result) {
                if (result && result.nickname) {
                    // 更新昵称显示
                    var nickDisplay = document.getElementById("nicknameDisplay");
                    if (nickDisplay) {
                        nickDisplay.textContent = result.nickname;
                        nickDisplay.classList.add("nickname-loaded");
                    }
                    if (ZXF.analytics) ZXF.analytics.track(result.userId);
                    // 加载好友列表和在线状态
                    renderFriendsSidebar();
                    startOnlinePolling();
                }
            }).catch(function () {});

            // 首次加载排行榜
            ZXF.fetchLeaderboard();

            // 新玩家首次访问自动弹出规则说明
            if (!localStorage.getItem("zxf_rules_read")) {
                setTimeout(function () {
                    var helpModal = document.getElementById("helpModal");
                    if (helpModal) {
                        helpModal.classList.remove("hidden");
                    }
                }, 800);
            }
        }
    }

    initApp();
})();
