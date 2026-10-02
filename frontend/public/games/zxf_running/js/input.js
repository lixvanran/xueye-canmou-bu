(function () {
    "use strict";
    var ZXF = window.ZXF;
    if (!ZXF) return;

    ZXF.initInput = function () {
        var dom = ZXF.dom;
        var jumpButton = dom.jumpButton;
        var duckButton = dom.duckButton;
        var startButton = dom.startButton;
        var canvas = dom.canvas;

        // ========== 键盘 ==========
        window.addEventListener("keydown", function (event) {
            if (event.code === "Space" || event.code === "ArrowUp") {
                event.preventDefault();
                if (ZXF.playBgm) ZXF.playBgm();
                ZXF.input.jumpHeld = true;
                ZXF.jump();
            } else if (event.code === "ArrowDown") {
                event.preventDefault();
                if (ZXF.playBgm) ZXF.playBgm();
                ZXF.setDuck(true);
            }
        });

        window.addEventListener("keyup", function (event) {
            if (event.code === "Space" || event.code === "ArrowUp") {
                event.preventDefault();
                ZXF.input.jumpHeld = false;
                ZXF.player.jumpHold = 0;
            } else if (event.code === "ArrowDown") {
                event.preventDefault();
                ZXF.setDuck(false);
            }
        });

        // ========== 防抖工具：避免 pointercancel 导致按钮闪烁 ==========
        function makeDebouncedControl(pressFn, releaseFn) {
            var pressed = false;
            var cancelTimer = null;

            function onDown(e) {
                e.preventDefault();
                if (cancelTimer) {
                    clearTimeout(cancelTimer);
                    cancelTimer = null;
                    return; // 这是 cancel 后的恢复，不重复触发 press
                }
                if (!pressed) {
                    pressed = true;
                    pressFn(e);
                }
            }

            function onUp(e) {
                e.preventDefault();
                cancelTimer = null;
                if (pressed) {
                    pressed = false;
                    releaseFn(e);
                }
            }

            function onCancel(e) {
                // pointercancel 时加短暂延迟再释放，避免误触发
                // 如果短时间内 pointerdown 重新触发，则取消此次释放
                if (pressed) {
                    cancelTimer = setTimeout(function () {
                        if (pressed) {
                            pressed = false;
                            releaseFn(e);
                        }
                        cancelTimer = null;
                    }, 80);
                }
            }

            return { down: onDown, up: onUp, cancel: onCancel };
        }

        // ========== 画布点击 ==========
        var canvasControl = makeDebouncedControl(
            function () {
                if (ZXF.playBgm) ZXF.playBgm();
                ZXF.input.jumpHeld = true;
                ZXF.jump();
            },
            function () {
                ZXF.input.jumpHeld = false;
                ZXF.player.jumpHold = 0;
            }
        );

        canvas.addEventListener("pointerdown", canvasControl.down);
        canvas.addEventListener("pointerup", canvasControl.up);
        canvas.addEventListener("pointercancel", canvasControl.cancel);

        // ========== 移动端跳跃按钮 ==========
        var jumpControl = makeDebouncedControl(
            function () {
                if (ZXF.playBgm) ZXF.playBgm();
                ZXF.input.jumpHeld = true;
                ZXF.jump();
            },
            function () {
                ZXF.input.jumpHeld = false;
                ZXF.player.jumpHold = 0;
            }
        );

        jumpButton.addEventListener("pointerdown", jumpControl.down);
        jumpButton.addEventListener("pointerup", jumpControl.up);
        jumpButton.addEventListener("pointerleave", jumpControl.up);
        jumpButton.addEventListener("pointercancel", jumpControl.cancel);

        // ========== 移动端下蹲按钮 ==========
        var duckControl = makeDebouncedControl(
            function () {
                if (ZXF.playBgm) ZXF.playBgm();
                ZXF.setDuck(true);
            },
            function () {
                ZXF.setDuck(false);
            }
        );

        duckButton.addEventListener("pointerdown", duckControl.down);
        duckButton.addEventListener("pointerup", duckControl.up);
        duckButton.addEventListener("pointerleave", duckControl.up);
        duckButton.addEventListener("pointercancel", duckControl.cancel);

        // ========== 开始按钮 ==========
        startButton.addEventListener("click", function () {
            if (ZXF.playBgm) ZXF.playBgm();
            ZXF.startGame();
        });
    };
})();
