(function () {
    "use strict";

    var state = {
        token: "",
        type: "visits",
        offset: 0,
        limit: 40,
        days: 14,
        total: 0,
        entries: [],
        refreshTimer: null
    };

    var dom = {};

    function byId(id) { return document.getElementById(id); }
    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
    }

    function formatTime(value) {
        var timestamp = Number(value) || 0;
        if (!timestamp) return "—";
        return new Intl.DateTimeFormat("zh-CN", {
            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false
        }).format(new Date(timestamp));
    }

    function shortId(value) {
        value = String(value || "");
        if (value.length <= 16) return value || "—";
        return value.slice(0, 8) + "…" + value.slice(-5);
    }

    function showLoading(show) {
        dom.loadingOverlay.classList.toggle("hidden", !show);
        document.body.setAttribute("aria-busy", show ? "true" : "false");
    }

    function toast(message) {
        dom.toast.textContent = message;
        dom.toast.classList.add("show");
        clearTimeout(toast.timer);
        toast.timer = setTimeout(function () { dom.toast.classList.remove("show"); }, 2200);
    }

    async function request(type, params) {
        params = params || {};
        params.type = type;
        var query = new URLSearchParams(params);
        var response = await fetch("/api/admin/analytics?" + query.toString(), {
            headers: { Authorization: "Bearer " + state.token },
            cache: "no-store",
            credentials: "same-origin"
        });

        if (response.status === 401) {
            logout("管理口令无效或已变更");
            throw new Error("unauthorized");
        }
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || "request_failed");
        return data;
    }

    function setAuthenticated(authenticated) {
        dom.loginView.classList.toggle("hidden", authenticated);
        dom.dashboardView.classList.toggle("hidden", !authenticated);
        document.body.classList.toggle("is-authenticated", authenticated);
    }

    async function login(password) {
        state.token = password;
        dom.loginError.textContent = "";
        dom.loginButton.disabled = true;
        dom.loginButton.textContent = "正在验证…";
        showLoading(true);
        try {
            var overview = await request("overview", { days: state.days });
            sessionStorage.setItem("zxf_admin_token", password);
            setAuthenticated(true);
            renderOverview(overview);
            await loadTable();
            scheduleRefresh();
        } catch (error) {
            if (error.message !== "unauthorized") {
                dom.loginError.textContent = error.message === "admin_password_not_configured"
                    ? "服务端尚未配置管理口令"
                    : "无法读取后台数据，请稍后重试";
            }
        } finally {
            showLoading(false);
            dom.loginButton.disabled = false;
            dom.loginButton.textContent = "进入后台";
        }
    }

    function logout(message) {
        state.token = "";
        sessionStorage.removeItem("zxf_admin_token");
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
        setAuthenticated(false);
        dom.passwordInput.value = "";
        if (message) dom.loginError.textContent = message;
    }

    async function refreshAll(silent) {
        if (!state.token) return;
        if (!silent) showLoading(true);
        try {
            var results = await Promise.all([
                request("overview", { days: state.days }),
                request(state.type, { limit: state.limit, offset: state.offset })
            ]);
            renderOverview(results[0]);
            renderTableData(results[1]);
            if (!silent) toast("数据已刷新");
        } catch (error) {
            if (error.message !== "unauthorized") toast("刷新失败，请稍后重试");
        } finally {
            if (!silent) showLoading(false);
        }
    }

    async function loadOverview(silent) {
        if (!state.token) return;
        if (!silent) showLoading(true);
        try {
            renderOverview(await request("overview", { days: state.days }));
            if (!silent) toast("已切换到最近 " + state.days + " 天");
        } catch (error) {
            if (error.message !== "unauthorized") toast("趋势数据读取失败");
        } finally {
            if (!silent) showLoading(false);
        }
    }

    function renderOverview(data) {
        var summary = data.summary || {};
        var metrics = [
            { label: "累计访问", value: summary.totalVisits, hint: "统计功能上线后累计", accent: "#3ddc97", icon: "PV", key: true },
            { label: "独立访客", value: summary.uniqueVisitors, hint: "按匿名设备标识去重", accent: "#27d5ee", icon: "UV", key: true },
            { label: "24h 活跃访客", value: summary.activeVisitors24h, hint: "最近一天访问过网站", accent: "#9f8cff", icon: "24h", key: true },
            { label: "当前在线", value: summary.onlineUsers, hint: "45 秒内存在活跃心跳", accent: "#72e7b2", icon: "LIVE", key: true },
            { label: "真人访问", value: summary.humanVisits, hint: "已过滤机器人流量", accent: "#43dba2", icon: "人" },
            { label: "机器人访问", value: summary.botVisits, hint: "爬虫及链接预览器", accent: "#fb7185", icon: "BOT" },
            { label: "注册用户", value: summary.totalUsers, hint: "已获得游戏 ID", accent: "#60a5fa", icon: "ID" },
            { label: "提交成绩用户", value: summary.scoredUsers, hint: "至少上榜一次", accent: "#ff9b62", icon: "榜" },
            { label: "纯净榜用户", value: summary.pureScoredUsers, hint: "未使用修改器和 PK", accent: "#fbbf24", icon: "净" },
            { label: "24h 活跃账号", value: summary.activeUsers24h, hint: "登录账号最近活跃", accent: "#c084fc", icon: "活" }
        ];

        dom.metricGrid.innerHTML = metrics.map(function (metric) {
            return '<article class="metric-card' + (metric.key ? " is-key" : "") + '" style="--accent:' + metric.accent + '">' +
                '<div class="metric-topline"><p class="metric-label">' + escapeHtml(metric.label) + '</p>' +
                '<span class="metric-icon" aria-hidden="true">' + escapeHtml(metric.icon) + '</span></div>' +
                '<div class="metric-value">' + formatNumber(metric.value) + '</div>' +
                '<p class="metric-hint">' + escapeHtml(metric.hint) + '</p></article>';
        }).join("");

        renderTrend(data.daily || []);
        renderDistribution(dom.deviceDistribution, data.distributions && data.distributions.devices);
        renderDistribution(dom.browserDistribution, data.distributions && data.distributions.browsers);
        renderDistribution(dom.referrerDistribution, data.distributions && data.distributions.referrers);
        dom.updatedAt.textContent = "更新于 " + formatTime(data.generatedAt);
        dom.trendKicker.textContent = "最近 " + state.days + " 天";
    }

    function renderTrend(days) {
        var maxValue = Math.max.apply(null, days.map(function (day) {
            return Math.max(Number(day.visits) || 0, Number(day.unique) || 0);
        }).concat([1]));

        var totalVisits = days.reduce(function (sum, day) { return sum + (Number(day.visits) || 0); }, 0);
        var totalUnique = days.reduce(function (sum, day) { return sum + (Number(day.unique) || 0); }, 0);
        var peak = days.reduce(function (best, day) {
            return !best || Number(day.visits) > Number(best.visits) ? day : best;
        }, null);
        dom.trendSummary.textContent = days.length
            ? formatNumber(totalVisits) + " 次访问 · " + formatNumber(totalUnique) + " 次日独立访客 · 峰值 " + (peak ? peak.day.slice(5) : "—")
            : "等待趋势数据";

        dom.trendChart.innerHTML = days.map(function (day) {
            var visitsHeight = Math.max(day.visits ? 3 : 1, (Number(day.visits) || 0) / maxValue * 100);
            var uniqueHeight = Math.max(day.unique ? 3 : 1, (Number(day.unique) || 0) / maxValue * 100);
            return '<div class="chart-column" title="' + escapeHtml(day.day) + ' · ' + formatNumber(day.visits) + ' 次访问 · ' + formatNumber(day.unique) + ' 位访客">' +
                '<div class="bars"><span class="bar bar-visits" style="height:' + visitsHeight + '%"></span>' +
                '<span class="bar bar-unique" style="height:' + uniqueHeight + '%"></span></div>' +
                '<span class="chart-label">' + escapeHtml(day.day.slice(5)) + '</span></div>';
        }).join("");
    }

    function renderDistribution(container, values) {
        values = values || {};
        var entries = Object.keys(values).map(function (key) { return [key, values[key]]; })
            .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
        var total = entries.reduce(function (sum, item) { return sum + item[1]; }, 0) || 1;
        container.innerHTML = entries.length ? entries.map(function (item) {
            var percent = Math.round(item[1] / total * 100);
            return '<div class="distribution-item"><span title="' + escapeHtml(item[0]) + '">' + escapeHtml(item[0]) + '</span>' +
                '<span>' + percent + '%</span><div class="distribution-track"><div class="distribution-fill" style="width:' + percent + '%"></div></div></div>';
        }).join("") : '<p class="cell-sub">等待访问数据</p>';
    }

    async function loadTable() {
        showLoading(true);
        try {
            renderTableData(await request(state.type, { limit: state.limit, offset: state.offset }));
        } catch (error) {
            if (error.message !== "unauthorized") toast("列表读取失败");
        } finally {
            showLoading(false);
        }
    }

    function renderTableData(data) {
        state.total = Number(data.total) || 0;
        state.entries = data.entries || [];
        var header = [];
        var rows = [];

        if (state.type === "visits") {
            header = ["访问时间", "访客 / 用户", "页面与来源", "设备", "位置与网络", "类型"];
            rows = state.entries.map(renderVisitRow);
        } else if (state.type === "visitors") {
            header = ["最近访问", "访客 / 用户", "访问情况", "设备", "位置与网络", "最近来源"];
            rows = state.entries.map(renderVisitorRow);
        } else {
            header = ["用户", "注册时间", "最佳成绩", "纯净榜成绩", "最近活跃", "状态"];
            rows = state.entries.map(renderUserRow);
        }

        dom.tableHead.innerHTML = "<tr>" + header.map(function (item) { return "<th>" + item + "</th>"; }).join("") + "</tr>";
        dom.tableBody.innerHTML = rows.length ? rows.join("") : '<tr class="empty-row"><td colspan="6">还没有可显示的数据</td></tr>';
        decorateTableLabels(header);
        dom.exportButton.disabled = !state.entries.length;
        dom.tableContext.textContent = state.type === "visits" ? "最近访问记录" : state.type === "visitors" ? "独立访客档案" : "注册用户列表";
        applySearch();
        updatePagination();
    }

    function decorateTableLabels(header) {
        dom.tableBody.querySelectorAll("tr").forEach(function (tableRow) {
            tableRow.querySelectorAll("td").forEach(function (tableCell, index) {
                if (!tableRow.classList.contains("empty-row")) tableCell.setAttribute("data-label", header[index] || "数据");
            });
        });
    }

    function renderVisitRow(item) {
        return row([
            cell(formatTime(item.time), new Date(Number(item.time) || 0).toLocaleDateString("zh-CN")),
            cell(shortId(item.visitorId), item.userId ? "账号 " + shortId(item.userId) : "未关联账号", true),
            cell(item.path || "/", item.referrer === "direct" ? "直接访问" : item.referrer),
            cell(item.device || "Other", (item.os || "Other") + " · " + (item.browser || "Other")),
            cell(locationText(item), (item.ipMasked || "unknown") + " · " + (item.screen || "—"), true),
            '<td><span class="badge ' + (item.bot ? "bot" : "human") + '">' + (item.bot ? "机器人" : "真人") + "</span></td>"
        ], item);
    }

    function renderVisitorRow(item) {
        return row([
            cell(formatTime(item.lastSeen), "首次 " + formatTime(item.firstSeen)),
            cell(shortId(item.visitorId), item.userId ? "账号 " + shortId(item.userId) : "未关联账号", true),
            cell(formatNumber(item.visits) + " 次", item.path || "/"),
            cell(item.device || "Other", (item.os || "Other") + " · " + (item.browser || "Other")),
            cell(locationText(item), (item.ipMasked || "unknown") + " · " + (item.timezone || "—"), true),
            cell(item.referrer === "direct" ? "直接访问" : item.referrer, item.language || "—")
        ], item);
    }

    function renderUserRow(item) {
        return row([
            cell(item.nickname || "unknown", shortId(item.userId), true),
            cell(formatTime(item.createdAt), item.userId),
            cell(formatNumber(item.allScore || item.bestScore), "账户最佳 " + formatNumber(item.bestScore)),
            cell(formatNumber(item.pureScore), item.pureScore ? "已进入纯净榜" : "未进入纯净榜"),
            cell(formatTime(item.lastActive), item.lastActive ? "已有在线心跳" : "等待下次上线"),
            '<td><span class="badge ' + (item.online ? "online" : "") + '">' + (item.online ? "在线" : "离线") + "</span></td>"
        ], item);
    }

    function locationText(item) {
        return [item.country, item.region, item.city].filter(function (value) { return value && value !== "unknown"; }).join(" · ") || "未知地区";
    }

    function cell(main, sub, mono) {
        return '<td><span class="cell-main' + (mono ? " mono" : "") + '">' + escapeHtml(main) + '</span>' +
            '<span class="cell-sub' + (mono ? " mono" : "") + '">' + escapeHtml(sub) + "</span></td>";
    }

    function row(cells, raw) {
        var searchable = Object.keys(raw || {}).map(function (key) { return String(raw[key] || ""); }).join(" ").toLowerCase();
        return '<tr data-search="' + escapeHtml(searchable) + '">' + cells.join("") + "</tr>";
    }

    function applySearch() {
        var query = dom.searchInput.value.trim().toLowerCase();
        var rows = dom.tableBody.querySelectorAll("tr[data-search]");
        var visible = 0;
        for (var index = 0; index < rows.length; index += 1) {
            var hidden = query && rows[index].getAttribute("data-search").indexOf(query) === -1;
            rows[index].classList.toggle("hidden", hidden);
            if (!hidden) visible += 1;
        }
        dom.clearSearchButton.classList.toggle("hidden", !query);
        dom.searchMeta.textContent = query
            ? "筛选结果 " + formatNumber(visible) + " / " + formatNumber(rows.length) + " 条"
            : "当前页 " + formatNumber(rows.length) + " 条";
    }

    function updatePagination() {
        var start = state.total ? state.offset + 1 : 0;
        var end = Math.min(state.offset + state.limit, state.total);
        dom.paginationText.textContent = "显示 " + formatNumber(start) + "–" + formatNumber(end) + "，共 " + formatNumber(state.total) + " 条";
        dom.prevButton.disabled = state.offset <= 0;
        dom.nextButton.disabled = state.offset + state.limit >= state.total;
    }

    function switchType(type) {
        if (type === state.type) return;
        state.type = type;
        state.offset = 0;
        dom.searchInput.value = "";
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.classList.toggle("active", tab.getAttribute("data-type") === type);
        });
        loadTable();
    }

    function switchDays(days) {
        days = Number(days) || 14;
        if (days === state.days) return;
        state.days = days;
        document.querySelectorAll(".range-switch button").forEach(function (button) {
            button.classList.toggle("active", Number(button.getAttribute("data-days")) === days);
        });
        loadOverview(false);
    }

    function exportCsv() {
        if (!state.entries.length) {
            toast("当前页没有可导出的数据");
            return;
        }
        var keys = Object.keys(state.entries[0]);
        var lines = [keys.join(",")].concat(state.entries.map(function (entry) {
            return keys.map(function (key) {
                return '"' + String(entry[key] === undefined ? "" : entry[key]).replace(/"/g, '""') + '"';
            }).join(",");
        }));
        var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "zxf-" + state.type + "-" + new Date().toISOString().slice(0, 10) + ".csv";
        link.click();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    function scheduleRefresh() {
        clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(function () {
            if (!document.hidden) refreshAll(true);
        }, 30000);
    }

    function bindEvents() {
        dom.loginForm.addEventListener("submit", function (event) {
            event.preventDefault();
            login(dom.passwordInput.value);
        });
        dom.togglePasswordButton.addEventListener("click", function () {
            var reveal = dom.passwordInput.type === "password";
            dom.passwordInput.type = reveal ? "text" : "password";
            dom.togglePasswordButton.textContent = reveal ? "隐藏" : "显示";
            dom.togglePasswordButton.setAttribute("aria-label", reveal ? "隐藏管理口令" : "显示管理口令");
            dom.togglePasswordButton.setAttribute("aria-pressed", reveal ? "true" : "false");
            dom.passwordInput.focus();
        });
        dom.refreshButton.addEventListener("click", function () { refreshAll(false); });
        dom.logoutButton.addEventListener("click", function () { logout(); });
        dom.searchInput.addEventListener("input", applySearch);
        dom.clearSearchButton.addEventListener("click", function () {
            dom.searchInput.value = "";
            applySearch();
            dom.searchInput.focus();
        });
        dom.pageSizeSelect.addEventListener("change", function () {
            state.limit = Number(dom.pageSizeSelect.value) || 40;
            state.offset = 0;
            loadTable();
        });
        dom.exportButton.addEventListener("click", exportCsv);
        dom.prevButton.addEventListener("click", function () {
            state.offset = Math.max(0, state.offset - state.limit);
            loadTable();
        });
        dom.nextButton.addEventListener("click", function () {
            if (state.offset + state.limit < state.total) {
                state.offset += state.limit;
                loadTable();
            }
        });
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.addEventListener("click", function () { switchType(tab.getAttribute("data-type")); });
        });
        document.querySelectorAll(".range-switch button").forEach(function (button) {
            button.addEventListener("click", function () { switchDays(button.getAttribute("data-days")); });
        });
    }

    function init() {
        ["loginView", "dashboardView", "loginForm", "passwordInput", "togglePasswordButton", "loginButton",
            "loginError", "updatedAt", "refreshButton", "logoutButton", "metricGrid", "trendKicker",
            "trendSummary", "trendChart", "deviceDistribution", "browserDistribution", "referrerDistribution",
            "searchInput", "clearSearchButton", "pageSizeSelect", "exportButton", "tableContext", "searchMeta",
            "tableHead", "tableBody", "paginationText", "prevButton", "nextButton", "loadingOverlay", "toast"
        ].forEach(function (id) { dom[id] = byId(id); });
        bindEvents();

        var savedToken = sessionStorage.getItem("zxf_admin_token");
        if (savedToken) {
            dom.passwordInput.value = savedToken;
            login(savedToken);
        } else {
            setAuthenticated(false);
            dom.passwordInput.focus();
        }
    }

    init();
})();
