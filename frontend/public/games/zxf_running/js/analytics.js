(function () {
    "use strict";

    var ZXF = window.ZXF || {};
    window.ZXF = ZXF;
    var sent = false;

    function createId(prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return prefix + "_" + window.crypto.randomUUID();
        }
        return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
    }

    function getStoredId(storage, key, prefix) {
        try {
            var value = storage.getItem(key);
            if (!value) {
                value = createId(prefix);
                storage.setItem(key, value);
            }
            return value;
        } catch (e) {
            return createId(prefix);
        }
    }

    function getTimezone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        } catch (e) {
            return "";
        }
    }

    ZXF.analytics = {
        track: function (userId) {
            if (sent || navigator.doNotTrack === "1") return;
            sent = true;

            var payload = {
                visitorId: getStoredId(localStorage, "zxf_visitor_id", "visitor"),
                sessionId: getStoredId(sessionStorage, "zxf_session_id", "session"),
                pageViewId: createId("page"),
                userId: userId || localStorage.getItem("zxf_user_id") || "",
                path: window.location.pathname,
                referrer: document.referrer,
                language: navigator.language || "",
                timezone: getTimezone(),
                screen: window.screen ? window.screen.width + "x" + window.screen.height : ""
            };

            fetch("/api/analytics/visit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                keepalive: true,
                cache: "no-store",
                credentials: "same-origin"
            }).catch(function () {});
        }
    };

    window.addEventListener("load", function () {
        setTimeout(function () {
            ZXF.analytics.track(localStorage.getItem("zxf_user_id") || "");
        }, 1500);
    }, { once: true });
})();
