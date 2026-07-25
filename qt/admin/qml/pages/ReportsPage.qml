// ReportsPage — read-only analytics dashboard. Period selector at top,
// then KPIs, daily revenue chart, sessions feed, and top users by playtime.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    property int    period: 30
    property var    revenue: []
    property var    shop: []
    property var    shopProfit: ({ totalRevenue: 0, totalCost: 0, grossProfit: 0, totalItems: 0, ordersCount: 0 })
    property var    stats: ({ totalUsers: 0, totalRevenue: 0, totalShopRevenue: 0, totalDebtPaid: 0, todayUsers: 0, activeNow: 0, pendingOrders: 0 })

    // Cash-basis total income across all three streams. `totalRevenue` is
    // fresh charges only — it omits `debt_pay` collections which are real
    // cash arriving into the cafe.
    readonly property real totalCashIncome:
        Number(stats.totalRevenue || 0)
        + Number(stats.totalShopRevenue || 0)
        + Number(stats.totalDebtPaid || 0)
    property var    sessions: []
    property var    users: []
    property var    debtors: []
    property var    auditLog: []
    property int    auditTotal: 0

    readonly property bool compact: page.width < Theme.bpLg

    // Debt aggregates derived from the debtors list
    readonly property real totalDebt:    debtors.reduce((s, u) => s + Number(u.debt || 0), 0)
    readonly property real avgDebt:      debtors.length > 0 ? totalDebt / debtors.length : 0
    readonly property var  topDebtors:   debtors.slice(0, 5)

    // Top users by accumulated session time (sum of session durations)
    readonly property var topUsers: {
        const totals = {};
        for (const s of sessions) {
            if (!s.start_time) continue;
            const start = new Date(s.start_time).getTime();
            const end = s.end_time ? new Date(s.end_time).getTime() : Date.now();
            const mins = Math.max(0, Math.floor((end - start) / 60000));
            const key = s.user_id;
            if (!totals[key]) totals[key] = { user_id: key, username: s.username, mins: 0, sessions: 0 };
            totals[key].mins += mins;
            totals[key].sessions += 1;
        }
        return Object.values(totals).sort((a, b) => b.mins - a.mins).slice(0, 10);
    }

    function refresh() {
        const d = page.period === 0 ? 1 : page.period;
        Api.getRevenueReport(d);
        Api.getShopReport(d);
        Api.getShopProfit(d);
        Api.getStats();
        Api.getSessions();
        Api.getUsers();
        Api.getDebtors();
        Api.getAuditLog(40, 0);
    }
    Component.onCompleted: refresh()
    onPeriodChanged: refresh()

    Timer { interval: 60000; running: true; repeat: true; onTriggered: page.refresh() }

    Connections {
        target: Api
        function onRevenueDone(rows)    { page.revenue = rows }
        function onShopReportDone(rows) { page.shop = rows }
        function onShopProfitDone(p)    { page.shopProfit = p }
        function onStatsDone(s)         { page.stats = s }
        function onSessionsDone(rows)   { page.sessions = rows }
        function onUsersDone(rows)      { page.users = rows }
        function onDebtorsDone(rows)    { page.debtors = rows }
        function onAuditLogDone(rows, total) { page.auditLog = rows; page.auditTotal = total }
        // Any user-finance mutation (charge / debt-pay / debt-add / post-pay)
        // shifts revenue + stats + debtor aggregates simultaneously. Pull the
        // whole bundle so KPIs (especially کل درآمد نقدی + درآمد پرداخت بدهی)
        // refresh immediately instead of waiting for the 60s polling tick.
        function onUserMutationDone(ok) {
            if (!ok) return;
            const d = page.period === 0 ? 1 : page.period;
            Api.getRevenueReport(d);
            Api.getStats();
            Api.getDebtors();
        }
    }
    // Live debt updates — when the ticker accrues debt or admin pays one off,
    // clients:update broadcasts. Refresh debtors + stats + revenue so all
    // related KPIs stay in sync without waiting for the 60s timer.
    Connections {
        target: Socket
        function onMessageReceived(name, _payload) {
            if (name === "clients:update") {
                Api.getDebtors();
                Api.getStats();
                Api.getRevenueReport(page.period === 0 ? 1 : page.period);
            }
        }
    }

    // ── CSV export ────────────────────────────────────────────────────
    function csvEscape(v) {
        const s = (v === null || v === undefined) ? "" : String(v);
        if (s.indexOf(",") !== -1 || s.indexOf("\"") !== -1 || s.indexOf("\n") !== -1)
            return "\"" + s.replace(/"/g, "\"\"") + "\"";
        return s;
    }
    function exportCsv() {
        const lines = [];
        // Header block
        lines.push("# MuteGame — گزارش " + (page.period === 0 ? "امروز" : page.period + " روز اخیر"));
        lines.push("# تولید: " + Jalali.dateTime(new Date().toISOString()));
        lines.push("");
        // Revenue table — now reports both fresh charges and debt collections.
        // Columns: date, charged, debtPaid, totalCash, transactions
        lines.push("درآمد روزانه (ریال) — شامل پرداخت بدهی");
        lines.push("date,charged,debtPaid,totalCash,transactions");
        for (let i = 0; i < page.revenue.length; ++i) {
            const r = page.revenue[i];
            const charged = Number(r.charged || 0);
            const debtPaid = Number(r.debtPaid || 0);
            lines.push([
                csvEscape(r.date),
                csvEscape(charged),
                csvEscape(debtPaid),
                csvEscape(charged + debtPaid),
                csvEscape(r.transactions)
            ].join(","));
        }
        lines.push("");
        // Top-level cash totals row
        lines.push("خلاصه درآمد نقدی (ریال)");
        lines.push("metric,value");
        lines.push("درآمد شارژ," + csvEscape(page.stats.totalRevenue || 0));
        lines.push("درآمد شاپ," + csvEscape(page.stats.totalShopRevenue || 0));
        lines.push("درآمد پرداخت بدهی," + csvEscape(page.stats.totalDebtPaid || 0));
        lines.push("کل درآمد نقدی," + csvEscape(page.totalCashIncome));
        lines.push("");
        // Shop table
        lines.push("فروش شاپ روزانه (ریال)");
        lines.push("date,revenue,orders");
        for (let i = 0; i < page.shop.length; ++i) {
            const r = page.shop[i];
            lines.push([csvEscape(r.date), csvEscape(r.revenue), csvEscape(r.orders)].join(","));
        }
        lines.push("");
        // Top users
        lines.push("کاربران برتر (دقیقه)");
        lines.push("rank,username,minutes,sessions");
        for (let i = 0; i < page.topUsers.length; ++i) {
            const u = page.topUsers[i];
            lines.push([(i + 1), csvEscape(u.username), csvEscape(u.mins), csvEscape(u.sessions)].join(","));
        }
        lines.push("");
        // Debtors snapshot — all users with debt > 0 at export time
        lines.push("بدهکاران (ریال)");
        lines.push("rank,username,name,family,phone,debt,credits,debt_since");
        for (let i = 0; i < page.debtors.length; ++i) {
            const u = page.debtors[i];
            lines.push([(i + 1), csvEscape(u.username), csvEscape(u.name),
                        csvEscape(u.family), csvEscape(u.phone),
                        csvEscape(u.debt), csvEscape(u.credits),
                        csvEscape(u.debt_since)].join(","));
        }
        const fname = "mutegame-report-" + page.period + "d-" + Date.now() + ".csv";
        const path = Api.saveToDownloads(fname, lines.join("\n"));
        if (path) toast.show("⬇ ذخیره شد: " + fname, "success");
        else      toast.show("ذخیره ناموفق بود", "error");
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // Topbar + period selector
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Text { text: "گزارشات"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 24; font.weight: Font.Bold }
            Text { text: "  ·  " + (page.period === 0 ? "امروز" : page.period + " روز اخیر"); color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 13 }

            Item { Layout.fillWidth: true }

            Row {
                spacing: 6
                Repeater {
                    model: [
                        { d: 0,   l: "امروز" },
                        { d: 7,   l: "۷ روز" },
                        { d: 30,  l: "۳۰ روز" },
                        { d: 90,  l: "۹۰ روز" },
                        { d: 365, l: "۱ سال" }
                    ]
                    delegate: Rectangle {
                        height: 30; radius: 15
                        width: pl.implicitWidth + 22
                        property bool active: page.period === modelData.d
                        color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.18) : Theme.card
                        border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                        border.width: 1
                        Behavior on color { ColorAnimation { duration: 150 } }
                        Text { id: pl; anchors.centerIn: parent; text: modelData.l; color: parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.period = modelData.d }
                    }
                }
            }
            // CSV export
            Rectangle {
                height: 30; radius: 15
                width: csvT.implicitWidth + 26
                color: csvMA.containsMouse ? Qt.rgba(0.06, 0.73, 0.51, 0.22) : Qt.rgba(0.06, 0.73, 0.51, 0.12)
                border.color: Qt.rgba(0.06, 0.73, 0.51, 0.40); border.width: 1
                Behavior on color { ColorAnimation { duration: 130 } }
                Text { id: csvT; anchors.centerIn: parent; text: "⬇ خروجی CSV"; color: Theme.green; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                MouseArea { id: csvMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.exportCsv() }
            }
        }

        // Body — scrollable so KPIs + chart + tables all fit
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth

            ColumnLayout {
                width: parent.width
                spacing: 14

                // KPI grid
                GridLayout {
                    Layout.fillWidth: true
                    columns: page.compact ? 2 : 4
                    columnSpacing: 12
                    rowSpacing: 12

                    // Headline cash KPI — sum of charge + shop + debt-collected.
                    RKpi { Layout.fillWidth: true; iconText: "💰"; label: "کل درآمد نقدی"; value: Currency.format(page.totalCashIncome); accent: Theme.green;  isMoney: true }
                    RKpi { Layout.fillWidth: true; iconText: "💳"; label: "درآمد شارژ"; value: Currency.format(page.stats.totalRevenue || 0); accent: Theme.violet; isMoney: true }
                    RKpi { Layout.fillWidth: true; iconText: "🛒"; label: "درآمد شاپ"; value: Currency.format(page.stats.totalShopRevenue || 0); accent: Theme.cyan; isMoney: true }
                    // Debt collections — cash that came in from prior debt.
                    RKpi { Layout.fillWidth: true; iconText: "💵"; label: "درآمد پرداخت بدهی"; value: Currency.format(page.stats.totalDebtPaid || 0); accent: Theme.green; isMoney: true }
                    RKpi { Layout.fillWidth: true; iconText: "📦"; label: "سود ناخالص شاپ"; value: Currency.format(page.shopProfit.grossProfit || 0); accent: (page.shopProfit.grossProfit || 0) >= 0 ? Theme.green : Theme.red; isMoney: true }
                    RKpi { Layout.fillWidth: true; iconText: "👥"; label: "کل کاربران"; value: String(page.stats.totalUsers || 0); accent: Theme.cyan;   isMoney: false }
                    RKpi { Layout.fillWidth: true; iconText: "🎮"; label: "در حال بازی الان"; value: String(page.stats.activeNow || 0); accent: Theme.green; isMoney: false }
                    RKpi { Layout.fillWidth: true; iconText: "📅"; label: "بازدید امروز"; value: String(page.stats.todayUsers || 0); accent: Theme.amber; isMoney: false }
                    RKpi { Layout.fillWidth: true; iconText: "📋"; label: "سفارش معلق"; value: String(page.stats.pendingOrders || 0); accent: Theme.amber; isMoney: false }
                    RKpi { Layout.fillWidth: true; iconText: "🧾"; label: "تعداد سفارش (دوره)"; value: String(page.shopProfit.ordersCount || 0); accent: Theme.cyan; isMoney: false }
                    // Debt outstanding KPIs — bookkeeping snapshot, refreshed
                    // live via clients:update socket events.
                    RKpi { Layout.fillWidth: true; iconText: "📉"; label: "کل بدهی شبکه"; value: Currency.format(page.totalDebt); accent: Theme.red;   isMoney: true }
                    RKpi { Layout.fillWidth: true; iconText: "👤"; label: "تعداد بدهکاران"; value: String(page.debtors.length); accent: Theme.amber; isMoney: false }
                }

                // ── Top debtors box ───────────────────────────────────
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 240
                    accent: Theme.red
                    visible: page.debtors.length > 0

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 10

                        Row {
                            Layout.fillWidth: true; spacing: 10
                            layoutDirection: Qt.RightToLeft
                            Text { text: "💳"; font.pixelSize: 20; anchors.verticalCenter: parent.verticalCenter }
                            Text { text: "بزرگ‌ترین بدهکاران"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 15; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            Item { width: 6; height: 1 }
                            Text { text: "میانگین: " + Currency.format(page.avgDebt); color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; opacity: 0.5 }

                        ListView {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            spacing: 4
                            clip: true
                            interactive: false
                            model: page.topDebtors
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 32; radius: 6
                                color: index % 2 === 0 ? "transparent" : Qt.rgba(0.94, 0.27, 0.27, 0.05)

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 8
                                    spacing: 12
                                    layoutDirection: Qt.RightToLeft
                                    Rectangle {
                                        width: 22; height: 22; radius: 11
                                        color: index === 0 ? Qt.rgba(0.96, 0.62, 0.04, 0.30) : Qt.rgba(0.55, 0.36, 0.96, 0.20)
                                        border.color: index === 0 ? Qt.rgba(0.96, 0.62, 0.04, 0.55) : Qt.rgba(0.55, 0.36, 0.96, 0.40); border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { anchors.centerIn: parent; text: index + 1; color: index === 0 ? Theme.amber : Theme.violetSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Black }
                                    }
                                    Text {
                                        text: ((modelData.name||"") + " " + (modelData.family||"")).trim() || ("@" + (modelData.username||""))
                                        color: Theme.text
                                        font.family: Theme.fontFamily; font.pixelSize: 12
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: 200
                                        elide: Text.ElideRight
                                        horizontalAlignment: Text.AlignRight
                                    }
                                    Text {
                                        text: "@" + (modelData.username || "")
                                        color: Theme.text3
                                        font.family: Theme.fontFamilyEn; font.pixelSize: 10
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: 90
                                        horizontalAlignment: Text.AlignRight
                                    }
                                    Item { Layout.fillWidth: true; width: 1 }
                                    Text {
                                        text: Currency.format(Number(modelData.debt || 0))
                                        color: Theme.red
                                        font.family: Theme.fontFamilyEn; font.pixelSize: 12; font.weight: Font.Bold
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: 130
                                        horizontalAlignment: Text.AlignRight
                                    }
                                }
                            }
                        }
                    }
                }

                // Revenue (line) + Shop (bar) charts side-by-side
                GridLayout {
                    Layout.fillWidth: true
                    columns: page.compact ? 1 : 2
                    columnSpacing: 14
                    rowSpacing: 14

                    GlassCard {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 280
                        accent: Theme.violet
                        Item {
                            anchors.fill: parent
                            anchors.margins: 22
                            Row {
                                id: chHdr
                                anchors.top: parent.top
                                anchors.right: parent.right
                                anchors.left: parent.left
                                height: 28
                                spacing: 10
                                layoutDirection: Qt.RightToLeft
                                Text { text: "📈 درآمد نقدی روزانه — شارژ + پرداخت بدهی (تومان)"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                                Text { text: page.revenue.length + " روز"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                            }
                            LineChart {
                                anchors.top: chHdr.bottom
                                anchors.topMargin: 12
                                anchors.right: parent.right
                                anchors.left: parent.left
                                anchors.bottom: parent.bottom
                                accent: Theme.violetSoft
                                // Revenue rows now carry both `charged` (fresh
                                // charges) and `debtPaid` (debt collections).
                                // Sum them for true daily cash inflow. ریال→تومان.
                                series: page.revenue.map(r => ({ date: r.date, value: Math.round(((r.charged || 0) + (r.debtPaid || 0)) / 10) }))
                            }
                        }
                    }

                    GlassCard {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 280
                        accent: Theme.cyan
                        Item {
                            anchors.fill: parent
                            anchors.margins: 22
                            Row {
                                id: shopHdr
                                anchors.top: parent.top
                                anchors.right: parent.right
                                anchors.left: parent.left
                                height: 28
                                spacing: 10
                                layoutDirection: Qt.RightToLeft
                                Text { text: "🛒 فروش شاپ روزانه (تومان)"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                                Text { text: page.shop.length + " روز  ·  " + page.shopProfit.ordersCount + " سفارش"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                            }
                            BarChart {
                                anchors.top: shopHdr.bottom
                                anchors.topMargin: 12
                                anchors.right: parent.right
                                anchors.left: parent.left
                                anchors.bottom: parent.bottom
                                accent: Theme.cyanSoft
                                series: page.shop.map(r => ({ date: r.date, value: Math.round((r.revenue || 0) / 10) }))
                            }
                        }
                    }
                }

                // Top users + Recent sessions side by side
                GridLayout {
                    Layout.fillWidth: true
                    columns: page.compact ? 1 : 2
                    columnSpacing: 14
                    rowSpacing: 14

                    GlassCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 100
                        Layout.preferredHeight: 360
                        accent: Theme.amber
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 18
                            spacing: 8
                            Text { text: "🏆 کاربران برتر (بر اساس زمان بازی)"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold; Layout.fillWidth: true }
                            Text { visible: page.topUsers.length === 0; text: "داده‌ای نیست"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; Layout.alignment: Qt.AlignHCenter; topPadding: 30 }
                            ListView {
                                visible: page.topUsers.length > 0
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                spacing: 4
                                clip: true
                                model: page.topUsers
                                delegate: Rectangle {
                                    width: ListView.view.width
                                    height: 40
                                    radius: 8
                                    color: tuMA.containsMouse ? Theme.cardHover : Theme.card
                                    border.color: Theme.border; border.width: 1
                                    Behavior on color { ColorAnimation { duration: 130 } }
                                    Row {
                                        anchors.fill: parent
                                        anchors.margins: 10
                                        spacing: 10
                                        layoutDirection: Qt.RightToLeft
                                        Rectangle {
                                            width: 28; height: 28; radius: 14
                                            anchors.verticalCenter: parent.verticalCenter
                                            color: index === 0 ? Qt.rgba(0.96, 0.62, 0.04, 0.20)
                                                 : index === 1 ? Qt.rgba(0.74, 0.74, 0.74, 0.20)
                                                 : index === 2 ? Qt.rgba(0.80, 0.50, 0.20, 0.20)
                                                               : Theme.bg2
                                            border.color: index === 0 ? Theme.amber : index < 3 ? Theme.text3 : Theme.border
                                            border.width: 1
                                            Text {
                                                anchors.centerIn: parent
                                                text: index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : (index + 1)
                                                font.family: Theme.fontFamilyEn
                                                font.pixelSize: index < 3 ? 14 : 11
                                                font.weight: Font.Bold
                                                color: Theme.text
                                            }
                                        }
                                        Text {
                                            text: "👤 " + (modelData.username || "—")
                                            color: Theme.text2
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 12
                                            font.weight: Font.Bold
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        Item { Layout.fillWidth: true; width: 1 }
                                        Text {
                                            text: modelData.mins + " دقیقه"
                                            color: Theme.cyanSoft
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 11
                                            font.weight: Font.Bold
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        Text {
                                            text: modelData.sessions + "× نشست"
                                            color: Theme.text3
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 10
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                    }
                                    HoverHandler { id: tuMA }
                                }
                            }
                        }
                    }

                    GlassCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 100
                        Layout.preferredHeight: 360
                        accent: Theme.cyan
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 18
                            spacing: 8
                            Text { text: "🕐 آخرین نشست‌ها"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold; Layout.fillWidth: true }
                            Text { visible: page.sessions.length === 0; text: "داده‌ای نیست"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; Layout.alignment: Qt.AlignHCenter; topPadding: 30 }
                            ListView {
                                visible: page.sessions.length > 0
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                spacing: 4
                                clip: true
                                model: page.sessions.slice(0, 30)
                                delegate: Rectangle {
                                    width: ListView.view.width
                                    height: 40
                                    radius: 8
                                    color: ssMA.containsMouse ? Theme.cardHover : Theme.card
                                    border.color: Theme.border; border.width: 1
                                    Behavior on color { ColorAnimation { duration: 130 } }
                                    Row {
                                        anchors.fill: parent
                                        anchors.margins: 10
                                        spacing: 10
                                        layoutDirection: Qt.RightToLeft
                                        Text { text: "👤 " + (modelData.username || "—"); color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                                        Text { text: "·"; color: Theme.text3; anchors.verticalCenter: parent.verticalCenter }
                                        Text { text: modelData.computer_name || "—"; color: Theme.cyanSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                                        Item { Layout.fillWidth: true; width: 1 }
                                        Text {
                                            text: modelData.start_time ? Jalali.dateTimeFromIso(modelData.start_time) : "—"
                                            color: Theme.text3
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 10
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        Rectangle {
                                            width: 50; height: 22; radius: 11
                                            color: modelData.end_time ? Qt.rgba(0.43, 0.45, 0.55, 0.15) : Qt.rgba(0.06, 0.73, 0.51, 0.18)
                                            border.color: modelData.end_time ? Theme.border : Qt.rgba(0.06, 0.73, 0.51, 0.40)
                                            border.width: 1
                                            anchors.verticalCenter: parent.verticalCenter
                                            Text { anchors.centerIn: parent; text: modelData.end_time ? "پایان" : "فعال"; color: modelData.end_time ? Theme.text3 : Theme.green; font.family: Theme.fontFamily; font.pixelSize: 9; font.weight: Font.Bold }
                                        }
                                    }
                                    HoverHandler { id: ssMA }
                                }
                            }
                        }
                    }
                }

                // Audit log card ────────────────────────────────────
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 360
                    accent: Theme.green
                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 8

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 10
                            Text { text: "🛡 لاگ فعالیت ادمین‌ها"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                            Item { Layout.fillWidth: true }
                            Text { text: page.auditTotal + " رکورد در کل"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        }
                        Text { visible: page.auditLog.length === 0; text: "هنوز فعالیتی ثبت نشده"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; Layout.alignment: Qt.AlignHCenter; topPadding: 30 }

                        ListView {
                            visible: page.auditLog.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            spacing: 4
                            clip: true
                            model: page.auditLog
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 44
                                radius: 8
                                color: alMA.hovered ? Theme.cardHover : Theme.card
                                border.color: Theme.border; border.width: 1
                                Behavior on color { ColorAnimation { duration: 130 } }

                                // Pick a color/emoji based on action type
                                readonly property var actionMeta: {
                                    const a = String(modelData.action || "");
                                    if (a.indexOf("delete") !== -1) return { c: Theme.red,    e: "🗑" };
                                    if (a.indexOf("create") !== -1) return { c: Theme.green,  e: "➕" };
                                    if (a.indexOf("update") !== -1) return { c: Theme.cyan,   e: "✏️" };
                                    if (a.indexOf("login")  !== -1) return { c: Theme.violet, e: "🔑" };
                                    if (a.indexOf("charge") !== -1) return { c: Theme.amber,  e: "💳" };
                                    if (a.indexOf("kick")   !== -1) return { c: Theme.red,    e: "⏻" };
                                    return { c: Theme.text3, e: "•" };
                                }

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 10
                                    spacing: 10
                                    layoutDirection: Qt.RightToLeft

                                    // Icon
                                    Rectangle {
                                        width: 28; height: 28; radius: 8
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: Qt.rgba(actionMeta.c.r, actionMeta.c.g, actionMeta.c.b, 0.15)
                                        border.color: Qt.rgba(actionMeta.c.r, actionMeta.c.g, actionMeta.c.b, 0.30); border.width: 1
                                        Text { anchors.centerIn: parent; text: actionMeta.e; font.pixelSize: 13 }
                                    }
                                    // Admin + action
                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 2
                                        width: 240
                                        Row { spacing: 6; layoutDirection: Qt.RightToLeft
                                            Text { text: "👤 " + (modelData.admin_username || "—"); color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                                            Text { text: modelData.action || ""; color: actionMeta.c; font.family: Theme.fontFamilyEn; font.pixelSize: 11; font.weight: Font.Bold }
                                        }
                                        Text {
                                            text: (modelData.entity || "") + (modelData.entity_id ? " #" + modelData.entity_id : "")
                                            color: Theme.text3
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 10
                                            visible: text !== ""
                                        }
                                    }
                                    Item { Layout.fillWidth: true; width: 1 }
                                    // Timestamp
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: modelData.created_at ? Jalali.dateTime(modelData.created_at) : "—"
                                        color: Theme.text3
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 10
                                    }
                                }
                                HoverHandler { id: alMA }
                            }
                        }
                    }
                }
            }
        }
    }

    // Toast for CSV export feedback
    Toast { id: toast }

    // Inline KPI
    component RKpi: GlassCard {
        id: rkpi
        property string iconText: ""
        property string label: ""
        property string value: ""
        property bool   isMoney: false
        accent: Theme.violet
        implicitHeight: 78

        Item {
            anchors.fill: parent
            anchors.margins: 14
            Row {
                anchors.fill: parent
                spacing: 12
                layoutDirection: Qt.RightToLeft
                Rectangle {
                    width: 44; height: 44; radius: 12
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(rkpi.accent.r, rkpi.accent.g, rkpi.accent.b, 0.14)
                    border.color: Qt.rgba(rkpi.accent.r, rkpi.accent.g, rkpi.accent.b, 0.32); border.width: 1
                    Text { anchors.centerIn: parent; text: rkpi.iconText; font.pixelSize: 22 }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 3
                    Text { text: rkpi.label; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    Text { text: rkpi.value; color: Theme.text; font.family: rkpi.isMoney ? Theme.fontFamily : Theme.fontFamilyEn; font.pixelSize: rkpi.isMoney ? 13 : 18; font.weight: Font.Black }
                }
            }
        }
    }
}
