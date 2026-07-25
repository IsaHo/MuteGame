// NetworkPage — DNS servers + Modems config + per-PC assignments. Three tabs.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    property var    dns: []
    property var    modems: []
    property var    assignments: []
    property var    clients: []
    property string tab: "dns"           // dns | modems | clients
    property string clientSearch: ""

    function reload() {
        Api.getDnsServers();
        Api.getModems();
        Api.getNetworkAssignments();
        Api.getClients();
    }

    Component.onCompleted: { reload(); if (!Socket.connected) Socket.connectTo(Api.baseUrl) }
    // Slow polling acts as a safety net when the socket is down — when live,
    // we get clients:update + client:assignment pushes instead.
    Timer { interval: Socket.connected ? 30000 : 8000; running: page.tab === "clients"; repeat: true; triggeredOnStart: false; onTriggered: page.reload() }

    // Live: client:assignment fires when an admin re-assigns modem/DNS to a
    // PC; clients:update fires on connect/disconnect. Both refresh the same
    // tab, so route them through reload().
    Connections {
        target: Socket
        function onMessageReceived(name, payload) {
            if (name === "clients:update") {
                try { page.clients = JSON.parse(payload); } catch (e) { Api.getClients(); }
            } else if (name === "client:assignment") {
                Api.getNetworkAssignments();
            }
        }
    }

    Connections {
        target: Api
        function onDnsServersDone(rows)            { page.dns = rows }
        function onModemsDone(rows)                { page.modems = rows }
        function onNetworkAssignmentsDone(rows)    { page.assignments = rows }
        function onClientsDone(rows)               { page.clients = rows }
        function onDnsMutationDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getDnsServers();
            toast.show("ذخیره شد ✅", "success");
        }
        function onModemMutationDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getModems();
            toast.show("ذخیره شد ✅", "success");
        }
        function onNetworkAssignmentDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getNetworkAssignments();
            toast.show("تخصیص ذخیره و به کلاینت ارسال شد ✅", "success");
        }
    }

    // ── Helper: merged list of computer names (connected + assigned) ─
    readonly property var allComputers: {
        const set = {};
        for (let i = 0; i < clients.length; ++i)     if (clients[i].computerName)   set[clients[i].computerName] = true;
        for (let i = 0; i < assignments.length; ++i) if (assignments[i].computer_name) set[assignments[i].computer_name] = true;
        return Object.keys(set).sort();
    }
    function findAssignment(name) {
        for (let i = 0; i < assignments.length; ++i)
            if (assignments[i].computer_name === name) return assignments[i];
        return { computer_name: name, modem_id: null, dns_id: null, last_seen: null };
    }
    function isOnline(name) {
        for (let i = 0; i < clients.length; ++i)
            if (clients[i].computerName === name) return true;
        return false;
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // Topbar ──────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Text { text: "شبکه و DNS"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 24; font.weight: Font.Bold }
            Text { text: "  ·  پیکربندی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 13 }

            Item { Layout.fillWidth: true }

            GlassButton {
                visible: page.tab !== "clients"
                text: page.tab === "dns" ? "➕ DNS جدید" : "➕ مودم جدید"
                variant: "primary"
                onClicked: {
                    if (page.tab === "dns") { dnsForm.beginCreate(); dnsForm.open = true }
                    else                    { modemForm.beginCreate(); modemForm.open = true }
                }
            }
        }

        // Tabs ────────────────────────────────────────────────────
        Row {
            Layout.fillWidth: true
            spacing: 8
            layoutDirection: Qt.RightToLeft
            Repeater {
                model: [
                    { k: "dns",     l: "🛡 DNS",       n: page.dns.length,           c: Theme.cyan },
                    { k: "modems",  l: "📡 مودم‌ها",   n: page.modems.length,        c: Theme.violet },
                    { k: "clients", l: "🖥 تخصیص PCها", n: page.allComputers.length,  c: Theme.amber }
                ]
                delegate: Rectangle {
                    height: 36; radius: 18
                    width: tlb.implicitWidth + cT.implicitWidth + 50
                    property bool active: page.tab === modelData.k
                    color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.15) : Theme.card
                    border.color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.35) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 150 } }
                    Row {
                        anchors.centerIn: parent
                        spacing: 8
                        layoutDirection: Qt.RightToLeft
                        Text { id: tlb; text: modelData.l; color: parent.parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                        Rectangle {
                            width: cT.implicitWidth + 14; height: 20; radius: 10
                            color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.20)
                            anchors.verticalCenter: parent.verticalCenter
                            Text { id: cT; anchors.centerIn: parent; text: modelData.n; color: modelData.c; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Black }
                        }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.tab = modelData.k }
                }
            }
        }

        // ── DNS body ────────────────────────────────────────────
        Item {
            visible: page.tab === "dns"
            Layout.fillWidth: true
            Layout.fillHeight: true

            Column {
                visible: page.dns.length === 0
                anchors.centerIn: parent
                spacing: 14
                Rectangle { anchors.horizontalCenter: parent.horizontalCenter; width: 80; height: 80; radius: 20; color: Qt.rgba(0.06, 0.71, 0.83, 0.10); border.color: Qt.rgba(0.06, 0.71, 0.83, 0.25); border.width: 1
                    Text { anchors.centerIn: parent; text: "🌐"; font.pixelSize: 40 }
                }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "هیچ DNS سروری ثبت نشده"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 14 }
            }

            ListView {
                visible: page.dns.length > 0
                anchors.fill: parent
                spacing: 8
                clip: true
                model: page.dns
                delegate: Rectangle {
                    width: ListView.view.width
                    height: 70
                    radius: 12
                    color: dnsRowMA.hovered ? Theme.cardHover : Theme.card
                    border.color: modelData.is_default === 1 ? Theme.green : Theme.border
                    border.width: modelData.is_default === 1 ? 2 : 1
                    Behavior on color { ColorAnimation { duration: 130 } }

                    Row {
                        anchors.fill: parent
                        anchors.margins: 14
                        spacing: 12
                        layoutDirection: Qt.RightToLeft

                        Rectangle {
                            width: 44; height: 44; radius: 12
                            anchors.verticalCenter: parent.verticalCenter
                            color: Qt.rgba(0.06, 0.71, 0.83, 0.14)
                            border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                            Text { anchors.centerIn: parent; text: "🌐"; font.pixelSize: 22 }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 4
                            width: 240
                            Row {
                                spacing: 8
                                layoutDirection: Qt.RightToLeft
                                Text { text: modelData.name || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                                Rectangle {
                                    visible: modelData.is_default === 1
                                    height: 18; radius: 9
                                    width: defT.implicitWidth + 12
                                    color: Qt.rgba(0.06, 0.73, 0.51, 0.20)
                                    border.color: Qt.rgba(0.06, 0.73, 0.51, 0.40); border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { id: defT; anchors.centerIn: parent; text: "✓ پیش‌فرض"; color: Theme.green; font.family: Theme.fontFamily; font.pixelSize: 9; font.weight: Font.Bold }
                                }
                                // Country pill
                                Rectangle {
                                    height: 18; radius: 9
                                    width: cntyT.implicitWidth + 12
                                    property bool ir: (modelData.country || "IR") === "IR"
                                    color: ir ? Qt.rgba(0.06, 0.73, 0.51, 0.15) : Qt.rgba(0.06, 0.71, 0.83, 0.15)
                                    border.color: ir ? Qt.rgba(0.06, 0.73, 0.51, 0.30) : Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { id: cntyT; anchors.centerIn: parent
                                        text: parent.ir ? "🇮🇷 ایران" : "🌍 بین‌المللی"
                                        color: parent.ir ? Theme.green : Theme.cyanSoft
                                        font.family: Theme.fontFamily; font.pixelSize: 9; font.weight: Font.Bold }
                                }
                            }
                            Text {
                                text: modelData.notes || ""
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 10
                                width: 240
                                elide: Text.ElideRight
                                visible: text !== ""
                            }
                        }
                        Item { width: 16; height: 1 }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 2
                            Text { text: modelData.primary_dns || "—"; color: Theme.cyanSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 13; font.weight: Font.Bold }
                            Text { text: modelData.secondary_dns || "—"; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 11 }
                        }
                        Item { width: 8; height: 1 }
                        Row {
                            spacing: 6
                            anchors.verticalCenter: parent.verticalCenter
                            Rectangle {
                                visible: modelData.is_default !== 1
                                width: 32; height: 32; radius: 8
                                color: defMA.containsMouse ? Qt.rgba(0.06, 0.73, 0.51, 0.20) : "transparent"
                                border.color: Qt.rgba(0.06, 0.73, 0.51, 0.30); border.width: 1
                                Text { anchors.centerIn: parent; text: "★"; color: Theme.green; font.pixelSize: 14 }
                                MouseArea { id: defMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: Api.setDefaultDns(modelData.id) }
                            }
                            Rectangle {
                                width: 32; height: 32; radius: 8
                                color: edDMA.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : "transparent"
                                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                                Text { anchors.centerIn: parent; text: "✏️"; font.pixelSize: 13 }
                                MouseArea { id: edDMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { dnsForm.beginEdit(modelData); dnsForm.open = true } }
                            }
                            Rectangle {
                                width: 32; height: 32; radius: 8
                                color: rmDMA.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.20) : "transparent"
                                border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                                Text { anchors.centerIn: parent; text: "🗑"; font.pixelSize: 12 }
                                MouseArea { id: rmDMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { confirmRm.kind = "dns"; confirmRm.target = modelData; confirmRm.open = true } }
                            }
                        }
                    }
                    HoverHandler { id: dnsRowMA }
                }
            }
        }

        // ── Modems body ─────────────────────────────────────────
        Item {
            visible: page.tab === "modems"
            Layout.fillWidth: true
            Layout.fillHeight: true

            Column {
                visible: page.modems.length === 0
                anchors.centerIn: parent
                spacing: 14
                Rectangle { anchors.horizontalCenter: parent.horizontalCenter; width: 80; height: 80; radius: 20; color: Qt.rgba(0.55, 0.36, 0.96, 0.10); border.color: Qt.rgba(0.55, 0.36, 0.96, 0.25); border.width: 1
                    Text { anchors.centerIn: parent; text: "📡"; font.pixelSize: 40 }
                }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "هیچ مودمی ثبت نشده"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 14 }
            }

            ListView {
                visible: page.modems.length > 0
                anchors.fill: parent
                spacing: 8
                clip: true
                model: page.modems
                delegate: Rectangle {
                    width: ListView.view.width
                    height: 64
                    radius: 12
                    color: mRowMA.hovered ? Theme.cardHover : Theme.card
                    border.color: Theme.border; border.width: 1
                    Behavior on color { ColorAnimation { duration: 130 } }

                    Row {
                        anchors.fill: parent
                        anchors.margins: 14
                        spacing: 12
                        layoutDirection: Qt.RightToLeft

                        Rectangle {
                            width: 44; height: 44; radius: 12
                            anchors.verticalCenter: parent.verticalCenter
                            color: Qt.rgba(0.55, 0.36, 0.96, 0.14)
                            border.color: Qt.rgba(0.55, 0.36, 0.96, 0.30); border.width: 1
                            Text { anchors.centerIn: parent; text: "📡"; font.pixelSize: 22 }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 3
                            width: 240
                            Text { text: modelData.name || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                            Text { text: modelData.notes || ""; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; width: parent.width; elide: Text.ElideRight; visible: text !== "" }
                        }
                        Item { width: 16; height: 1 }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 2
                            Text { text: "IP: " + (modelData.ip || "—"); color: Theme.violetSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 13; font.weight: Font.Bold }
                            Text { text: "GW: " + (modelData.gateway || "—"); color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 11 }
                        }
                        Item { width: 8; height: 1 }
                        Row {
                            spacing: 6
                            anchors.verticalCenter: parent.verticalCenter
                            Rectangle {
                                width: 32; height: 32; radius: 8
                                color: edMMA.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : "transparent"
                                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                                Text { anchors.centerIn: parent; text: "✏️"; font.pixelSize: 13 }
                                MouseArea { id: edMMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { modemForm.beginEdit(modelData); modemForm.open = true } }
                            }
                            Rectangle {
                                width: 32; height: 32; radius: 8
                                color: rmMMA.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.20) : "transparent"
                                border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                                Text { anchors.centerIn: parent; text: "🗑"; font.pixelSize: 12 }
                                MouseArea { id: rmMMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { confirmRm.kind = "modem"; confirmRm.target = modelData; confirmRm.open = true } }
                            }
                        }
                    }
                    HoverHandler { id: mRowMA }
                }
            }
        }

        // ── Clients (per-PC assignment) body ───────────────────
        ColumnLayout {
            visible: page.tab === "clients"
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            // Header w/ search + helper text
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                Text { text: "🖥 تخصیص هر کامپیوتر به مودم و DNS"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                Item { Layout.fillWidth: true }
                Text { text: "تغییرات بلافاصله به کلاینت ارسال می‌شه"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                GlassInput {
                    Layout.preferredWidth: 200
                    placeholder: "🔍 جستجوی PC…"
                    text: page.clientSearch
                    onTextChanged: page.clientSearch = text
                }
            }

            // Empty
            Column {
                visible: page.allComputers.length === 0
                Layout.alignment: Qt.AlignCenter
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 14
                topPadding: 80
                Rectangle { anchors.horizontalCenter: parent.horizontalCenter; width: 80; height: 80; radius: 20; color: Qt.rgba(0.96, 0.62, 0.04, 0.10); border.color: Qt.rgba(0.96, 0.62, 0.04, 0.25); border.width: 1
                    Text { anchors.centerIn: parent; text: "🖥"; font.pixelSize: 40 }
                }
                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "هنوز هیچ کامپیوتری متصل یا تعریف نشده"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 14 }
            }

            // Table header
            Rectangle {
                visible: page.allComputers.length > 0
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                radius: 8
                color: Theme.bg2
                border.color: Theme.border; border.width: 1
                Row {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 10
                    layoutDirection: Qt.RightToLeft
                    Text { width: 160; text: "کامپیوتر"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Text { width: 90;  text: "وضعیت";   color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Item { width: 14; height: 1 }
                    Text { width: 220; text: "مودم";     color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Text { width: 220; text: "DNS";      color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Item { Layout.fillWidth: true; width: 1; height: 1 }
                    Text { text: "آخرین ارتباط"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            ListView {
                visible: page.allComputers.length > 0
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 6
                clip: true
                model: {
                    const s = page.clientSearch.trim().toLowerCase();
                    if (!s) return page.allComputers;
                    return page.allComputers.filter(n => n.toLowerCase().indexOf(s) !== -1);
                }
                delegate: Rectangle {
                    width: ListView.view.width
                    height: 56
                    radius: 10
                    color: cliRowMA.hovered ? Theme.cardHover : Theme.card
                    border.color: Theme.border; border.width: 1

                    readonly property var ass: page.findAssignment(modelData)
                    readonly property bool online: page.isOnline(modelData)

                    Row {
                        anchors.fill: parent
                        anchors.margins: 10
                        spacing: 10
                        layoutDirection: Qt.RightToLeft

                        // Computer name
                        Row {
                            width: 160
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 8
                            layoutDirection: Qt.RightToLeft
                            Text { text: "🖥"; font.pixelSize: 16; anchors.verticalCenter: parent.verticalCenter }
                            Text { text: modelData; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 13; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter; width: 120; elide: Text.ElideRight }
                        }
                        // Status pill
                        Rectangle {
                            width: 80; height: 22; radius: 11
                            anchors.verticalCenter: parent.verticalCenter
                            color: online ? Qt.rgba(0.06, 0.73, 0.51, 0.18) : Qt.rgba(1, 1, 1, 0.04)
                            border.color: online ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Theme.border; border.width: 1
                            Text { anchors.centerIn: parent
                                text: online ? "● آنلاین" : "○ آفلاین"
                                color: online ? Theme.green : Theme.text3
                                font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                        }
                        Item { width: 14; height: 1 }
                        // Modem dropdown
                        ComboBox {
                            width: 220; height: 32
                            anchors.verticalCenter: parent.verticalCenter
                            model: {
                                const m = [{ id: 0, label: "— هیچکدام —" }];
                                for (let i = 0; i < page.modems.length; ++i)
                                    m.push({ id: page.modems[i].id, label: page.modems[i].name + " (" + (page.modems[i].ip || "—") + ")" });
                                return m;
                            }
                            textRole: "label"
                            valueRole: "id"
                            currentIndex: {
                                const cur = ass.modem_id;
                                if (!cur) return 0;
                                for (let i = 0; i < model.length; ++i) if (model[i].id === cur) return i;
                                return 0;
                            }
                            onActivated: {
                                const newId = model[currentIndex].id || null;
                                if (newId !== ass.modem_id)
                                    Api.setNetworkAssignment(modelData, newId, ass.dns_id);
                            }
                            background: Rectangle { radius: 8; color: Theme.bg2; border.color: Theme.border; border.width: 1 }
                            contentItem: Text {
                                leftPadding: 10; rightPadding: 26
                                text: parent.displayText
                                color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 11
                                horizontalAlignment: Text.AlignRight; verticalAlignment: Text.AlignVCenter
                            }
                            popup.background: Rectangle { color: Theme.bg2; border.color: Theme.border; border.width: 1; radius: 8 }
                        }
                        // DNS dropdown
                        ComboBox {
                            width: 220; height: 32
                            anchors.verticalCenter: parent.verticalCenter
                            model: {
                                const m = [{ id: 0, label: "— پیش‌فرض —" }];
                                for (let i = 0; i < page.dns.length; ++i)
                                    m.push({ id: page.dns[i].id, label: page.dns[i].name + (page.dns[i].is_default === 1 ? " ★" : "") });
                                return m;
                            }
                            textRole: "label"
                            valueRole: "id"
                            currentIndex: {
                                const cur = ass.dns_id;
                                if (!cur) return 0;
                                for (let i = 0; i < model.length; ++i) if (model[i].id === cur) return i;
                                return 0;
                            }
                            onActivated: {
                                const newId = model[currentIndex].id || null;
                                if (newId !== ass.dns_id)
                                    Api.setNetworkAssignment(modelData, ass.modem_id, newId);
                            }
                            background: Rectangle { radius: 8; color: Theme.bg2; border.color: Theme.border; border.width: 1 }
                            contentItem: Text {
                                leftPadding: 10; rightPadding: 26
                                text: parent.displayText
                                color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 11
                                horizontalAlignment: Text.AlignRight; verticalAlignment: Text.AlignVCenter
                            }
                            popup.background: Rectangle { color: Theme.bg2; border.color: Theme.border; border.width: 1; radius: 8 }
                        }
                        Item { Layout.fillWidth: true; width: 1; height: 1 }
                        // Last seen
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: ass.last_seen ? Jalali.dateTime(ass.last_seen) : "—"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                        }
                    }
                    HoverHandler { id: cliRowMA }
                }
            }

            // Warning alert
            Rectangle {
                visible: page.allComputers.length > 0
                Layout.fillWidth: true
                Layout.preferredHeight: alertCol.implicitHeight + 24
                radius: 12
                color: Qt.rgba(0.96, 0.62, 0.04, 0.08)
                border.color: Qt.rgba(0.96, 0.62, 0.04, 0.30); border.width: 1
                Row {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 12
                    layoutDirection: Qt.RightToLeft
                    Text { text: "⚠️"; font.pixelSize: 22; anchors.verticalCenter: parent.verticalCenter }
                    Column {
                        id: alertCol
                        spacing: 4
                        width: parent.width - 50
                        Text {
                            text: "تنظیمات DNS و مودم به کلاینت‌ها ارسال می‌شه."
                            color: Theme.amber
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                            wrapMode: Text.WordWrap
                            width: parent.width
                        }
                        Text {
                            text: "کلاینت ویندوزی برای اعمال واقعی روی شبکه باید با دسترسی Administrator دستورات netsh و route را اجرا کند. این رو می‌تونی توی فایل main.js کلاینت فعال کنی (در حال حاضر فقط دیتا ارسال می‌شه)."
                            color: Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                            width: parent.width
                        }
                    }
                }
            }
        }
    }

    // ── DNS form modal ─────────────────────────────────────────
    Rectangle {
        id: dnsForm
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        visible: open
        z: 1500
        property bool open: false
        property int  editId: -1
        property string title: ""
        property string countryKey: "IR"

        function beginCreate() {
            editId = -1; title = "➕ DNS جدید";
            dnsName.text = ""; dnsPri.text = ""; dnsSec.text = ""; dnsNotes.text = "";
            countryKey = "IR";
        }
        function beginEdit(d) {
            editId = d.id; title = "✏️ ویرایش DNS";
            dnsName.text = d.name || "";
            dnsPri.text = d.primary_dns || "";
            dnsSec.text = d.secondary_dns || "";
            dnsNotes.text = d.notes || "";
            countryKey = d.country || "IR";
        }

        MouseArea { anchors.fill: parent; onClicked: dnsForm.open = false }
        Rectangle {
            width: 460
            height: dCol.implicitHeight + 32
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }
            ColumnLayout {
                id: dCol
                anchors.fill: parent
                anchors.margins: 20
                spacing: 12
                Text { text: dnsForm.title; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold }
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "نام"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    GlassInput { id: dnsName; width: parent.width; placeholder: "Shecan" }
                }
                Row { Layout.fillWidth: true; spacing: 10
                    Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                        Text { text: "DNS اصلی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: dnsPri; width: parent.width; placeholder: "178.22.122.100" }
                    }
                    Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                        Text { text: "DNS ثانویه (اختیاری)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: dnsSec; width: parent.width; placeholder: "185.51.200.2" }
                    }
                }
                // Country toggle (IR / INT)
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "کشور"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    Row { spacing: 8; layoutDirection: Qt.RightToLeft
                        Repeater {
                            model: [
                                { k: "IR",  l: "🇮🇷 ایران",       c: Theme.green },
                                { k: "INT", l: "🌍 بین‌المللی", c: Theme.cyan }
                            ]
                            delegate: Rectangle {
                                height: 36; radius: 10
                                width: cy.implicitWidth + 28
                                property bool active: dnsForm.countryKey === modelData.k
                                color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.18) : Theme.card
                                border.color: active ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.40) : Theme.border
                                border.width: 1
                                Behavior on color { ColorAnimation { duration: 130 } }
                                Text { id: cy; anchors.centerIn: parent; text: modelData.l; color: parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: dnsForm.countryKey = modelData.k }
                            }
                        }
                    }
                }
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "یادداشت (اختیاری)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    GlassInput { id: dnsNotes; width: parent.width; placeholder: "..." }
                }
                RowLayout { Layout.fillWidth: true; spacing: 10
                    GlassButton { text: "انصراف"; variant: "ghost"; onClicked: dnsForm.open = false }
                    GlassButton {
                        Layout.fillWidth: true
                        text: dnsForm.editId >= 0 ? "✅ ذخیره" : "✅ ثبت"
                        variant: "primary"
                        onClicked: {
                            if (!dnsName.text || !dnsPri.text) { toast.show("نام و DNS اصلی الزامی است", "error"); return }
                            const data = { name: dnsName.text, primary_dns: dnsPri.text, secondary_dns: dnsSec.text, country: dnsForm.countryKey, notes: dnsNotes.text };
                            if (dnsForm.editId >= 0) Api.updateDns(dnsForm.editId, data);
                            else Api.createDns(data);
                            dnsForm.open = false;
                        }
                    }
                }
            }
        }
    }

    // ── Modem form modal ───────────────────────────────────────
    Rectangle {
        id: modemForm
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        visible: open
        z: 1500
        property bool open: false
        property int  editId: -1
        property string title: ""

        function beginCreate() {
            editId = -1; title = "➕ مودم جدید";
            mName.text = ""; mIp.text = ""; mGw.text = ""; mNotes.text = "";
        }
        function beginEdit(m) {
            editId = m.id; title = "✏️ ویرایش مودم";
            mName.text = m.name || "";
            mIp.text = m.ip || "";
            mGw.text = m.gateway || "";
            mNotes.text = m.notes || "";
        }

        MouseArea { anchors.fill: parent; onClicked: modemForm.open = false }
        Rectangle {
            width: 460
            height: mCol.implicitHeight + 32
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }
            ColumnLayout {
                id: mCol
                anchors.fill: parent
                anchors.margins: 20
                spacing: 12
                Text { text: modemForm.title; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold }
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "نام مودم"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    GlassInput { id: mName; width: parent.width; placeholder: "مودم اصلی" }
                }
                Row { Layout.fillWidth: true; spacing: 10
                    Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                        Text { text: "آی‌پی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: mIp; width: parent.width; placeholder: "192.168.1.1" }
                    }
                    Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                        Text { text: "Gateway (اختیاری)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: mGw; width: parent.width; placeholder: "192.168.1.254" }
                    }
                }
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "یادداشت (اختیاری)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    GlassInput { id: mNotes; width: parent.width; placeholder: "Mobinnet — 30مگابیت" }
                }
                RowLayout { Layout.fillWidth: true; spacing: 10
                    GlassButton { text: "انصراف"; variant: "ghost"; onClicked: modemForm.open = false }
                    GlassButton {
                        Layout.fillWidth: true
                        text: modemForm.editId >= 0 ? "✅ ذخیره" : "✅ ثبت"
                        variant: "primary"
                        onClicked: {
                            if (!mName.text || !mIp.text) { toast.show("نام و آی‌پی الزامی است", "error"); return }
                            const data = { name: mName.text, ip: mIp.text, gateway: mGw.text, notes: mNotes.text };
                            if (modemForm.editId >= 0) Api.updateModem(modemForm.editId, data);
                            else Api.createModem(data);
                            modemForm.open = false;
                        }
                    }
                }
            }
        }
    }

    ConfirmDialog {
        id: confirmRm
        property string kind: ""
        property var target: ({})
        title: kind === "dns" ? "حذف DNS" : "حذف مودم"
        body: (kind === "dns" ? "DNS «" : "مودم «") + (target.name || "") + "» حذف بشه؟"
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: {
            if (kind === "dns")        Api.deleteDns(target.id);
            else if (kind === "modem") Api.deleteModem(target.id);
        }
    }

    Toast { id: toast }
}
