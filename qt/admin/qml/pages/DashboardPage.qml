// DashboardPage — full operations cockpit.
//
// Layout (RTL, top to bottom):
//   1. Topbar              — page title + online-count pill
//   2. Stat cards (×4)     — visits today / total users / playing / connected PCs
//   3. Revenue cards (×2)  — charge income + shop sales w/ sparkline
//   4. Chart panel + Live PCs panel  (2:1 split)
//   5. Sessions table
//
// Live data: ApiClient pulls every 3s for /api/clients (no WebSockets in
// this build); /api/reports/stats and /api/sessions every 30s.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    // ── Live state ────────────────────────────────────────────────────
    property var stats:    ({ totalUsers: 0, totalRevenue: 0, totalShopRevenue: 0, totalDebtPaid: 0, todayUsers: 0, activeNow: 0 })
    property var chart:    []    // [{ date, charged, debtPaid }] from /api/reports/revenue
    property var shopRows: []    // [{ date, revenue }]           from /api/reports/shop
    property var clients:  []    // /api/clients
    property var sessions: []    // /api/sessions

    // Map server rows → chart-friendly { date, value } pairs.
    // The big chart now plots cash income (charges + debt collections) so
    // operators see all money flowing in, not just fresh charges.
    readonly property var chartData:  chart.map(r => ({ date: r.date, value: (r.charged || 0) + (r.debtPaid || 0) }))
    readonly property var revSpark:   chart.map(r => r.charged || 0)
    readonly property var debtSpark:  chart.map(r => r.debtPaid || 0)
    readonly property var shopSpark:  shopRows.map(r => r.revenue || 0)

    // ── Polling ───────────────────────────────────────────────────────
    // When Socket is live we get clients:update pushes — drop polling to a
    // 30s safety net. When the socket is down we fall back to the 3s rhythm.
    Timer {
        id: clientsPoll
        interval: Socket.connected ? 30000 : 3000
        running: true; repeat: true; triggeredOnStart: true
        onTriggered: Api.getClients()
    }
    Timer {
        id: heavyPoll
        interval: 30000; running: true; repeat: true; triggeredOnStart: true
        onTriggered: { Api.getStats(); Api.getRevenueReport(7); Api.getShopReport(7); Api.getSessions(); }
    }

    Component.onCompleted: { if (!Socket.connected) Socket.connectTo(Api.baseUrl) }

    Connections {
        target: Api
        function onStatsDone(s)        { page.stats = s }
        function onRevenueDone(rows)   { page.chart = rows }
        function onShopReportDone(rows){ page.shopRows = rows }
        function onSessionsDone(rows)  { page.sessions = rows }
        function onClientsDone(list)   { page.clients = list }
    }

    // Live: server broadcasts clients:update payload as the full client array
    // on every connect/disconnect/login/logout/credit-change.
    Connections {
        target: Socket
        function onMessageReceived(name, payload) {
            if (name === "clients:update") {
                try { page.clients = JSON.parse(payload); } catch (e) { Api.getClients(); }
            }
        }
    }

    BgEffects {}

    // ── Page content ─────────────────────────────────────────────────
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 18

        // Topbar
        RowLayout {
            Layout.fillWidth: true

            Text {
                text: "داشبورد"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Text {
                text: "  ·  نمای کلی"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }

            Item { Layout.fillWidth: true }

            // Live clock — Shamsi date + English-digit time
            Rectangle {
                radius: 999
                color: Theme.card
                border.color: Theme.border; border.width: 1
                implicitHeight: 36; implicitWidth: clockRow.implicitWidth + 28
                Row {
                    id: clockRow
                    anchors.centerIn: parent
                    spacing: 10
                    Text {
                        id: clockTime
                        text: Qt.formatTime(new Date(), "HH:mm:ss")
                        color: Theme.text
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 13
                        font.weight: Font.Bold
                        anchors.verticalCenter: parent.verticalCenter
                        Timer { interval: 1000; running: true; repeat: true
                                onTriggered: {
                                    clockTime.text = Qt.formatTime(new Date(), "HH:mm:ss");
                                    clockDate.text = Jalali.humanDateNow();
                                }}
                    }
                    Text { text: "·"; color: Theme.text3; anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        id: clockDate
                        text: Jalali.humanDateNow()
                        color: Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }

            // Online pill
            Rectangle {
                radius: 999
                color: Theme.card
                border.color: Theme.border; border.width: 1
                implicitHeight: 36; implicitWidth: onlineRow.implicitWidth + 28
                Row {
                    id: onlineRow
                    anchors.centerIn: parent
                    spacing: 8
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        color: Theme.green
                        anchors.verticalCenter: parent.verticalCenter
                        SequentialAnimation on opacity {
                            loops: Animation.Infinite
                            NumberAnimation { to: 0.4; duration: 800 }
                            NumberAnimation { to: 1.0; duration: 800 }
                        }
                    }
                    Text { text: page.stats.activeNow + " نفر آنلاین"; color: Theme.text2; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
                }
            }
        }

        // Stat cards — column count adapts to window width
        GridLayout {
            Layout.fillWidth: true
            columns: Theme.gridColumns(page.width)
            columnSpacing: 18
            rowSpacing: 18

            StatCard { Layout.fillWidth: true; accent: Theme.amber;  label: "بازدید امروز";  value: page.stats.todayUsers + ""; suffix: "نفر";  iconText: "📅" }
            StatCard { Layout.fillWidth: true; accent: Theme.cyan;   label: "کل کاربران";    value: page.stats.totalUsers + "";  iconText: "👥" }
            StatCard { Layout.fillWidth: true; accent: Theme.violet; label: "در حال بازی";   value: page.stats.activeNow + ""; suffix: "فعال"; iconText: "🎮" }
            StatCard { Layout.fillWidth: true; accent: Theme.indigo; label: "کامپیوتر متصل"; value: page.clients.length + "";  iconText: "🖥" }
        }

        // Revenue cards (3) — three cash streams. Collapse to 1 column on
        // narrow windows, 3 columns starting at the lg breakpoint.
        GridLayout {
            Layout.fillWidth: true
            columns: page.width < Theme.bpMd ? 1 : (page.width < Theme.bpLg ? 2 : 3)
            rowSpacing: 18
            columnSpacing: 18

            RevenueCard {
                Layout.fillWidth: true
                accent: Theme.violetSoft
                label: "کل درآمد شارژ"
                value: Currency.format(page.stats.totalRevenue || 0)
                iconText: "💳"
                spark: page.revSpark
            }
            RevenueCard {
                Layout.fillWidth: true
                accent: Theme.cyanSoft
                label: "کل فروش شاپ"
                value: Currency.format(page.stats.totalShopRevenue || 0)
                iconText: "🛒"
                spark: page.shopSpark
            }
            // Debt-collection card — cash from clearing prior debts.
            // Surfacing this on the dashboard means operators don't need to
            // open the accounting page to see how much cash arrived from
            // debt collections.
            RevenueCard {
                Layout.fillWidth: true
                accent: Theme.green
                label: "درآمد پرداخت بدهی"
                value: Currency.format(page.stats.totalDebtPaid || 0)
                iconText: "💵"
                spark: page.debtSpark
            }
        }

        // Chart + Live PCs (2:1) — use stretch ratios instead of % to avoid
        // recursive rearrange loops (RowLayout reads parent.width which we then
        // bind back into a child width).
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 18

            // Revenue chart (large) — 2× the width of the live-PCs panel
            GlassCard {
                Layout.fillWidth: true
                Layout.preferredWidth: 100   // base, multiplied by stretch
                Layout.minimumWidth: 400
                Layout.horizontalStretchFactor: 2
                Layout.fillHeight: true
                accent: Theme.violet
                // Use anchored layout instead of Column → previously the chart's
                // height bound to `parent.height - 60` caused a circular size
                // calc against an auto-sizing Column, so the chart collapsed to 0.
                Item {
                    id: chartContent
                    anchors.fill: parent
                    anchors.margins: 22

                    Row {
                        id: chartHeader
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 36
                        spacing: 12
                        layoutDirection: Qt.RightToLeft
                        Rectangle {
                            width: 32; height: 32; radius: 10
                            color: Qt.rgba(0.55, 0.36, 0.96, 0.15)
                            anchors.verticalCenter: parent.verticalCenter
                            Text { anchors.centerIn: parent; text: "📈"; font.pixelSize: 16 }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            Text { text: "درآمد نقدی ۷ روز اخیر";   color: Theme.text;  font.family: Theme.fontFamily;   font.pixelSize: 16; font.weight: Font.Bold }
                            Text { text: Currency.label() + " · شارژ + پرداخت بدهی"; color: Theme.text3; font.family: Theme.fontFamily;  font.pixelSize: 11 }
                        }
                    }
                    LineChart {
                        anchors.top: chartHeader.bottom
                        anchors.topMargin: 12
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        accent: Theme.violetSoft
                        // Convert rial → toman for display (server stores rial)
                        series: page.chartData.map(p => ({ date: p.date, value: Math.round(p.value / 10) }))
                    }
                }
            }

            // Live PCs panel
            LivePcsPanel {
                id: livePcs
                Layout.fillWidth: true
                Layout.preferredWidth: 100
                Layout.minimumWidth: 280
                Layout.horizontalStretchFactor: 1
                Layout.fillHeight: true
                accent: Theme.violet
                clients: page.clients

                onPcContext: (sid, name, user, x, y) => {
                    pcMenu.socketId = sid;
                    pcMenu.computerName = name;
                    pcMenu.username = user;
                    pcMenu.px = x;
                    pcMenu.py = y;
                    pcMenu.open = true;
                }
            }
        }

        // Sessions table
        SessionsTable {
            Layout.fillWidth: true
            Layout.preferredHeight: 280
            accent: Theme.cyan
            rows: page.sessions
        }
    }

    // ── Right-click menu + action modal ───────────────────────────────
    PcContextMenu {
        id: pcMenu
        onPick: (action) => {
            actionModal.mode = action;
            actionModal.socketId = pcMenu.socketId;
            actionModal.computerName = pcMenu.computerName;
            actionModal.username = pcMenu.username;
            actionModal.open = true;
        }
    }

    ActionModal {
        id: actionModal
        onSubmitted: (mode, payload) => {
            if (mode === "message") Api.messageClient(socketId, payload.text);
            else if (mode === "extend") Api.extendClient(socketId, payload.minutes);
            else if (mode === "kick")   Api.kickClient(socketId);
            // voice: stub for now
        }
    }

    // ── Inline reusable components ────────────────────────────────────
    component StatCard: GlassCard {
        property string label: ""
        property string value: ""
        property string suffix: ""
        property string iconText: ""
        accent: Theme.violet
        implicitHeight: 100

        Item {
            anchors.fill: parent
            anchors.margins: 22

            Row {
                anchors.fill: parent
                spacing: 16
                layoutDirection: Qt.RightToLeft

                Column {
                    width: parent.width - 64 - parent.spacing
                    spacing: 6
                    Text {
                        text: label
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 13
                        horizontalAlignment: Text.AlignRight
                        width: parent.width
                    }
                    Row {
                        spacing: 4
                        layoutDirection: Qt.RightToLeft
                        Text {
                            text: value
                            color: Theme.text
                            font.family: Theme.fontFamilyEn
                            font.pixelSize: 28
                            font.weight: Font.Black
                        }
                        Text {
                            visible: suffix.length > 0
                            text: suffix
                            color: Theme.text3
                            font.pixelSize: 14
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                }

                Rectangle {
                    width: 56; height: 56; radius: 14
                    color: Qt.rgba(accent.r, accent.g, accent.b, 0.12)
                    border.color: Qt.rgba(accent.r, accent.g, accent.b, 0.30); border.width: 1
                    Text {
                        anchors.centerIn: parent
                        text: iconText || "📊"
                        font.pixelSize: 24
                    }
                }
            }
        }
    }

    component RevenueCard: GlassCard {
        id: revCard                    // expose root so children can ref `revCard.accent`
        property string label: ""
        property string value: ""
        property string iconText: ""
        property var    spark: []
        accent: Theme.violet
        implicitHeight: 110

        Item {
            anchors.fill: parent
            anchors.margins: 22

            Row {
                anchors.fill: parent
                spacing: 16
                layoutDirection: Qt.RightToLeft

                Row {
                    spacing: 14
                    layoutDirection: Qt.RightToLeft
                    anchors.verticalCenter: parent.verticalCenter
                    Rectangle {
                        width: 56; height: 56; radius: 14
                        color: Qt.rgba(revCard.accent.r, revCard.accent.g, revCard.accent.b, 0.12)
                        border.color: Qt.rgba(revCard.accent.r, revCard.accent.g, revCard.accent.b, 0.30); border.width: 1
                        Text { anchors.centerIn: parent; text: revCard.iconText || "💳"; font.pixelSize: 24 }
                    }
                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 4
                        Text {
                            text: revCard.label
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 13
                            horizontalAlignment: Text.AlignRight
                            width: 200
                        }
                        Text {
                            text: revCard.value
                            color: Theme.text
                            font.family: Theme.fontFamilyEn
                            font.pixelSize: 22
                            font.weight: Font.Black
                            horizontalAlignment: Text.AlignRight
                            width: 200
                        }
                    }
                }

                Item { width: 14; height: 1 }

                Sparkline {
                    anchors.verticalCenter: parent.verticalCenter
                    width: 140; height: 56
                    series: revCard.spark
                    accent: revCard.accent
                }
            }
        }
    }
}
