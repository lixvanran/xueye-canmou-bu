(function () {
    "use strict";
    var ZXF = window.ZXF;
    if (!ZXF) return;

    var ctx;

    // ========== 工具函数 ==========
    function roundedRect(x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function hexToRgb(hex) {
        return [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16)
        ];
    }

    function lerpRgb(c1, c2, t) {
        return [
            Math.round(c1[0] + (c2[0] - c1[0]) * t),
            Math.round(c1[1] + (c2[1] - c1[1]) * t),
            Math.round(c1[2] + (c2[2] - c1[2]) * t)
        ];
    }

    function rgbStr(c) {
        return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    }

    // ========== 星空数据 ==========
    var stars = [];
    var starsGenerated = false;

    function generateStars() {
        var W = ZXF.CANVAS_W;
        var skyH = ZXF.GROUND_Y;
        for (var i = 0; i < 80; i++) {
            stars.push({
                x: Math.random() * W,
                y: Math.random() * skyH * 0.72,
                r: 0.4 + Math.random() * 1.6,
                phase: Math.random() * Math.PI * 2,
                speed: 0.4 + Math.random() * 2.2
            });
        }
        starsGenerated = true;
    }

    // ========== 昼夜色彩关键帧 ==========
    var skyKeyframes = [
        [0,  hexToRgb("#06081a"), hexToRgb("#0a0c1e")],
        [3,  hexToRgb("#080a20"), hexToRgb("#0e0c20")],
        [4.5,hexToRgb("#101430"), hexToRgb("#2a1428")],
        [5.5,hexToRgb("#283050"), hexToRgb("#c05838")],
        [6,  hexToRgb("#3a4868"), hexToRgb("#e08048")],
        [7,  hexToRgb("#5878a0"), hexToRgb("#f0c070")],
        [8,  hexToRgb("#78a8d0"), hexToRgb("#f0e0b0")],
        [10, hexToRgb("#58a0d0"), hexToRgb("#c8e0f0")],
        [14, hexToRgb("#60a8d8"), hexToRgb("#d0e8f8")],
        [16, hexToRgb("#6898c0"), hexToRgb("#e0d8c8")],
        [17, hexToRgb("#405870"), hexToRgb("#e8b058")],
        [18, hexToRgb("#202840"), hexToRgb("#d05028")],
        [19, hexToRgb("#101428"), hexToRgb("#501820")],
        [20, hexToRgb("#080a20"), hexToRgb("#0e0c20")],
        [24, hexToRgb("#06081a"), hexToRgb("#0a0c1e")]
    ];

    function getSkyColors(hour) {
        var kf = skyKeyframes;
        if (hour <= kf[0][0]) return { top: kf[0][1], horizon: kf[0][2] };
        if (hour >= kf[kf.length - 1][0]) return { top: kf[kf.length - 1][1], horizon: kf[kf.length - 1][2] };
        for (var i = 0; i < kf.length - 1; i++) {
            if (hour >= kf[i][0] && hour <= kf[i + 1][0]) {
                var t = (hour - kf[i][0]) / (kf[i + 1][0] - kf[i][0]);
                return {
                    top: lerpRgb(kf[i][1], kf[i + 1][1], t),
                    horizon: lerpRgb(kf[i][2], kf[i + 1][2], t)
                };
            }
        }
        return { top: kf[0][1], horizon: kf[0][2] };
    }

    function skyBrightness(hour) {
        if (hour >= 8 && hour <= 16) return 1;
        if (hour >= 20 || hour <= 4) return 0;
        if (hour > 4 && hour < 8) return (hour - 4) / 4;
        if (hour > 16 && hour < 20) return 1 - (hour - 16) / 4;
        return 0;
    }

    // ========== 背景：昼夜天空 ==========
    function drawBackground() {
        var W = ZXF.CANVAS_W;
        var H = ZXF.CANVAS_H;
        var groundY = ZXF.GROUND_Y;
        var hour = ZXF.game.dayTime % 24;
        var colors = getSkyColors(hour);
        var bright = skyBrightness(hour);

        if (!starsGenerated) generateStars();

        // 天空渐变
        var skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
        skyGrad.addColorStop(0, rgbStr(colors.top));
        skyGrad.addColorStop(0.7, rgbStr(colors.horizon));
        skyGrad.addColorStop(1, rgbStr(lerpRgb(colors.horizon, [20, 24, 36], 0.5)));
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, groundY);

        // 星星
        if (bright < 0.5) {
            var starAlpha = 1 - bright * 2;
            for (var s = 0; s < stars.length; s++) {
                var star = stars[s];
                var twinkle = 0.5 + 0.5 * Math.sin(ZXF.game.dayTime * 3 + star.phase);
                var alpha = starAlpha * twinkle * (0.5 + 0.5 * (1 - star.y / (groundY * 0.72)));
                if (alpha < 0.02) continue;
                ctx.fillStyle = "rgba(255,255,255," + alpha.toFixed(2) + ")";
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 月亮
        if (hour >= 18 || hour <= 6) {
            var moonProgress = hour >= 18 ? (hour - 18) / 12 : (hour + 6) / 12;
            var moonX = W * 0.15 + moonProgress * W * 0.7;
            var moonY = groundY * 0.42 - Math.sin(moonProgress * Math.PI) * groundY * 0.28;
            var moonR = 26;

            var moonGlow = ctx.createRadialGradient(moonX, moonY, moonR * 0.8, moonX, moonY, moonR * 3);
            moonGlow.addColorStop(0, "rgba(220,220,255,0.25)");
            moonGlow.addColorStop(0.5, "rgba(180,180,220,0.08)");
            moonGlow.addColorStop(1, "rgba(180,180,220,0)");
            ctx.fillStyle = moonGlow;
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonR * 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#e8e8f8";
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "rgba(200,200,218,0.5)";
            ctx.beginPath(); ctx.arc(moonX - 6, moonY - 4, 5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(moonX + 8, moonY + 2, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(moonX - 2, moonY + 8, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(moonX + 5, moonY - 8, 3, 0, Math.PI * 2); ctx.fill();

            var crescentAlpha = 1 - Math.abs(moonProgress - 0.5) * 2;
            if (crescentAlpha > 0.05) {
                ctx.fillStyle = "rgba(20,18,30," + crescentAlpha.toFixed(2) + ")";
                ctx.beginPath();
                ctx.arc(moonX + moonR * 0.25, moonY, moonR * 1.05, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 太阳
        if (hour >= 6 && hour <= 18) {
            var sunProgress = (hour - 6) / 12;
            var sunX = W * 0.1 + sunProgress * W * 0.8;
            var sunY = groundY * 0.65 - Math.sin(sunProgress * Math.PI) * groundY * 0.5;
            var sunR = 22;

            var sunColor;
            if (sunProgress < 0.15) {
                sunColor = lerpRgb([255, 80, 30], [255, 200, 80], sunProgress / 0.15);
            } else if (sunProgress < 0.3) {
                sunColor = lerpRgb([255, 200, 80], [255, 245, 210], (sunProgress - 0.15) / 0.15);
            } else if (sunProgress < 0.7) {
                sunColor = [255, 245, 210];
            } else if (sunProgress < 0.85) {
                sunColor = lerpRgb([255, 245, 210], [255, 200, 80], (sunProgress - 0.7) / 0.15);
            } else {
                sunColor = lerpRgb([255, 200, 80], [255, 60, 20], (sunProgress - 0.85) / 0.15);
            }

            for (var g = 3; g >= 0; g--) {
                var glowR = sunR * (1.5 + g * 1.2);
                var glow = ctx.createRadialGradient(sunX, sunY, sunR * 0.8, sunX, sunY, glowR);
                glow.addColorStop(0, "rgba(" + sunColor[0] + "," + sunColor[1] + "," + sunColor[2] + "," + (0.3 - g * 0.06).toFixed(2) + ")");
                glow.addColorStop(1, "rgba(" + sunColor[0] + "," + sunColor[1] + "," + sunColor[2] + ",0)");
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(sunX, sunY, glowR, 0, Math.PI * 2);
                ctx.fill();
            }

            var sunBody = ctx.createRadialGradient(sunX - sunR * 0.15, sunY - sunR * 0.15, sunR * 0.1, sunX, sunY, sunR);
            sunBody.addColorStop(0, "rgba(255,255,255,1)");
            sunBody.addColorStop(0.3, rgbStr(sunColor));
            sunBody.addColorStop(1, "rgba(" + sunColor[0] + "," + sunColor[1] + "," + sunColor[2] + ",0.3)");
            ctx.fillStyle = sunBody;
            ctx.beginPath();
            ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
            ctx.fill();
        }

        // 云朵
        var cloudAlpha = bright;
        if (cloudAlpha > 0.02) {
            var cloudTint = lerpRgb([180, 180, 190], [255, 220, 180], Math.max(0, 1 - Math.abs(bright - 0.5) * 2));
            for (var ci = 0; ci < 5; ci++) {
                var cloudX = (W - ((ZXF.game.distance * 0.06 + ci * 260) % (W + 220))) + 40;
                var cloudY = 36 + (ci % 3) * 28;
                var ca = cloudAlpha * (0.45 + 0.55 * (1 - cloudY / groundY));
                ctx.fillStyle = "rgba(" + cloudTint[0] + "," + cloudTint[1] + "," + cloudTint[2] + "," + ca.toFixed(2) + ")";
                ctx.beginPath();
                ctx.ellipse(cloudX, cloudY, 44, 13, 0, 0, Math.PI * 2);
                ctx.ellipse(cloudX + 36, cloudY - 4, 26, 10, 0, 0, Math.PI * 2);
                ctx.ellipse(cloudX - 36, cloudY + 3, 24, 9, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        drawTreadmill();
    }

    // ========== 跑步机 ==========
    function drawTreadmill() {
        var W = ZXF.CANVAS_W;
        var H = ZXF.CANVAS_H;
        var groundY = ZXF.GROUND_Y;
        var game = ZXF.game;

        var beltTop = groundY;
        var beltH = 28;
        var deckTop = beltTop + beltH;
        var rollerR = 17;
        var rollerY = deckTop + rollerR + 6;

        // 地面
        var floorGrad = ctx.createLinearGradient(0, rollerY + rollerR, 0, H);
        floorGrad.addColorStop(0, "#10141c");
        floorGrad.addColorStop(1, "#0a0d13");
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, rollerY + rollerR + 4, W, H - rollerY - rollerR - 4);

        ctx.strokeStyle = "rgba(255,255,255,0.02)";
        ctx.lineWidth = 1;
        for (var gx = 0; gx < W; gx += 48) {
            ctx.beginPath();
            ctx.moveTo(gx, rollerY + rollerR + 4);
            ctx.lineTo(gx, H);
            ctx.stroke();
        }

        // 底座
        var baseGrad = ctx.createLinearGradient(0, deckTop, 0, rollerY + rollerR + 4);
        baseGrad.addColorStop(0, "#1e2230");
        baseGrad.addColorStop(0.5, "#181c28");
        baseGrad.addColorStop(1, "#141820");
        ctx.fillStyle = baseGrad;
        roundedRect(26, deckTop - 6, W - 52, rollerY + rollerR - deckTop + 17, 6);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        roundedRect(26, deckTop - 6, W - 52, rollerY + rollerR - deckTop + 17, 6);
        ctx.stroke();

        // 支撑脚
        var beltOffset = (game.distance * 1.2) % 52;
        var rollerAngle = (game.distance / rollerR) % (Math.PI * 2);

        function drawFoot(fx) {
            ctx.fillStyle = "#1c2030";
            ctx.fillRect(fx, rollerY + rollerR + 4, 12, 16);
            ctx.fillStyle = "#11141e";
            roundedRect(fx - 2, rollerY + rollerR + 16, 16, 5, 2);
            ctx.fill();
        }
        drawFoot(92);
        drawFoot(W - 104);

        // 滚轮
        function drawRoller(rx, ry, rr) {
            var shellGrad = ctx.createLinearGradient(rx - rr, 0, rx + rr, 0);
            shellGrad.addColorStop(0, "#2a2d3a");
            shellGrad.addColorStop(0.3, "#454860");
            shellGrad.addColorStop(0.5, "#525570");
            shellGrad.addColorStop(0.7, "#454860");
            shellGrad.addColorStop(1, "#2a2d3a");
            ctx.fillStyle = shellGrad;
            ctx.beginPath();
            ctx.arc(rx, ry, rr, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#1c1f2a";
            ctx.beginPath();
            ctx.arc(rx, ry, rr - 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#606478";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            for (var i = 0; i < 8; i++) {
                var a = rollerAngle + (i * Math.PI / 4);
                ctx.beginPath();
                ctx.moveTo(rx + Math.cos(a) * (rr - 7), ry + Math.sin(a) * (rr - 7));
                ctx.lineTo(rx + Math.cos(a) * 2.5, ry + Math.sin(a) * 2.5);
                ctx.stroke();
            }

            ctx.fillStyle = "#7a7d8e";
            ctx.beginPath();
            ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        drawRoller(55, rollerY, rollerR);
        drawRoller(W - 55, rollerY, rollerR);

        // 侧轨
        function drawSideRail(rx, rw) {
            var railGrad = ctx.createLinearGradient(rx, 0, rx + rw, 0);
            railGrad.addColorStop(0, "#181c28");
            railGrad.addColorStop(0.4, "#2a2e40");
            railGrad.addColorStop(0.5, "#353a4e");
            railGrad.addColorStop(0.6, "#2a2e40");
            railGrad.addColorStop(1, "#181c28");
            ctx.fillStyle = railGrad;
            roundedRect(rx, beltTop - 6, rw, beltH + 12, 5);
            ctx.fill();

            ctx.strokeStyle = "rgba(255,255,255,0.04)";
            ctx.lineWidth = 1;
            roundedRect(rx + 2, beltTop - 4, rw - 4, beltH + 8, 4);
            ctx.stroke();
        }

        drawSideRail(19, 21);
        drawSideRail(W - 40, 21);

        // LED 灯带
        function drawLEDStrip(lx, ly, lw) {
            ctx.fillStyle = "rgba(168, 85, 247, 0.12)";
            roundedRect(lx - 1, ly - 1, lw + 2, 4, 2);
            ctx.fill();

            ctx.fillStyle = "rgba(20, 15, 35, 0.85)";
            roundedRect(lx, ly, lw, 2, 1);
            ctx.fill();

            var dotCount = Math.floor(lw / 10);
            for (var d = 0; d < dotCount; d++) {
                var alpha = 0.4 + 0.6 * Math.abs(Math.sin(game.distance * 0.06 + d * 0.7));
                ctx.fillStyle = "rgba(168, 85, 247, " + alpha.toFixed(2) + ")";
                ctx.beginPath();
                ctx.arc(lx + 7 + d * 10, ly + 1, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        drawLEDStrip(45, beltTop - 3, W - 90);
        drawLEDStrip(45, beltTop + beltH + 1, W - 90);

        // 跑带
        ctx.save();
        roundedRect(45, beltTop + 2, W - 90, beltH - 2, 5);
        ctx.clip();

        var beltGrad = ctx.createLinearGradient(0, beltTop, 0, beltTop + beltH);
        beltGrad.addColorStop(0, "#161a24");
        beltGrad.addColorStop(0.5, "#1e2230");
        beltGrad.addColorStop(1, "#161a24");
        ctx.fillStyle = beltGrad;
        ctx.fillRect(45, beltTop, W - 90, beltH + 2);

        var treadW = 26;
        for (var tx = 45 - beltOffset; tx < W - 41; tx += treadW * 2) {
            ctx.fillStyle = "#131720";
            ctx.fillRect(tx, beltTop + 2, treadW, beltH - 2);

            ctx.strokeStyle = "#282e3c";
            ctx.lineWidth = 1;
            for (var gl = 0; gl < 3; gl++) {
                var gy = beltTop + 5 + gl * 9;
                ctx.beginPath();
                ctx.moveTo(tx + 3, gy);
                ctx.lineTo(tx + treadW - 3, gy);
                ctx.stroke();
            }
        }

        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 14]);
        ctx.lineDashOffset = -beltOffset;
        ctx.beginPath();
        ctx.moveTo(45, beltTop + beltH / 2);
        ctx.lineTo(W - 45, beltTop + beltH / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        var reflGrad = ctx.createLinearGradient(0, beltTop, 0, beltTop + 8);
        reflGrad.addColorStop(0, "rgba(255,255,255,0.06)");
        reflGrad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = reflGrad;
        ctx.fillRect(45, beltTop + 2, W - 90, 8);

        ctx.restore();

        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        roundedRect(45, beltTop + 2, W - 90, beltH - 2, 5);
        ctx.stroke();

        // 操控台
        var cx = W / 2 - 60;
        var cy = beltTop - 30;
        var cw = 119;
        var ch = 21;

        var consoleGrad = ctx.createLinearGradient(0, cy, 0, cy + ch);
        consoleGrad.addColorStop(0, "#222636");
        consoleGrad.addColorStop(0.5, "#2c3042");
        consoleGrad.addColorStop(1, "#1e2230");
        ctx.fillStyle = consoleGrad;
        roundedRect(cx, cy, cw, ch, 5);
        ctx.fill();

        ctx.strokeStyle = "rgba(168, 85, 247, 0.25)";
        ctx.lineWidth = 1;
        roundedRect(cx, cy, cw, ch, 5);
        ctx.stroke();

        ctx.fillStyle = "#0a0c14";
        roundedRect(cx + 4, cy + 4, cw - 8, ch - 8, 3);
        ctx.fill();

        var speedKph = Math.round(game.speed * 0.22);
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 9px 'JetBrains Mono', 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillText(speedKph + " km/h", cx + cw / 2, cy + 15);
        ctx.textAlign = "start";

        ctx.fillStyle = "#0d1018";
        ctx.fillRect(0, beltTop - 1, W, 2);
    }

    // ========== 玩家 ==========
    function drawPlayer() {
        var player = ZXF.player;
        var bob = player.grounded ? Math.sin(ZXF.game.distance / 18) * 2 : 0;
        var img = player.ducking ? ZXF.images.duck : ZXF.images.runner;

        if (img && img.complete && img.naturalWidth) {
            ctx.drawImage(img, player.x, player.y + bob, player.w, player.h);
        } else {
            ctx.fillStyle = "#ffcc80";
            ctx.fillRect(player.x, player.y + bob, player.w, player.h);
        }
    }

    // ========== 障碍物 ==========
    function drawObstacles() {
        var obstacles = ZXF.game.obstacles;
        for (var i = 0; i < obstacles.length; i++) {
            var obs = obstacles[i];
            if (obs.img && obs.img.complete && obs.img.naturalWidth) {
                ctx.drawImage(obs.img, obs.x, obs.y, obs.w, obs.h);
            } else {
                ctx.fillStyle = obs.type === "spriteBottle" ? "#22c55e" : "#8b5a2b";
                ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            }
        }
    }

    // ========== 粒子 ==========
    function drawDust(dt) {
        var dust = ZXF.game.dust;
        for (var i = 0; i < dust.length; i++) {
            var dot = dust[i];
            ctx.globalAlpha = Math.max(0, dot.life / 0.55);
            ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.r + dt, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    ZXF.drawFrame = function (dt) {
        ctx = ZXF.ctx;
        if (!ctx) return;
        drawBackground();
        drawDust(dt);
        drawObstacles();
        drawStudyNotes();
        drawToasts();
        drawPlayer();
        drawStudyScore();
    };

    // ========== v1.1.11+ 学业参谋部 — 知识点卡片渲染 (只加不减) ==========
    function drawStudyNotes() {
        var notes = ZXF.game.studyNotes;
        if (!notes || !notes.length) return;
        for (var i = 0; i < notes.length; i++) {
            var n = notes[i];
            var color = (ZXF.SUBJECT_COLORS && ZXF.SUBJECT_COLORS[n.subject]) || "#10b981";
            var x = n.x;
            var y = n._renderY || n.y;
            // 卡片背景: 圆角矩形 + 学科色边
            ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
            roundRect(ctx, x, y, n.w, n.h, 8);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            roundRect(ctx, x, y, n.w, n.h, 8);
            ctx.stroke();
            // 学科 tag (左上角小标签, 学科色填充)
            ctx.fillStyle = color;
            roundRect(ctx, x + 6, y + 6, 28, 16, 4);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(n.subject, x + 6 + 14, y + 6 + 9);
            // 题目正文
            ctx.fillStyle = "#1f2937";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(n.content, x + 6, y + 32, n.w - 12);
            // 答案 hint (右下角小字)
            ctx.fillStyle = "#9ca3af";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(n.from || "", x + n.w - 6, y + n.h - 8, n.w - 12);
        }
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ========== v1.1.11+ 飘字渲染 ==========
    function drawToasts() {
        var toasts = ZXF.game.toasts;
        if (!toasts || !toasts.length) return;
        for (var i = 0; i < toasts.length; i++) {
            var t = toasts[i];
            var alpha = Math.max(0, t.life / t.maxLife);
            ctx.globalAlpha = alpha;
            ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // 阴影
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
            ctx.fillText(t.text, t.x + 1, t.y + 1);
            // 主色
            ctx.fillStyle = t.color || "#10b981";
            ctx.fillText(t.text, t.x, t.y);
            ctx.globalAlpha = 1;
        }
    }

    // ========== v1.1.11+ 知识点总分 (左上角独立显示) ==========
    function drawStudyScore() {
        var s = ZXF.game.studyScore;
        if (!s) return;
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        roundRect(ctx, ZXF.CANVAS_W - 180, 12, 168, 32, 8);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("📚 知识点 +" + s, ZXF.CANVAS_W - 170, 28);
    }
})();
