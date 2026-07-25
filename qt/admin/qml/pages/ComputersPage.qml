// ComputersPage — full-page operator console for the connected PCs.
//
// Per-PC actions go through ActionModal (or the dedicated VoiceCallModal /
// PcContextMenu). Right-clicking a card opens the context menu; left-click
// quick buttons cover the most common actions inline.
//
// The view toggle (grid / table) and the filter pill (all / active / idle)
// are persisted to QSettings so they survive page-switches and app restarts.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import Qt.labs.settings
import "../components"
import "../theme"

Item {
    id: page

    property var    clients:     []
    property var    users:       []
    property var    modems:      []
    property var    dnsList:     []
    property var    assignments: []
    property string search:      ""
    property string view:        "grid"
    property string filter:      "all"
    // Pricing (rial/hour) — read from /api/settings.gaming_price_per_hour.
    // Used to derive each PC's remaining minutes from its current credits.
    property real   pricePerHour: 30000

    Settings {
        id: viewSettings
        category: "computers"
        property alias view:   page.view
        property alias filter: page.filter
    }

    readonly property int activeCount: clients.filter(c => c.status === "active").length
    readonly property int idleCount:   clients.filter(c => c.status !== "active").length

    function userById(id) {
        for (let i = 0; i < users.length; ++i) if (users[i].id === id) return users[i];
        return null;
    }
    function fullName(client) {
        if (!client.username) return "";
        const u = userById(Number(client.userId || 0));
        if (!u) return "👤 " + client.username;
        const nm = ((u.name || "") + " " + (u.family || "")).trim();
        return nm ? ("👤 " + nm + " (" + client.username + ")") : ("👤 " + client.username);
    }
    function assignmentFor(name) {
        for (let i = 0; i < assignments.length; ++i)
            if (assignments[i].computer_name === name) return assignments[i];
        return null;
    }

    readonly property var filteredClients: {
        const s = page.search.trim().toLowerCase();
        return clients.filter(c => {
            if (page.filter === "active" && c.status !== "active") return false;
            if (page.filter === "idle"   && c.status === "active") return false;
            if (!s) return true;
            const u = userById(Number(c.userId || 0));
            const fullName = u ? ((u.name || "") + " " + (u.family || "")).toLowerCase() : "";
            return (c.computerName || "").toLowerCase().includes(s)
                || (c.username     || "").toLowerCase().includes(s)
                || fullName.includes(s);
        });
    }

    function elapsedSince(iso) {
        if (!iso) return "";
        const start = new Date(iso).getTime();
        if (isNaN(start)) return "";
        const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => (n < 10 ? "0" : "") + n;
        return h > 0 ? (h + ":" + pad(m) + ":" + pad(s)) : (pad(m) + ":" + pad(s));
    }

    // Remaining-time counter that ticks every second locally so admin sees
    // the same live HH:MM:SS the kiosk shows. We compute base seconds from
    // the last-known credits + price-per-hour, and decrement using the
    // session start. When credits update via socket (every minute on the
    // server tick), the base recalculates automatically.
    function remainingSec(client) {
        if (!client || client.status !== "active") return 0;
        const credits = Number(client.credits || 0);
        if (page.pricePerHour <= 0) return 0;
        const baseSec = Math.max(0, Math.round(credits / page.pricePerHour * 3600));
        // Subtract the seconds elapsed since the *credits were last reported*.
        // We don't have a per-PC timestamp for that, so we approximate with
        // sessionStart. Server side recalculates each minute so drift is
        // bounded to ±60 seconds.
        const start = client.sessionStart ? new Date(client.sessionStart).getTime() : 0;
        const elapsedSec = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
        // Server already debited credits each minute, so what we see is
        // "credits as of last debit" — base already accounts for the debits.
        // We only deduct *seconds within the current minute* (mod 60) to
        // animate the counter. tick forces re-evaluation.
        const intraMinute = elapsedSec % 60;
        return Math.max(0, baseSec - intraMinute);
    }
    function remainingStr(client) {
        const sec = remainingSec(client);
        if (sec <= 0) return client && client.status === "active" ? "اتمام" : "—";
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => (n < 10 ? "0" : "") + n;
        return h > 0 ? (h + ":" + pad(m) + ":" + pad(s)) : (pad(m) + ":" + pad(s));
    }

    Component.onCompleted: {
        Api.getClients();
        Api.getUsers();
        Api.getModems();
        Api.getDnsServers();
        Api.getNetworkAssignments();
        Api.getSettings();
        if (!Socket.connected) Socket.connectTo(Api.baseUrl);
    }

    Timer { interval: Socket.connected ? 30000 : 3000; running: true; repeat: true; triggeredOnStart: true; onTriggered: Api.getClients() }
    Timer { interval: 1000; running: true; repeat: true; onTriggered: tick++ }
    property int tick: 0

    Connections {
        target: Api
        function onClientsDone(rows)            { page.clients = rows }
        function onUsersDone(rows)              { page.users = rows }
        function onModemsDone(rows)             { page.modems = rows }
        function onDnsServersDone(rows)         { page.dnsList = rows }
        function onNetworkAssignmentsDone(rows) { page.assignments = rows }
        function onSettingsLoaded(s) {
            const p = Number(s.gaming_price_per_hour);
            if (p > 0) page.pricePerHour = p;
        }
        function onClientActionDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            if (!Socket.connected) Api.getClients();
            toast.show("انجام شد ✅", "success");
        }
        function onUserMutationDone(ok, err, _result) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getUsers();
            // After a charge, the server pushes credits via clients:update so
            // page.clients refreshes anyway — but on flaky LAN, also pull
            // fresh client list as a safety net.
            if (!Socket.connected) Api.getClients();
            toast.show("شارژ ثبت شد ✅", "success");
        }
        function onNetworkAssignmentDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getNetworkAssignments();
            toast.show("شبکه اعمال شد ✅", "success");
        }
    }

    Connections {
        target: Socket
        function onMessageReceived(name, payload) {
            if (name === "clients:update") {
                try { page.clients = JSON.parse(payload); } catch (e) { Api.getClients(); }
            } else if (name === "client:assignment") {
                Api.getNetworkAssignments();
            } else if (name === "settings:update") {
                try {
                    const s = JSON.parse(payload);
                    const p = Number(s.gaming_price_per_hour);
                    if (p > 0) page.pricePerHour = p;
                } catch (e) {}
            }
        }
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // ── Topbar ──────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Text {
                text: "کامپیوترها"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Text {
                text: "  ·  کنترل زنده · راست‌کلیک برای منو"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }

            Item { Layout.fillWidth: true }

            // View toggle
            Row {
                spacing: 6
                Repeater {
                    model: [
                        { v: "grid",  l: "▦ گرید" },
                        { v: "table", l: "☰ جدول" }
                    ]
                    delegate: Rectangle {
                        height: 32; radius: 16
                        width: vlab.implicitWidth + 22
                        property bool active: page.view === modelData.v
                        color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.18) : Theme.card
                        border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                        border.width: 1
                        Behavior on color { ColorAnimation { duration: 150 } }
                        Text { id: vlab; anchors.centerIn: parent; text: modelData.l; color: parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.view = modelData.v }
                    }
                }
            }

            GlassInput {
                Layout.preferredWidth: 240
                placeholder: "🔍 PC، کاربر یا اسم…"
                text: page.search
                onTextChanged: page.search = text
            }
        }

        // ── Stat pills ──────────────────────────────────────────
        Row {
            Layout.fillWidth: true
            spacing: 8

            Repeater {
                model: [
                    { k: "all",    l: "همه",    n: page.clients.length, c: Theme.cyan,  pulse: false },
                    { k: "active", l: "فعال",   n: page.activeCount,    c: Theme.green, pulse: page.activeCount > 0 },
                    { k: "idle",   l: "آزاد",   n: page.idleCount,      c: Theme.text3, pulse: false }
                ]
                delegate: Rectangle {
                    height: 36; radius: 18
                    width: pl.implicitWidth + ncT.implicitWidth + 50
                    property bool active: page.filter === modelData.k
                    color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.16) : Theme.card
                    border.color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.40) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 150 } }

                    Row {
                        anchors.centerIn: parent
                        spacing: 8
                        layoutDirection: Qt.RightToLeft
                        Text { id: pl; text: modelData.l; color: parent.parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                        Rectangle {
                            width: ncT.implicitWidth + 14; height: 22; radius: 11
                            color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.20)
                            anchors.verticalCenter: parent.verticalCenter
                            SequentialAnimation on opacity {
                                running: modelData.pulse
                                loops: Animation.Infinite
                                NumberAnimation { to: 0.4; duration: 700 }
                                NumberAnimation { to: 1.0; duration: 700 }
                            }
                            Text { id: ncT; anchors.centerIn: parent; text: modelData.n; color: modelData.c; font.family: Theme.fontFamilyEn; font.pixelSize: 11; font.weight: Font.Black }
                        }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.filter = modelData.k }
                }
            }
        }

        // ── Empty state ─────────────────────────────────────────
        Column {
            visible: page.filteredClients.length === 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.alignment: Qt.AlignHCenter
            spacing: 14
            topPadding: 80

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 96; height: 96; radius: 24
                color: Qt.rgba(0.55, 0.36, 0.96, 0.10)
                border.color: Qt.rgba(0.55, 0.36, 0.96, 0.25); border.width: 1
                Text { anchors.centerIn: parent; text: "🖥"; font.pixelSize: 48 }
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.clients.length === 0
                      ? "هیچ کامپیوتری متصل نیست"
                      : "هیچ کامپیوتری با این فیلتر/جستجو پیدا نشد"
                color: Theme.text2
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.clients.length === 0
                      ? "وقتی کلاینت‌ها به سرور وصل بشن (پورت 3001) اینجا نمایان می‌شن"
                      : "فیلتر یا متن جستجو رو عوض کن"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 11
            }
        }

        // ── Grid view ───────────────────────────────────────────
        ScrollView {
            visible: page.view === "grid" && page.filteredClients.length > 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth

            GridLayout {
                width: parent.width
                columns: Math.max(1, Math.floor(width / 290))
                columnSpacing: 14
                rowSpacing: 14

                Repeater {
                    model: page.filteredClients
                    delegate: PcCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 100
                        Layout.preferredHeight: 290
                        client: modelData
                        elapsed: { page.tick; return page.elapsedSince(modelData.sessionStart) }
                        remaining: { page.tick; return page.remainingStr(modelData) }
                        userLabel: page.fullName(modelData)
                        onAction: (sid, mode) => openAction(modelData, mode)
                        onContextRequested: (gx, gy) => openContext(modelData, gx, gy)
                    }
                }
            }
        }

        // ── Table view ──────────────────────────────────────────
        GlassCard {
            visible: page.view === "table" && page.filteredClients.length > 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            accent: Theme.cyan

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 8

                Row {
                    Layout.fillWidth: true
                    height: 28
                    spacing: 8
                    layoutDirection: Qt.RightToLeft
                    Repeater {
                        model: [
                            { l: "PC",         w: 120 },
                            { l: "وضعیت",      w: 70 },
                            { l: "کاربر",      w: 180 },
                            { l: "شروع",       w: 110 },
                            { l: "گذشته",      w: 70 },
                            { l: "باقی‌مانده", w: 95 },
                            { l: "اعتبار",     w: 120 },
                            { l: "عملیات",     w: -1 }
                        ]
                        delegate: Item {
                            width: modelData.w === -1 ? Math.max(180, parent.width - 120 - 70 - 180 - 110 - 70 - 95 - 120 - 7 * 8) : modelData.w
                            height: parent.height
                            Text {
                                anchors.fill: parent
                                anchors.rightMargin: 8
                                text: modelData.l
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 11
                                font.weight: Font.Bold
                                horizontalAlignment: Text.AlignRight
                                verticalAlignment: Text.AlignVCenter
                            }
                        }
                    }
                }

                Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; opacity: 0.5 }

                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 4
                    clip: true
                    model: page.filteredClients
                    delegate: PcRow {
                        width: ListView.view.width
                        client: modelData
                        elapsed: { page.tick; return page.elapsedSince(modelData.sessionStart) }
                        remaining: { page.tick; return page.remainingStr(modelData) }
                        userLabel: page.fullName(modelData)
                        onAction: (sid, mode) => openAction(modelData, mode)
                        onContextRequested: (gx, gy) => openContext(modelData, gx, gy)
                    }
                }
            }
        }
    }

    // ── Action dispatcher ────────────────────────────────────
    function openAction(client, mode) {
        if (mode === "voice") {
            voiceModal.targetSocketId = client.socketId;
            voiceModal.computerName   = client.computerName || "—";
            voiceModal.username       = client.username || "—";
            voiceModal.muteRemote     = !!client.voiceMuted;
            voiceModal.open           = true;
            return;
        }
        // Post-pay flip is one click — no modal needed. The server returns
        // the new state, syncClientCredits broadcasts clients:update, the
        // badge in the card updates instantly.
        if (mode === "post-pay") {
            if (!client.userId) { toast.show("⚠ این کامپیوتر کاربر فعالی ندارد", "error"); return }
            const desiredOn = !(client.postPay === 1 || client.postPay === true);
            Api.togglePostPay(Number(client.userId), desiredOn ? 1 : 0);
            toast.show(desiredOn ? "📋 پس‌پرداخت فعال شد" : "📋 پس‌پرداخت غیرفعال شد", "info");
            return;
        }
        actionModal.mode         = mode;
        actionModal.socketId     = client.socketId;
        actionModal.computerName = client.computerName || "—";
        actionModal.username     = client.username || "—";

        if (mode === "assign-user") {
            actionModal.users = page.users;
            actionModal.selectedUserId = Number(client.userId || -1);
        } else if (mode === "network") {
            actionModal.modems  = page.modems;
            actionModal.dnsList = page.dnsList;
            const a = page.assignmentFor(client.computerName);
            actionModal.selectedModemId = a ? a.modem_id : null;
            actionModal.selectedDnsId   = a ? a.dns_id   : null;
        } else if (mode === "pay-debt") {
            // Default the input to the user's current debt — operator usually
            // wants to clear the whole thing, but can edit before submit.
            actionModal.defaultAmountToman = Math.round(Number(client.debt || 0) / 10);
        }
        actionModal.open = true;
    }

    function openContext(client, gx, gy) {
        ctx.socketId     = client.socketId;
        ctx.computerName = client.computerName || "—";
        ctx.username     = page.fullName(client) || (client.username || "");
        ctx.targetClient = client;
        // Map global → local (relative to page)
        const local = page.mapFromGlobal(gx, gy);
        ctx.px = local.x;
        ctx.py = local.y;
        ctx.open = true;
    }

    PcContextMenu {
        id: ctx
        property var targetClient: null
        onPick: function (action) {
            if (targetClient) page.openAction(targetClient, action);
        }
    }

    ActionModal {
        id: actionModal
        onSubmitted: (mode, payload) => {
            if (mode === "message")          Api.messageClient(socketId, payload.text);
            else if (mode === "kick")        Api.kickClient(socketId);
            else if (mode === "power")       Api.powerClient(socketId, payload.action);
            else if (mode === "charge") {
                // Find the user backing this PC — charge their account so the
                // accounting trail (credit_transactions) is correct. The server
                // syncClientCredits then pushes the updated credits to the kiosk.
                const c = clientById(socketId);
                if (!c || !c.userId) {
                    toast.show("⚠ این کامپیوتر کاربر فعالی ندارد — اول کاربر اختصاص بده", "error");
                    return;
                }
                Api.chargeUser(Number(c.userId),
                               Number(payload.amountRial),
                               "افزایش شارژ از پنل کامپیوترها (" + (c.computerName || "") + ")",
                               false);
            }
            else if (mode === "pay-debt") {
                const c = clientById(socketId);
                if (!c || !c.userId) {
                    toast.show("⚠ این کامپیوتر کاربر فعالی ندارد", "error");
                    return;
                }
                Api.payDebt(Number(c.userId),
                            Number(payload.amountRial),
                            "پرداخت بدهی از پنل کامپیوترها (" + (c.computerName || "") + ")");
            }
            else if (mode === "assign-user")
                Api.forceLoginClient(socketId, payload.userId, payload.username, payload.credits);
            else if (mode === "network")
                Api.setNetworkAssignment(actionModal.computerName, payload.modemId, payload.dnsId);
        }
    }

    function clientById(sid) {
        for (let i = 0; i < page.clients.length; ++i)
            if (page.clients[i].socketId === sid) return page.clients[i];
        return null;
    }

    VoiceCallModal {
        id: voiceModal
        onCloseRequested: voiceModal.open = false
    }

    Toast { id: toast }

    // ── Inline PC card ─────────────────────────────────────────
    component PcCard: Rectangle {
        property var    client: ({})
        property string elapsed: ""
        property string remaining: ""
        property string userLabel: ""
        signal action(string sid, string mode)
        signal contextRequested(real gx, real gy)

        readonly property bool isActive: client.status === "active"
        radius: 14
        color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.06) : Theme.card
        border.color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.30) : Theme.border
        border.width: 1

        // Right-click anywhere on the card opens the context menu. Keep
        // acceptedButtons RightButton-only so left clicks still bubble to
        // the action buttons inside.
        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.RightButton
            onPressed: function (mouse) {
                const g = parent.mapToGlobal(mouse.x, mouse.y);
                contextRequested(g.x, g.y);
            }
        }

        Column {
            anchors.fill: parent
            anchors.margins: 14
            spacing: 8

            Row {
                width: parent.width
                spacing: 8
                layoutDirection: Qt.RightToLeft
                Rectangle {
                    width: 10; height: 10; radius: 5
                    anchors.verticalCenter: parent.verticalCenter
                    color: isActive ? Theme.green : Theme.text3
                    SequentialAnimation on opacity {
                        running: isActive
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.4; duration: 700 }
                        NumberAnimation { to: 1.0; duration: 700 }
                    }
                }
                Text { text: client.computerName || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                Item { width: 1; height: 1 }
                Rectangle {
                    height: 20; radius: 10
                    width: stT.implicitWidth + 14
                    anchors.verticalCenter: parent.verticalCenter
                    color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.18) : Qt.rgba(0.43, 0.45, 0.55, 0.15)
                    border.color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Theme.border
                    border.width: 1
                    Text { id: stT; anchors.centerIn: parent; text: isActive ? "فعال" : "آزاد"; color: isActive ? Theme.green : Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                }
            }

            Item {
                width: parent.width
                height: 64
                Text { anchors.centerIn: parent; text: isActive ? "🖥" : "💤"; font.pixelSize: 44; opacity: isActive ? 1 : 0.55 }
            }

            Column {
                width: parent.width
                spacing: 3
                Text {
                    width: parent.width
                    text: userLabel || (client.username ? ("👤 " + client.username) : "آزاد — هیچ کاربری وارد نشده")
                    color: client.username ? Theme.text2 : Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    horizontalAlignment: Text.AlignHCenter
                    elide: Text.ElideRight
                }
                // Debt + post-pay badges row — only visible when meaningful.
                // Both update live via clients:update / credits:update socket
                // events fired by the server tick + every admin charge action.
                Row {
                    width: parent.width
                    spacing: 6
                    layoutDirection: Qt.RightToLeft
                    visible: client.username && (Number(client.debt || 0) > 0 || (client.postPay === 1 || client.postPay === true))

                    // Debt pill (red, "💳 بدهی: ##,### تومان")
                    Rectangle {
                        visible: Number(client.debt || 0) > 0
                        height: 22; radius: 11
                        width: dT.implicitWidth + 16
                        color: Qt.rgba(0.94, 0.27, 0.27, 0.18)
                        border.color: Qt.rgba(0.94, 0.27, 0.27, 0.45)
                        border.width: 1
                        Text {
                            id: dT
                            anchors.centerIn: parent
                            text: "💳 بدهی " + Math.round(Number(client.debt || 0) / 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " ت"
                            color: Theme.red
                            font.family: Theme.fontFamilyEn
                            font.pixelSize: 10
                            font.weight: Font.Bold
                        }
                    }
                    // Post-pay pill (amber, "📋 پس‌پرداخت")
                    Rectangle {
                        visible: client.postPay === 1 || client.postPay === true
                        height: 22; radius: 11
                        width: ppT.implicitWidth + 16
                        color: Qt.rgba(0.96, 0.62, 0.04, 0.18)
                        border.color: Qt.rgba(0.96, 0.62, 0.04, 0.45)
                        border.width: 1
                        Text {
                            id: ppT
                            anchors.centerIn: parent
                            text: "📋 پس‌پرداخت"
                            color: Theme.amber
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                            font.weight: Font.Bold
                        }
                    }
                }
                Row {
                    width: parent.width
                    spacing: 12
                    layoutDirection: Qt.RightToLeft
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "⏱ " + (elapsed || "00:00")
                        color: isActive ? Theme.cyanSoft : Theme.text3
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                    Item { width: 4; height: 1 }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "🪙 " + Math.round(Number(client.credits || 0) / 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " تومان"
                        color: Theme.amber
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                }
                // Remaining time pill — coloured by urgency. Only meaningful
                // when the PC is active (otherwise reads "—").
                Rectangle {
                    visible: isActive
                    width: parent.width
                    height: 28; radius: 14
                    color: {
                        const sec = page.remainingSec(client);
                        if (sec <= 0)        return Qt.rgba(0.94, 0.27, 0.27, 0.20);
                        if (sec < 5 * 60)    return Qt.rgba(0.94, 0.27, 0.27, 0.18);
                        if (sec < 15 * 60)   return Qt.rgba(0.96, 0.62, 0.04, 0.18);
                        return Qt.rgba(0.06, 0.73, 0.51, 0.14);
                    }
                    border.color: {
                        const sec = page.remainingSec(client);
                        if (sec <= 0 || sec < 5 * 60) return Qt.rgba(0.94, 0.27, 0.27, 0.45);
                        if (sec < 15 * 60)            return Qt.rgba(0.96, 0.62, 0.04, 0.45);
                        return Qt.rgba(0.06, 0.73, 0.51, 0.40);
                    }
                    border.width: 1
                    Text {
                        anchors.centerIn: parent
                        text: "⏳ زمان باقی‌مانده: " + (remaining || "—")
                        color: Theme.text
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 12
                        font.weight: Font.Bold
                    }
                }
            }

            // Action row 1: 4 most-used inline pills (charge / message / voice / kick)
            Row {
                width: parent.width
                spacing: 5
                Repeater {
                    model: [
                        { mode: "charge",  txt: "💳", c: Theme.green },
                        { mode: "message", txt: "✉️",  c: Theme.cyan  },
                        { mode: "voice",   txt: "🎙",  c: Theme.violet},
                        { mode: "kick",    txt: "⏻",   c: Theme.red   }
                    ]
                    delegate: Rectangle {
                        width: (parent.width - parent.spacing * 3) / 4; height: 30; radius: 8
                        property bool hovered: btnMA.containsMouse
                        color: hovered ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.22) : Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.10)
                        border.color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.35); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: modelData.txt; font.pixelSize: 14 }
                        MouseArea {
                            id: btnMA
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: action(client.socketId, modelData.mode)
                        }
                    }
                }
            }
            // Action row 2: assign / network / power
            Row {
                width: parent.width
                spacing: 5
                Repeater {
                    model: [
                        { mode: "assign-user", txt: "👤", c: Theme.cyan },
                        { mode: "network",     txt: "🌐", c: Theme.amber },
                        { mode: "power",       txt: "🔌", c: Theme.violet }
                    ]
                    delegate: Rectangle {
                        width: (parent.width - parent.spacing * 2) / 3; height: 30; radius: 8
                        property bool hovered: btn2MA.containsMouse
                        color: hovered ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.22) : Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.10)
                        border.color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.35); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: modelData.txt; font.pixelSize: 14 }
                        MouseArea {
                            id: btn2MA
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: action(client.socketId, modelData.mode)
                        }
                    }
                }
            }
        }
    }

    // ── Inline PC row (table view) ─────────────────────────────
    component PcRow: Rectangle {
        property var    client: ({})
        property string elapsed: ""
        property string remaining: ""
        property string userLabel: ""
        signal action(string sid, string mode)
        signal contextRequested(real gx, real gy)

        readonly property bool isActive: client.status === "active"
        height: 44
        radius: 8
        color: rowMA.containsMouse ? Theme.cardHover : "transparent"
        border.color: Theme.border; border.width: 1
        Behavior on color { ColorAnimation { duration: 130 } }

        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.RightButton
            onPressed: function (mouse) {
                const g = parent.mapToGlobal(mouse.x, mouse.y);
                contextRequested(g.x, g.y);
            }
        }

        Row {
            anchors.fill: parent
            anchors.margins: 8
            spacing: 8
            layoutDirection: Qt.RightToLeft

            Item { width: 120; height: parent.height
                Row {
                    anchors.fill: parent
                    spacing: 6
                    layoutDirection: Qt.RightToLeft
                    Rectangle { width: 8; height: 8; radius: 4; anchors.verticalCenter: parent.verticalCenter; color: isActive ? Theme.green : Theme.text3 }
                    Text { anchors.verticalCenter: parent.verticalCenter; text: client.computerName || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                }
            }
            Item { width: 70; height: parent.height
                Rectangle {
                    height: 22; radius: 11
                    width: rstT.implicitWidth + 14
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.18) : Qt.rgba(0.43, 0.45, 0.55, 0.12)
                    border.color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Theme.border; border.width: 1
                    Text { id: rstT; anchors.centerIn: parent; text: isActive ? "فعال" : "آزاد"; color: isActive ? Theme.green : Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                }
            }
            Item {
                width: 180; height: parent.height
                Column {
                    anchors.fill: parent
                    spacing: 1
                    Text {
                        width: parent.width
                        text: userLabel || (client.username ? ("👤 " + client.username) : "—")
                        color: client.username ? Theme.text2 : Theme.text3
                        font.family: Theme.fontFamily; font.pixelSize: 12
                        horizontalAlignment: Text.AlignRight
                        elide: Text.ElideRight
                    }
                    Row {
                        width: parent.width
                        spacing: 4
                        layoutDirection: Qt.RightToLeft
                        visible: Number(client.debt || 0) > 0 || client.postPay === 1 || client.postPay === true
                        Rectangle {
                            visible: Number(client.debt || 0) > 0
                            height: 18; radius: 9
                            width: dRT.implicitWidth + 12
                            color: Qt.rgba(0.94, 0.27, 0.27, 0.18)
                            border.color: Qt.rgba(0.94, 0.27, 0.27, 0.40); border.width: 1
                            Text {
                                id: dRT
                                anchors.centerIn: parent
                                text: "💳 " + Math.round(Number(client.debt || 0) / 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " ت"
                                color: Theme.red
                                font.family: Theme.fontFamilyEn
                                font.pixelSize: 10
                                font.weight: Font.Bold
                            }
                        }
                        Rectangle {
                            visible: client.postPay === 1 || client.postPay === true
                            height: 18; radius: 9
                            width: ppRT.implicitWidth + 12
                            color: Qt.rgba(0.96, 0.62, 0.04, 0.18)
                            border.color: Qt.rgba(0.96, 0.62, 0.04, 0.40); border.width: 1
                            Text {
                                id: ppRT
                                anchors.centerIn: parent
                                text: "📋 پس‌پرداخت"
                                color: Theme.amber
                                font.family: Theme.fontFamily
                                font.pixelSize: 10
                                font.weight: Font.Bold
                            }
                        }
                    }
                }
            }
            Text {
                width: 110; height: parent.height
                text: client.sessionStart ? Jalali.dateTimeFromIso(client.sessionStart) : "—"
                color: Theme.text3
                font.family: Theme.fontFamilyEn; font.pixelSize: 11
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignRight
            }
            Text {
                width: 70; height: parent.height
                text: elapsed || "—"
                color: isActive ? Theme.cyanSoft : Theme.text3
                font.family: Theme.fontFamilyEn; font.pixelSize: 12; font.weight: Font.Bold
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignRight
            }
            Text {
                width: 95; height: parent.height
                text: remaining || "—"
                color: {
                    if (!isActive) return Theme.text3;
                    const sec = page.remainingSec(client);
                    if (sec <= 0)      return Theme.red;
                    if (sec < 5 * 60)  return Theme.red;
                    if (sec < 15 * 60) return Theme.amber;
                    return Theme.green;
                }
                font.family: Theme.fontFamilyEn; font.pixelSize: 12; font.weight: Font.Bold
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignRight
            }
            Text {
                width: 120; height: parent.height
                text: Math.round(Number(client.credits || 0) / 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " تومان"
                color: Theme.amber
                font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold
                verticalAlignment: Text.AlignVCenter
                horizontalAlignment: Text.AlignRight
            }
            Row {
                spacing: 4
                anchors.verticalCenter: parent.verticalCenter
                Repeater {
                    model: [
                        { mode: "charge",      txt: "💳", c: Theme.green },
                        { mode: "message",     txt: "✉️", c: Theme.cyan },
                        { mode: "voice",       txt: "🎙", c: Theme.violet},
                        { mode: "assign-user", txt: "👤", c: Theme.cyan },
                        { mode: "network",     txt: "🌐", c: Theme.amber },
                        { mode: "power",       txt: "🔌", c: Theme.violet },
                        { mode: "kick",        txt: "⏻", c: Theme.red }
                    ]
                    delegate: Rectangle {
                        width: 26; height: 26; radius: 6
                        property bool hovered: rbtMA.containsMouse
                        color: hovered ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.22) : Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.10)
                        border.color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.32); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: modelData.txt; font.pixelSize: 11 }
                        MouseArea {
                            id: rbtMA
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: action(client.socketId, modelData.mode)
                        }
                    }
                }
            }
        }
        HoverHandler { id: rowMA }
    }
}
