// ActionModal — generic dialog for the per-PC actions. Modes:
//
//   "voice"       — push-to-talk (handled separately by VoiceCallModal)
//   "message"     — multi-line text → POST /clients/:id/message
//   "charge"      — toman input + 50k quick-picks → POST /users/:userId/charge
//   "kick"        — confirmation only → POST /clients/:id/kick
//   "assign-user" — dropdown of users → POST /clients/:id/force-login
//   "network"     — dropdowns of modem + DNS → POST /network/assignments
//   "power"       — 3 buttons (lock/restart/shutdown) → POST /clients/:id/power
//
// Submitted callback receives (mode, payload) where payload is the
// mode-specific object the page needs to translate into the right Api call.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)
    visible: open
    z: 1000

    property bool   open: false
    property string mode: ""
    property string socketId: ""
    property string computerName: ""
    property string username: ""
    // For assign-user mode
    property var    users:    []
    property int    selectedUserId: -1
    // For network mode
    property var    modems:   []
    property var    dnsList:  []
    property var    selectedModemId: null
    property var    selectedDnsId:   null
    // For pay-debt mode — initial amount (toman) to prefill the input
    property int    defaultAmountToman: 0

    signal closed()
    signal submitted(string mode, var payload)

    onOpenChanged: if (open) {
        // reset form fields each time the modal opens — otherwise stale text
        // (e.g. "60" from last extend) bleeds into the next charge dialog.
        if (mode === "charge")   { amountInput.text = "50,000" }
        if (mode === "pay-debt") {
            const t = Math.max(0, Number(defaultAmountToman) || 0);
            amountInput.text = t > 0 ? t.toLocaleString(Qt.locale("en_US"), 'f', 0) : "0";
        }
        if (mode === "message") { msgArea.text = "" }
        if (mode === "assign-user") { selectedUserId = -1 }
        if (mode === "network") {
            selectedModemId = null;
            selectedDnsId   = null;
        }
    }

    MouseArea { anchors.fill: parent; onClicked: { root.open = false; root.closed() } }

    GlassCard {
        id: card
        width: 480
        height: column.implicitHeight + 56
        anchors.centerIn: parent
        accent: root.mode === "kick"        ? Theme.red
              : root.mode === "charge"      ? Theme.green
              : root.mode === "pay-debt"    ? Theme.green
              : root.mode === "voice"       ? Theme.violet
              : root.mode === "assign-user" ? Theme.cyan
              : root.mode === "network"     ? Theme.amber
              : root.mode === "power"       ? Theme.red
              :                                Theme.cyan
        radius: 18

        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: column
            anchors.fill: parent
            anchors.margins: 28
            spacing: 16

            Text {
                Layout.fillWidth: true
                text: root.mode === "voice"        ? ("🎙 وویس به " + root.computerName)
                    : root.mode === "message"      ? ("✉️ پیام به " + root.computerName)
                    : root.mode === "charge"       ? ("💳 افزایش شارژ — " + root.computerName)
                    : root.mode === "pay-debt"     ? ("💵 پرداخت بدهی — " + root.computerName)
                    : root.mode === "kick"         ? ("⏻ پایان نشست — " + root.computerName)
                    : root.mode === "assign-user"  ? ("👤 تخصیص کاربر — " + root.computerName)
                    : root.mode === "network"      ? ("🌐 شبکه — " + root.computerName)
                    : root.mode === "power"        ? ("🔌 پاور — " + root.computerName)
                    :                                 ""
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 18
                font.weight: Font.Bold
                horizontalAlignment: Text.AlignRight
            }

            Text {
                Layout.fillWidth: true
                visible: root.username.length > 0 && root.username !== "—"
                text: "کاربر فعلی: " + root.username
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
                horizontalAlignment: Text.AlignRight
            }

            // ── Message mode ──────────────────────────────────────────
            Column {
                Layout.fillWidth: true
                visible: root.mode === "message"
                spacing: 6
                Text { text: "متن پیام"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Medium }
                Rectangle {
                    width: parent.width; height: 110; radius: 12
                    color: msgArea.activeFocus ? Theme.cardHover : Theme.card
                    border.color: msgArea.activeFocus ? Theme.border2 : Theme.border
                    border.width: 1
                    TextArea {
                        id: msgArea
                        anchors.fill: parent
                        anchors.margins: 10
                        placeholderText: "پیام شما به کاربر…"
                        placeholderTextColor: Theme.text3
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 14
                        background: null
                        wrapMode: TextEdit.Wrap
                    }
                }
            }

            // ── Charge / Pay-debt modes (share the toman input) ──────
            Column {
                Layout.fillWidth: true
                visible: root.mode === "charge" || root.mode === "pay-debt"
                spacing: 10

                Text {
                    visible: root.mode === "pay-debt"
                    text: "بدهی فعلی: " + Number(root.defaultAmountToman).toLocaleString(Qt.locale("en_US"), 'f', 0) + " تومان"
                    color: Theme.red
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                }

                GlassInput {
                    id: amountInput
                    width: parent.width
                    label: "مبلغ (تومان)"
                    placeholder: "50,000"
                    numeric: true
                    text: "50,000"
                    onSubmitted: root.confirmAction()
                }
                Text {
                    text: "💡 معادل " + Number(String(amountInput.text).replace(/,/g, "") * 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " ریال در دیتابیس ذخیره می‌شه"
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    visible: Number(String(amountInput.text).replace(/,/g, "")) > 0
                }
                // Quick-picks: 50k, 100k, 200k, 500k toman
                Row {
                    spacing: 6
                    Repeater {
                        model: [50000, 100000, 200000, 500000]
                        delegate: Rectangle {
                            width: 78; height: 32; radius: 8
                            color: Number(String(amountInput.text).replace(/,/g, "")) === modelData
                                   ? Qt.rgba(0.06, 0.73, 0.51, 0.30)
                                   : Theme.card
                            border.color: Number(String(amountInput.text).replace(/,/g, "")) === modelData
                                          ? Qt.rgba(0.06, 0.73, 0.51, 0.55)
                                          : Theme.border
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                text: (modelData / 1000) + "k"
                                color: Theme.text
                                font.family: Theme.fontFamilyEn
                                font.pixelSize: 12
                                font.weight: Font.Bold
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: amountInput.text = Number(modelData).toLocaleString(Qt.locale("en_US"), 'f', 0)
                            }
                        }
                    }
                }
            }

            // ── Kick confirm ──────────────────────────────────────────
            Text {
                Layout.fillWidth: true
                visible: root.mode === "kick"
                text: "آیا مطمئنی که می‌خواهی نشست این کامپیوتر را پایان دهی؟ کاربر فوراً قطع می‌شود."
                color: Theme.text2
                font.family: Theme.fontFamily
                font.pixelSize: 13
                horizontalAlignment: Text.AlignRight
                wrapMode: Text.Wrap
            }

            // ── Assign-user mode ──────────────────────────────────────
            Column {
                Layout.fillWidth: true
                visible: root.mode === "assign-user"
                spacing: 10

                Text {
                    text: "کاربر مورد نظر را برای ورود اجباری روی این کامپیوتر انتخاب کن"
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                    width: parent.width
                    wrapMode: Text.Wrap
                }
                Rectangle {
                    width: parent.width; height: 220; radius: 12
                    color: Theme.card
                    border.color: Theme.border; border.width: 1
                    ListView {
                        anchors.fill: parent
                        anchors.margins: 6
                        clip: true
                        spacing: 4
                        model: root.users
                        delegate: Rectangle {
                            width: ListView.view.width
                            height: 38
                            radius: 8
                            property bool sel: root.selectedUserId === modelData.id
                            color: sel ? Qt.rgba(0.36, 0.74, 0.95, 0.20)
                                       : (uMA.containsMouse ? Theme.cardHover : "transparent")
                            border.color: sel ? Qt.rgba(0.36, 0.74, 0.95, 0.40) : "transparent"
                            border.width: 1
                            Row {
                                anchors.fill: parent
                                anchors.margins: 8
                                layoutDirection: Qt.RightToLeft
                                spacing: 10
                                Text {
                                    text: "👤 " + (modelData.username || "")
                                    color: Theme.text
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 12
                                    font.weight: Font.Bold
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                                Text {
                                    text: ((modelData.name || "") + " " + (modelData.family || "")).trim() || "—"
                                    color: Theme.text2
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                                Item { width: 1; height: 1 }
                                Text {
                                    text: Math.round(Number(modelData.credits || 0) / 10).toLocaleString(Qt.locale("en_US"), 'f', 0) + " تومان"
                                    color: Theme.amber
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 11
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                            }
                            MouseArea {
                                id: uMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.selectedUserId = modelData.id
                            }
                        }
                    }
                }
            }

            // ── Network mode ──────────────────────────────────────────
            Column {
                Layout.fillWidth: true
                visible: root.mode === "network"
                spacing: 12

                // Modem picker
                Column {
                    width: parent.width
                    spacing: 4
                    Text { text: "مودم"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12 }
                    ComboBox {
                        id: modemCombo
                        width: parent.width
                        model: {
                            const arr = [{ id: null, name: "— هیچ —" }];
                            for (let i = 0; i < root.modems.length; ++i) arr.push(root.modems[i]);
                            return arr;
                        }
                        textRole: "name"
                        valueRole: "id"
                        currentIndex: {
                            const list = model;
                            for (let i = 0; i < list.length; ++i)
                                if (list[i].id === root.selectedModemId) return i;
                            return 0;
                        }
                        onActivated: root.selectedModemId = model[currentIndex].id
                    }
                }

                // DNS picker
                Column {
                    width: parent.width
                    spacing: 4
                    Text { text: "DNS"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12 }
                    ComboBox {
                        id: dnsCombo
                        width: parent.width
                        model: {
                            const arr = [{ id: null, name: "— هیچ —" }];
                            for (let i = 0; i < root.dnsList.length; ++i) arr.push(root.dnsList[i]);
                            return arr;
                        }
                        textRole: "name"
                        valueRole: "id"
                        currentIndex: {
                            const list = model;
                            for (let i = 0; i < list.length; ++i)
                                if (list[i].id === root.selectedDnsId) return i;
                            return 0;
                        }
                        onActivated: root.selectedDnsId = model[currentIndex].id
                    }
                }
            }

            // ── Power mode ────────────────────────────────────────────
            Column {
                Layout.fillWidth: true
                visible: root.mode === "power"
                spacing: 10

                Text {
                    text: "یک گزینه را انتخاب کن — کاربر بلافاصله متوجه می‌شه."
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                    width: parent.width
                    wrapMode: Text.Wrap
                }
                RowLayout {
                    width: parent.width
                    spacing: 10

                    Repeater {
                        model: [
                            { a: "lock",     l: "🔒 قفل کن",   c: Theme.cyan },
                            { a: "restart",  l: "🔄 ری‌استارت", c: Theme.amber },
                            { a: "shutdown", l: "⏻ خاموش",      c: Theme.red }
                        ]
                        delegate: Rectangle {
                            Layout.fillWidth: true
                            height: 50; radius: 12
                            color: pwMA.containsMouse
                                ? Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.30)
                                : Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.15)
                            border.color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.45)
                            border.width: 1
                            Behavior on color { ColorAnimation { duration: 130 } }
                            Text {
                                anchors.centerIn: parent
                                text: modelData.l
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: 13
                                font.weight: Font.Bold
                            }
                            MouseArea {
                                id: pwMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    root.submitted("power", { action: modelData.a });
                                    root.open = false;
                                    root.closed();
                                }
                            }
                        }
                    }
                }
            }

            // Footer buttons (hidden for power mode — buttons act inline)
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                visible: root.mode !== "power"
                GlassButton {
                    Layout.fillWidth: true
                    text: "انصراف"
                    variant: "ghost"
                    onClicked: { root.open = false; root.closed() }
                }
                GlassButton {
                    Layout.fillWidth: true
                    text: root.mode === "kick"        ? "🔌 پایان نشست"
                        : root.mode === "charge"      ? "✓ افزایش شارژ"
                        : root.mode === "pay-debt"    ? "💵 ثبت پرداخت"
                        : root.mode === "message"     ? "📨 ارسال"
                        : root.mode === "assign-user" ? "👤 ورود اجباری"
                        : root.mode === "network"     ? "✓ اعمال شبکه"
                        :                               "تأیید"
                    variant: root.mode === "kick" ? "danger" : "primary"
                    onClicked: root.confirmAction()
                }
            }
        }
    }

    function confirmAction() {
        if (root.mode === "message") {
            const text = msgArea.text.trim();
            if (!text) return;
            root.submitted("message", { text });
        } else if (root.mode === "charge") {
            // amount text comes back as toman string with grouping commas;
            // strip them, multiply by 10 to get rial (DB unit).
            const toman = Number(String(amountInput.text).replace(/,/g, "")) || 0;
            if (toman <= 0) return;
            root.submitted("charge", { amountRial: toman * 10, amountToman: toman });
        } else if (root.mode === "pay-debt") {
            const toman = Number(String(amountInput.text).replace(/,/g, "")) || 0;
            if (toman <= 0) return;
            root.submitted("pay-debt", { amountRial: toman * 10, amountToman: toman });
        } else if (root.mode === "kick") {
            root.submitted("kick", {});
        } else if (root.mode === "assign-user") {
            if (root.selectedUserId < 0) return;
            const u = root.users.find(function (x) { return x.id === root.selectedUserId });
            if (!u) return;
            root.submitted("assign-user", {
                userId: u.id,
                username: u.username,
                credits: Number(u.credits || 0)
            });
        } else if (root.mode === "network") {
            root.submitted("network", {
                modemId: root.selectedModemId,
                dnsId:   root.selectedDnsId
            });
        }
        root.open = false;
        root.closed();
    }
}
