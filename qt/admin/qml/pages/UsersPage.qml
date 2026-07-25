// UsersPage — full users table with create / edit / financial-ops modals.
//
// Server endpoints used:
//   GET  /api/users                    list
//   GET  /api/users/bad-payers         users with stale debt
//   POST /api/users                    create  (auto numeric username)
//   PUT  /api/users/:id                update
//   POST /api/users/:id/toggle         active flag
//   DELETE /api/users/:id              remove
//   POST /api/users/:id/charge|decharge|debt/add|debt/pay
//
// Layout adapts to window width — table columns shrink on narrow screens
// (some columns hide via the `compact` flag).
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    // ── State ─────────────────────────────────────────────────────────
    property var users: []
    property var badPayers: []
    property string search: ""
    property string tab: "all"          // all | bad
    property int    selectedUserId: -1

    readonly property var filtered: {
        const s = page.search.trim().toLowerCase();
        const src = page.tab === "bad" ? page.badPayers : page.users;
        if (!s) return src;
        return src.filter(u =>
            (u.username || "").toLowerCase().includes(s) ||
            (u.name || "").toLowerCase().includes(s) ||
            (u.family || "").toLowerCase().includes(s) ||
            (u.phone || "").includes(s)
        );
    }

    readonly property bool compact: page.width < Theme.bpLg

    Component.onCompleted: {
        Api.getUsers(); Api.getBadPayers();
        // dev shortcut: MUTEGAME_PAGE=users-create opens the create modal too
        if (typeof __startPage !== 'undefined' && __startPage === "users-create") {
            Qt.callLater(() => { formModal.mode = "create"; formModal.initial = {}; formModal.open = true });
        }
    }

    Connections {
        target: Api
        function onUsersDone(u)      { page.users = u }
        function onBadPayersDone(u)  { page.badPayers = u }
        function onUserMutationDone(ok, err, result) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getUsers(); Api.getBadPayers();
            // Show generated username when creating
            if (result && result.username && createdBanner)
                createdBanner.show(result.username, result.name + " " + (result.family || ""));
        }
    }

    BgEffects {}

    // ── Header + content ──────────────────────────────────────────────
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // Topbar
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Text {
                text: "کاربران"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Rectangle {
                radius: 999; height: 24
                implicitWidth: countTxt.implicitWidth + 18
                color: Qt.rgba(0.55, 0.36, 0.96, 0.12)
                border.color: Qt.rgba(0.55, 0.36, 0.96, 0.30); border.width: 1
                Text {
                    id: countTxt
                    anchors.centerIn: parent
                    text: page.users.length + " نفر"
                    color: Theme.violetSoft
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
            }

            Item { Layout.fillWidth: true }

            // Search
            GlassInput {
                id: searchInput
                Layout.preferredWidth: 280
                Layout.maximumWidth: 280
                visible: !page.compact || true   // always visible, but width auto
                placeholder: "🔍 جستجو در نام، نام خانوادگی، کد، تلفن…"
                text: page.search
                onTextChanged: page.search = text
            }

            GlassButton {
                text: "➕ کاربر جدید"
                iconText: ""
                onClicked: {
                    formModal.mode = "create";
                    formModal.initial = {};
                    formModal.open = true;
                }
            }
        }

        // Tabs
        Row {
            Layout.fillWidth: true
            spacing: 8

            Repeater {
                model: [
                    { key: "all", label: "همه کاربران", count: page.users.length, color: Theme.violet },
                    { key: "bad", label: "⚠️ بد حساب",   count: page.badPayers.length, color: Theme.red }
                ]
                delegate: Rectangle {
                    height: 36; radius: 18
                    width: lab.implicitWidth + 36
                    property bool active: page.tab === modelData.key
                    color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.15) : Theme.card
                    border.color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.35) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 180 } }

                    Row {
                        anchors.centerIn: parent
                        spacing: 8
                        layoutDirection: Qt.RightToLeft
                        Text {
                            id: lab
                            text: modelData.label
                            color: active ? Theme.text : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: modelData.count > 0
                            width: 22; height: 18; radius: 9
                            color: Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.20)
                            Text { anchors.centerIn: parent; text: modelData.count; color: modelData.color; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Bold }
                        }
                    }
                    MouseArea { anchors.fill: parent; onClicked: page.tab = modelData.key; cursorShape: Qt.PointingHandCursor }
                }
            }
        }

        // Table
        GlassCard {
            Layout.fillWidth: true
            Layout.fillHeight: true
            accent: page.tab === "bad" ? Theme.red : Theme.violet

            Column {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 0

                // Header row
                Rectangle {
                    width: parent.width
                    height: 36
                    color: "transparent"
                    Row {
                        anchors.fill: parent
                        anchors.rightMargin: 8
                        anchors.leftMargin: 8
                        layoutDirection: Qt.RightToLeft
                        ColHead { text: "کد + نام";    weight: 2.0 }
                        ColHead { text: "تلفن";          weight: 1.2; visible: !page.compact }
                        ColHead { text: "اعتبار";        weight: 1.4 }
                        ColHead { text: "بدهی";          weight: 1.0 }
                        ColHead { text: "لیمیت تایم";   weight: 0.8 }
                        ColHead { text: "کاربر هم‌زمان"; weight: 0.8; visible: !page.compact }
                        ColHead { text: "وضعیت";         weight: 0.8 }
                        ColHead { text: "عملیات";        weight: 1.6 }
                    }
                    // Bottom border
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                }

                // Empty state
                Text {
                    visible: page.filtered.length === 0
                    anchors.horizontalCenter: parent.horizontalCenter
                    topPadding: 60
                    text: page.tab === "bad" ? "هیچ کاربر بد حسابی پیدا نشد ✅" : "کاربری ثبت نشده — دکمه «کاربر جدید» را بزن"
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 13
                }

                // Rows
                ScrollView {
                    visible: page.filtered.length > 0
                    width: parent.width
                    height: parent.height - 36
                    clip: true

                    Column {
                        width: parent.width
                        spacing: 0
                        Repeater {
                            model: page.filtered
                            delegate: UserRow {
                                width: parent.width
                                user: modelData
                                compact: page.compact
                                onEdit:   { formModal.mode = "edit"; formModal.initial = modelData; formModal.open = true; }
                                onMoney:  { financeModal.user = modelData; financeModal.op = "charge"; financeModal.open = true; }
                                onToggle: Api.toggleUser(modelData.id)
                                onRemove: { confirmRemove.user = modelData; confirmRemove.open = true }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Modals ────────────────────────────────────────────────────────
    UserFormModal {
        id: formModal
        onSubmitted: (payload) => {
            if (mode === "create") Api.createUser(payload);
            else Api.updateUser(initial.id, payload);
        }
    }

    UserFinanceModal {
        id: financeModal
        onSubmitted: (op, rialAmount, description, paymentMethod) => {
            const id = financeModal.user.id;
            if (op === "charge")        Api.chargeUser(id, rialAmount, description, false, paymentMethod);
            else if (op === "free_charge")  Api.chargeUser(id, rialAmount, description, true);
            else if (op === "charge_debt")  { Api.addDebt(id, rialAmount, "شارژ بدهی: " + description);
                                              Api.chargeUser(id, rialAmount, "شارژ بدهی", true); }
            else if (op === "decharge") Api.dechargeUser(id, rialAmount, description);
            else if (op === "debt_add") Api.addDebt(id, rialAmount, description);
            else if (op === "debt_pay") Api.payDebt(id, rialAmount, description, paymentMethod);
        }
    }

    ConfirmDialog {
        id: confirmRemove
        property var user: ({})
        title: "حذف کاربر"
        body: "آیا از حذف کاربر «" + (user.username || "") + "» مطمئن هستید؟ این عمل قابل برگشت نیست."
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: Api.deleteUser(user.id)
    }

    // ── Toast notifications + created-user banner ────────────────────
    Toast { id: toast }

    CreatedUserBanner { id: createdBanner }

    // ── Inline column header ──────────────────────────────────────────
    component ColHead: Item {
        property string text: ""
        property real   weight: 1.0
        Layout.fillWidth: true
        height: parent ? parent.height : 36
        width: parent ? parent.width * (weight / 8.8) : 100   // approximate scaling
        Text {
            anchors.right: parent.right; anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            text: parent.text
            color: Theme.text3
            font.family: Theme.fontFamily
            font.pixelSize: 11
            font.weight: Font.Medium
            font.letterSpacing: 1
        }
    }
}
