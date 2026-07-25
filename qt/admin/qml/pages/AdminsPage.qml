// AdminsPage — full parity with React build:
//   • three tabs: list / audit / me
//   • CRUD with checkbox-grid permission picker (8 groups × 2-3 perms)
//   • audit log with admin/entity/action filters
//   • self-service password change
//
// Permission catalog mirrors server/audit.js PERMS — keep in sync.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    // ── State ─────────────────────────────────────────────────────
    property var    admins: []
    property string search: ""
    property string tab: "list"   // list | audit | me

    // Audit log
    property var    auditRows:   []
    property int    auditTotal:  0
    property string filterAdmin:  ""
    property string filterEntity: ""
    property string filterAction: ""

    // Permission catalog (kept in sync with server PERMS + React PERM_GROUPS)
    readonly property var permGroups: [
        { label: "👥 کاربران",    perms: ["users.view", "users.edit", "users.financial"] },
        { label: "🖥 کلاینت‌ها",  perms: ["clients.view", "clients.control"] },
        { label: "🛒 شاپ",        perms: ["shop.view", "shop.edit", "shop.pos"] },
        { label: "🎮 بازی‌ها",    perms: ["games.view", "games.edit"] },
        { label: "🌐 شبکه",       perms: ["network.view", "network.edit"] },
        { label: "⚙️ تنظیمات",    perms: ["settings.view", "settings.edit"] },
        { label: "👑 ادمین‌ها",   perms: ["admins.view", "admins.edit"] },
        { label: "📈 گزارشات",    perms: ["reports.view", "audit.view"] },
        { label: "🏧 شیفت",       perms: ["shifts.view", "shifts.manage"] }
    ]
    readonly property var permLabels: ({
        "users.view":      "مشاهده کاربران",
        "users.edit":      "افزودن/ویرایش کاربر",
        "users.financial": "عملیات مالی کاربر",
        "clients.view":    "مشاهده کلاینت‌ها",
        "clients.control": "کنترل کلاینت (پیام/اخراج/افزایش)",
        "shop.view":       "مشاهده شاپ",
        "shop.edit":       "مدیریت آیتم‌های شاپ",
        "shop.pos":        "فروش از POS",
        "games.view":      "مشاهده بازی‌ها",
        "games.edit":      "مدیریت بازی‌ها",
        "network.view":    "مشاهده شبکه",
        "network.edit":    "مدیریت DNS/مودم",
        "settings.view":   "مشاهده تنظیمات",
        "settings.edit":   "ویرایش تنظیمات",
        "admins.view":     "مشاهده ادمین‌ها",
        "admins.edit":     "مدیریت ادمین‌ها",
        "reports.view":    "مشاهده گزارش‌ها",
        "audit.view":      "مشاهده لاگ عملیات",
        "shifts.view":     "مشاهده شیفت‌ها",
        "shifts.manage":   "مدیریت شیفت (باز/بسته)"
    })

    readonly property var filteredAdmins: {
        const s = page.search.trim().toLowerCase();
        if (!s) return admins;
        return admins.filter(a => (a.username || "").toLowerCase().includes(s)
                              || (a.display_name || "").toLowerCase().includes(s));
    }
    readonly property int superCount:   admins.filter(a => a.role === "super").length
    readonly property int managerCount: admins.filter(a => a.role === "manager").length
    readonly property int cashierCount: admins.filter(a => a.role === "cashier").length

    function reloadAudit() {
        Api.getAuditLogFiltered(200, 0, page.filterAdmin, page.filterEntity, page.filterAction);
    }

    Component.onCompleted: Api.getAdmins()

    onTabChanged: { if (tab === "audit") reloadAudit() }
    onFilterAdminChanged:  if (tab === "audit") reloadAudit()
    onFilterEntityChanged: if (tab === "audit") reloadAudit()
    onFilterActionChanged: if (tab === "audit") reloadAudit()

    Connections {
        target: Api
        function onAdminsDone(rows) { page.admins = rows }
        function onAdminMutationDone(ok, err) {
            if (!ok) { toast.show("خطا: " + (err || "ناموفق"), "error"); return }
            Api.getAdmins();
            toast.show("ذخیره شد ✅", "success");
        }
        function onAuditLogDone(rows, total) {
            page.auditRows  = rows;
            page.auditTotal = total;
        }
        function onPasswordChangeDone(ok, err) {
            if (ok) {
                toast.show("رمز عبور تغییر کرد ✅", "success");
                meCurrent.text = ""; meNew.text = ""; meConfirm.text = "";
            } else {
                toast.show("خطا: " + (err || "ناموفق"), "error");
            }
        }
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // ── Topbar ────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Text { text: "ادمین‌ها"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 24; font.weight: Font.Bold }
            Text { text: "  ·  مدیریت دسترسی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 13 }
            Item { Layout.fillWidth: true }
            GlassInput {
                visible: page.tab === "list"
                Layout.preferredWidth: 240
                placeholder: "🔍 جستجو…"
                text: page.search
                onTextChanged: page.search = text
            }
            GlassButton {
                visible: page.tab === "list"
                text: "➕ ادمین جدید"
                variant: "primary"
                onClicked: { adminForm.beginCreate(); adminForm.open = true }
            }
        }

        // ── Tabs ──────────────────────────────────────────────────
        Row {
            Layout.fillWidth: true
            spacing: 8
            Repeater {
                model: [
                    { key: "list",  label: "👥 لیست",       count: page.admins.length, color: Theme.cyan   },
                    { key: "audit", label: "📋 لاگ عملیات", count: page.auditTotal,    color: Theme.violet },
                    { key: "me",    label: "🔐 رمز خودم",   count: 0,                  color: Theme.amber  }
                ]
                delegate: Rectangle {
                    height: 36; radius: 18
                    width: tlab.implicitWidth + 36 + (modelData.count > 0 ? 28 : 0)
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
                            id: tlab
                            text: modelData.label
                            color: parent.parent.active ? Theme.text : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Rectangle {
                            visible: modelData.count > 0
                            anchors.verticalCenter: parent.verticalCenter
                            width: cnT.implicitWidth + 14; height: 18; radius: 9
                            color: Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.20)
                            Text { id: cnT; anchors.centerIn: parent; text: modelData.count; color: modelData.color; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Bold }
                        }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.tab = modelData.key }
                }
            }
        }

        // ── Stat pills (only on list tab) ────────────────────────
        Row {
            visible: page.tab === "list"
            Layout.fillWidth: true
            spacing: 8
            Repeater {
                model: [
                    { l: "همه",    n: page.admins.length, c: Theme.cyan   },
                    { l: "ارشد",   n: page.superCount,    c: Theme.amber  },
                    { l: "مدیر",   n: page.managerCount,  c: Theme.violet },
                    { l: "صندوق",  n: page.cashierCount,  c: Theme.green  }
                ]
                delegate: Rectangle {
                    height: 32; radius: 16
                    width: pll.implicitWidth + cnTT.implicitWidth + 50
                    color: Theme.card
                    border.color: Theme.border; border.width: 1
                    Row {
                        anchors.centerIn: parent; spacing: 8; layoutDirection: Qt.RightToLeft
                        Text { id: pll; text: modelData.l; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                        Rectangle {
                            width: cnTT.implicitWidth + 14; height: 20; radius: 10
                            color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.20)
                            anchors.verticalCenter: parent.verticalCenter
                            Text { id: cnTT; anchors.centerIn: parent; text: modelData.n; color: modelData.c; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Black }
                        }
                    }
                }
            }
        }

        // ── Content stack ────────────────────────────────────────
        StackLayout {
            id: stack
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: page.tab === "list" ? 0 : page.tab === "audit" ? 1 : 2

            // ─── (0) LIST ──────────────────────────────────────
            Item {
                // Empty state
                Column {
                    visible: page.filteredAdmins.length === 0
                    anchors.top: parent.top
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 14
                    topPadding: 80
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 96; height: 96; radius: 24
                        color: Qt.rgba(0.96, 0.62, 0.04, 0.10)
                        border.color: Qt.rgba(0.96, 0.62, 0.04, 0.25); border.width: 1
                        Text { anchors.centerIn: parent; text: "👑"; font.pixelSize: 48 }
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: page.admins.length === 0 ? "هنوز ادمینی نیست (یا دسترسی نداری)" : "نتیجه‌ای پیدا نشد"
                        color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 14
                    }
                }
                ListView {
                    visible: page.filteredAdmins.length > 0
                    anchors.fill: parent
                    spacing: 8
                    clip: true
                    model: page.filteredAdmins
                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 70
                        radius: 12
                        color: aRowMA.containsMouse ? Theme.cardHover : Theme.card
                        border.color: modelData.role === "super" ? Theme.amber : Theme.border
                        border.width: modelData.role === "super" ? 2 : 1
                        Behavior on color { ColorAnimation { duration: 130 } }

                        Row {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 14
                            layoutDirection: Qt.RightToLeft

                            Rectangle {
                                width: 44; height: 44; radius: 22
                                anchors.verticalCenter: parent.verticalCenter
                                gradient: Gradient {
                                    orientation: Gradient.Vertical
                                    GradientStop { position: 0; color: modelData.role === "super" ? Theme.amber : modelData.role === "cashier" ? Theme.green : Theme.cyan }
                                    GradientStop { position: 1; color: modelData.role === "super" ? Theme.red   : modelData.role === "cashier" ? Theme.cyan  : Theme.violet }
                                }
                                Text {
                                    anchors.centerIn: parent
                                    text: ((modelData.username || "?").charAt(0)).toUpperCase()
                                    color: "white"
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 18
                                    font.weight: Font.Black
                                }
                            }
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 3
                                width: 220
                                Row {
                                    spacing: 8
                                    layoutDirection: Qt.RightToLeft
                                    Text { text: modelData.username || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                                    Rectangle {
                                        visible: modelData.role === "super"
                                        height: 18; radius: 9; width: rT.implicitWidth + 12
                                        color: Qt.rgba(0.96, 0.62, 0.04, 0.20)
                                        border.color: Qt.rgba(0.96, 0.62, 0.04, 0.40); border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { id: rT; anchors.centerIn: parent; text: "👑 ارشد"; color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 9; font.weight: Font.Bold }
                                    }
                                }
                                Text {
                                    text: (modelData.display_name || "")
                                        + (modelData.last_login ? "  ·  آخرین ورود: " + Jalali.dateTimeFromIso(modelData.last_login) : "")
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 10
                                    width: 280
                                    elide: Text.ElideRight
                                }
                            }

                            Item { width: 16; height: 1 }

                            // Permissions summary
                            Rectangle {
                                height: 28; radius: 14
                                width: pSum.implicitWidth + 18
                                color: Theme.bg2
                                border.color: Theme.border; border.width: 1
                                anchors.verticalCenter: parent.verticalCenter
                                Text {
                                    id: pSum; anchors.centerIn: parent
                                    text: {
                                        if (modelData.role === "super" || modelData.permissions === "*") return "✅ همه";
                                        const arr = (modelData.permissions || "").split(",").filter(x => x.length > 0);
                                        return arr.length + " مورد";
                                    }
                                    color: Theme.text2
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 10
                                    font.weight: Font.Bold
                                }
                            }

                            // Role pill
                            Rectangle {
                                height: 28; radius: 14
                                width: rolT.implicitWidth + 18
                                color: Theme.bg2
                                border.color: Theme.border; border.width: 1
                                anchors.verticalCenter: parent.verticalCenter
                                Text {
                                    id: rolT; anchors.centerIn: parent
                                    text: modelData.role || "manager"
                                    color: Theme.text2
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 11
                                    font.weight: Font.Bold
                                }
                            }

                            // Active toggle
                            Rectangle {
                                height: 28; radius: 14
                                width: actT.implicitWidth + 18
                                anchors.verticalCenter: parent.verticalCenter
                                property bool on: modelData.is_active === 1
                                color: on ? Qt.rgba(0.06, 0.73, 0.51, 0.18) : Qt.rgba(0.94, 0.27, 0.27, 0.15)
                                border.color: on ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Qt.rgba(0.94, 0.27, 0.27, 0.35); border.width: 1
                                Text { id: actT; anchors.centerIn: parent; text: parent.on ? "✓ فعال" : "✕ غیرفعال"; color: parent.on ? Theme.green : Theme.red; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: Api.updateAdmin(modelData.id, { is_active: parent.on ? 0 : 1 }) }
                            }

                            // Edit + Delete
                            Row {
                                spacing: 6
                                anchors.verticalCenter: parent.verticalCenter
                                Rectangle {
                                    width: 32; height: 32; radius: 8
                                    color: edAMA.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : "transparent"
                                    border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                                    Text { anchors.centerIn: parent; text: "✏️"; font.pixelSize: 13 }
                                    MouseArea { id: edAMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { adminForm.beginEdit(modelData); adminForm.open = true } }
                                }
                                Rectangle {
                                    width: 32; height: 32; radius: 8
                                    color: rmAMA.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.20) : "transparent"
                                    border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                                    Text { anchors.centerIn: parent; text: "🗑"; font.pixelSize: 12 }
                                    MouseArea { id: rmAMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { confirmRm.target = modelData; confirmRm.open = true } }
                                }
                            }
                        }
                        HoverHandler { id: aRowMA }
                    }
                }
            }

            // ─── (1) AUDIT LOG ─────────────────────────────────
            Item {
                ColumnLayout {
                    anchors.fill: parent
                    spacing: 12

                    // Filters
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        GlassInput { Layout.preferredWidth: 180; placeholder: "نام ادمین"; text: page.filterAdmin; onTextChanged: page.filterAdmin = text }
                        GlassInput { Layout.preferredWidth: 200; placeholder: "entity (user/game/...)"; text: page.filterEntity; onTextChanged: page.filterEntity = text }
                        GlassInput { Layout.preferredWidth: 200; placeholder: "action prefix (admin./user./...)"; text: page.filterAction; onTextChanged: page.filterAction = text }
                        Item { Layout.fillWidth: true }
                        Text {
                            text: page.auditTotal.toLocaleString(Qt.locale("en_US"), 'f', 0) + " رکورد"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            Layout.alignment: Qt.AlignVCenter
                        }
                        GlassButton { text: "🔄 بازخوانی"; variant: "ghost"; onClicked: page.reloadAudit() }
                    }

                    // Table
                    GlassCard {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        accent: Theme.violet
                        Column {
                            anchors.fill: parent
                            anchors.margins: 14
                            spacing: 0

                            // Header row
                            Rectangle {
                                width: parent.width
                                height: 32
                                color: "transparent"
                                Row {
                                    anchors.fill: parent
                                    anchors.rightMargin: 8
                                    anchors.leftMargin: 8
                                    layoutDirection: Qt.RightToLeft
                                    spacing: 8
                                    Text { text: "زمان";    color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 130; anchors.verticalCenter: parent.verticalCenter }
                                    Text { text: "ادمین";  color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 100; anchors.verticalCenter: parent.verticalCenter }
                                    Text { text: "IP";      color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 110; anchors.verticalCenter: parent.verticalCenter }
                                    Text { text: "عمل";    color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 160; anchors.verticalCenter: parent.verticalCenter }
                                    Text { text: "روی";    color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 130; anchors.verticalCenter: parent.verticalCenter }
                                    Text { text: "جزئیات"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                            }

                            // Empty state
                            Item {
                                width: parent.width
                                height: 120
                                visible: page.auditRows.length === 0
                                Text {
                                    anchors.centerIn: parent
                                    text: "چیزی ثبت نشده"
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 13
                                }
                            }

                            // Rows
                            ListView {
                                visible: page.auditRows.length > 0
                                width: parent.width
                                height: parent.height - 32
                                clip: true
                                model: page.auditRows
                                spacing: 0
                                delegate: Rectangle {
                                    width: ListView.view.width
                                    height: 36
                                    color: index % 2 === 0 ? "transparent" : Qt.rgba(1, 1, 1, 0.015)
                                    Row {
                                        anchors.fill: parent
                                        anchors.rightMargin: 8
                                        anchors.leftMargin: 8
                                        layoutDirection: Qt.RightToLeft
                                        spacing: 8
                                        Text { text: Jalali.dateTimeFromIso(modelData.created_at || ""); color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; width: 130; elide: Text.ElideRight; anchors.verticalCenter: parent.verticalCenter }
                                        Text { text: modelData.admin_username || "—"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; width: 100; elide: Text.ElideRight; anchors.verticalCenter: parent.verticalCenter }
                                        Text { text: modelData.admin_ip || "—"; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 10; width: 110; elide: Text.ElideRight; anchors.verticalCenter: parent.verticalCenter }
                                        Rectangle {
                                            width: 150; height: 22; radius: 11
                                            color: Qt.rgba(0.55, 0.36, 0.96, 0.15)
                                            border.color: Qt.rgba(0.55, 0.36, 0.96, 0.30); border.width: 1
                                            anchors.verticalCenter: parent.verticalCenter
                                            Text { anchors.centerIn: parent; text: modelData.action || "—"; color: Theme.violetSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Bold; elide: Text.ElideRight; width: parent.width - 12 }
                                        }
                                        Text {
                                            text: (modelData.entity || "—") + (modelData.entity_id ? " #" + modelData.entity_id : "")
                                            color: Theme.text2
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 11
                                            width: 130
                                            elide: Text.ElideRight
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        Text {
                                            text: modelData.details || ""
                                            color: Theme.text3
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 10
                                            width: parent.width - 130 - 100 - 110 - 150 - 130 - 48
                                            elide: Text.ElideRight
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                    }
                                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Qt.rgba(1, 1, 1, 0.025) }
                                }
                            }
                        }
                    }
                }
            }

            // ─── (2) ME / PASSWORD ────────────────────────────
            Item {
                Item {
                    width: 480
                    height: meCol.implicitHeight + 40
                    anchors.top: parent.top
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.topMargin: 40

                    Rectangle {
                        anchors.fill: parent
                        radius: 16
                        color: Theme.card
                        border.color: Theme.border2; border.width: 1
                    }

                    ColumnLayout {
                        id: meCol
                        anchors.fill: parent
                        anchors.margins: 24
                        spacing: 14

                        Row {
                            spacing: 8
                            Layout.fillWidth: true
                            layoutDirection: Qt.RightToLeft
                            Text { text: "🔐"; font.pixelSize: 22 }
                            Text { text: "تغییر رمز عبور خودم"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                        }

                        Column { Layout.fillWidth: true; spacing: 4
                            Text { text: "رمز فعلی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: meCurrent; width: parent.width; placeholder: "••••"; password: true }
                        }
                        Column { Layout.fillWidth: true; spacing: 4
                            Text { text: "رمز جدید"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: meNew; width: parent.width; placeholder: "حداقل ۴ کاراکتر"; password: true }
                        }
                        Column { Layout.fillWidth: true; spacing: 4
                            Text { text: "تکرار رمز جدید"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: meConfirm; width: parent.width; placeholder: "تکرار"; password: true }
                        }

                        GlassButton {
                            Layout.fillWidth: true
                            text: "✅ تغییر رمز"
                            variant: "primary"
                            onClicked: {
                                if (!meCurrent.text || !meNew.text)        { toast.show("همه فیلدها لازم است", "error"); return }
                                if (meNew.text.length < 4)                  { toast.show("رمز جدید حداقل ۴ کاراکتر", "error"); return }
                                if (meNew.text !== meConfirm.text)          { toast.show("رمز جدید با تکرار مطابقت ندارد", "error"); return }
                                Api.changeMyPassword(meCurrent.text, meNew.text);
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Admin form modal (with checkbox-grid permission picker) ───
    Rectangle {
        id: adminForm
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        visible: open
        z: 1500
        property bool open: false
        property int  editId: -1
        property string title: ""
        property string role: "manager"
        property var    perms: []   // selected permission codes

        function beginCreate() {
            editId = -1; title = "➕ ادمین جدید"; role = "manager";
            uI.text = ""; pwI.text = ""; dnI.text = "";
            perms = [];
        }
        function beginEdit(a) {
            editId = a.id; title = "✏️ ویرایش " + (a.username || "ادمین");
            role = a.role || "manager";
            uI.text = a.username || "";
            pwI.text = "";
            dnI.text = a.display_name || "";
            if (a.role === "super" || a.permissions === "*" || !a.permissions) perms = [];
            else perms = String(a.permissions).split(",").filter(x => x.length > 0);
        }
        function togglePerm(p) {
            const i = perms.indexOf(p);
            if (i < 0) perms = perms.concat([p]);
            else       perms = perms.filter(x => x !== p);
        }
        function selectAll() {
            const all = [];
            for (const g of page.permGroups) for (const p of g.perms) all.push(p);
            perms = all;
        }
        function selectNone() { perms = [] }

        MouseArea { anchors.fill: parent; onClicked: adminForm.open = false }
        Rectangle {
            width: 720
            height: Math.min(parent.height - 60, fCol.implicitHeight + 40)
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }

            ColumnLayout {
                id: fCol
                anchors.fill: parent
                anchors.margins: 22
                spacing: 12

                Text { text: adminForm.title; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold }

                GridLayout {
                    Layout.fillWidth: true
                    columns: 2
                    columnSpacing: 12
                    rowSpacing: 10

                    Column { Layout.fillWidth: true; spacing: 4
                        Text { text: "نام کاربری"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: uI; width: parent.width; placeholder: "admin2"; enabled: adminForm.editId < 0 }
                    }
                    Column { Layout.fillWidth: true; spacing: 4
                        Text { text: "نام نمایشی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: dnI; width: parent.width; placeholder: "علی محمدی" }
                    }
                    Column { Layout.fillWidth: true; Layout.columnSpan: 2; spacing: 4
                        Text { text: adminForm.editId >= 0 ? "رمز جدید (خالی = بدون تغییر)" : "رمز عبور"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: pwI; width: parent.width; placeholder: "••••"; password: true }
                    }
                }

                // Role picker (super / manager / cashier)
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "نقش"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    Row {
                        width: parent.width
                        spacing: 8
                        Repeater {
                            model: [
                                { k: "super",   l: "👑 super-admin", d: "دسترسی کامل به همه‌چیز" },
                                { k: "manager", l: "🛠 manager",     d: "دسترسی‌های انتخابی" },
                                { k: "cashier", l: "💵 cashier",     d: "فقط فروش/POS" }
                            ]
                            delegate: Rectangle {
                                width: (parent.width - parent.spacing * 2) / 3
                                height: 60; radius: 12
                                property bool active: adminForm.role === modelData.k
                                color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.20) : Theme.card
                                border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                                border.width: 1
                                Behavior on color { ColorAnimation { duration: 130 } }
                                Column {
                                    anchors.centerIn: parent
                                    spacing: 4
                                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.l; color: parent.parent.active ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.d; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 9 }
                                }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: adminForm.role = modelData.k }
                            }
                        }
                    }
                }

                // Permission grid
                Column {
                    Layout.fillWidth: true
                    spacing: 6
                    visible: adminForm.role !== "super"

                    Row {
                        width: parent.width
                        layoutDirection: Qt.RightToLeft
                        spacing: 8
                        Text { text: "دسترسی‌ها"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        Item { width: parent.width - selAll.width - selNone.width - lblW.width - 24; height: 1 }
                        Rectangle {
                            id: selAll
                            width: 70; height: 22; radius: 11
                            color: selAllMA.containsMouse ? Qt.rgba(0.06, 0.73, 0.51, 0.25) : Qt.rgba(0.06, 0.73, 0.51, 0.15)
                            border.color: Qt.rgba(0.06, 0.73, 0.51, 0.40); border.width: 1
                            Text { anchors.centerIn: parent; text: "همه"; color: Theme.green; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                            MouseArea { id: selAllMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: adminForm.selectAll() }
                        }
                        Rectangle {
                            id: selNone
                            width: 70; height: 22; radius: 11
                            color: selNoneMA.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.25) : Qt.rgba(0.94, 0.27, 0.27, 0.15)
                            border.color: Qt.rgba(0.94, 0.27, 0.27, 0.35); border.width: 1
                            Text { anchors.centerIn: parent; text: "هیچ"; color: Theme.red; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                            MouseArea { id: selNoneMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: adminForm.selectNone() }
                        }
                        Text { id: lblW; text: adminForm.perms.length + " از " + 18; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; anchors.verticalCenter: parent.verticalCenter }
                    }

                    Rectangle {
                        width: parent.width
                        height: Math.min(280, gridFlow.implicitHeight + 24)
                        radius: 12
                        color: Qt.rgba(1, 1, 1, 0.02)
                        border.color: Theme.border; border.width: 1

                        Flickable {
                            anchors.fill: parent
                            anchors.margins: 12
                            contentHeight: gridFlow.implicitHeight
                            clip: true

                            GridLayout {
                                id: gridFlow
                                width: parent.width
                                columns: 2
                                columnSpacing: 18
                                rowSpacing: 12

                                Repeater {
                                    model: page.permGroups
                                    delegate: ColumnLayout {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignTop
                                        Layout.minimumWidth: 280
                                        spacing: 4

                                        Text {
                                            Layout.fillWidth: true
                                            text: modelData.label
                                            color: Theme.text2
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 12
                                            font.weight: Font.Bold
                                            horizontalAlignment: Text.AlignRight
                                        }
                                        Repeater {
                                            model: modelData.perms
                                            delegate: Item {
                                                Layout.fillWidth: true
                                                Layout.preferredHeight: 26
                                                Row {
                                                    anchors.fill: parent
                                                    spacing: 8
                                                    layoutDirection: Qt.RightToLeft
                                                    Rectangle {
                                                        width: 18; height: 18; radius: 4
                                                        anchors.verticalCenter: parent.verticalCenter
                                                        property bool checked: adminForm.perms.indexOf(modelData) >= 0
                                                        color: checked ? Theme.violet : Qt.rgba(1, 1, 1, 0.04)
                                                        border.color: checked ? Theme.violetSoft : Theme.border; border.width: 1
                                                        Text { anchors.centerIn: parent; visible: parent.checked; text: "✓"; color: "white"; font.pixelSize: 12; font.weight: Font.Black }
                                                    }
                                                    Text {
                                                        text: page.permLabels[modelData] || modelData
                                                        color: Theme.text
                                                        font.family: Theme.fontFamily
                                                        font.pixelSize: 11
                                                        anchors.verticalCenter: parent.verticalCenter
                                                    }
                                                    Text {
                                                        text: modelData
                                                        color: Theme.text3
                                                        font.family: Theme.fontFamilyEn
                                                        font.pixelSize: 9
                                                        anchors.verticalCenter: parent.verticalCenter
                                                    }
                                                }
                                                MouseArea {
                                                    anchors.fill: parent
                                                    cursorShape: Qt.PointingHandCursor
                                                    onClicked: adminForm.togglePerm(modelData)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Hint when role is super
                Text {
                    visible: adminForm.role === "super"
                    Layout.fillWidth: true
                    text: "👑 super-admin خودکار همه دسترسی‌ها رو می‌گیره — نیازی به انتخاب نیست."
                    color: Theme.amber
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    wrapMode: Text.WordWrap
                }

                // Footer buttons
                RowLayout { Layout.fillWidth: true; spacing: 10
                    GlassButton { text: "انصراف"; variant: "ghost"; onClicked: adminForm.open = false }
                    Item { Layout.fillWidth: true }
                    GlassButton {
                        text: adminForm.editId >= 0 ? "✅ ذخیره" : "✅ ثبت"
                        variant: "primary"
                        onClicked: {
                            if (!uI.text) { toast.show("نام کاربری الزامی است", "error"); return }
                            if (adminForm.editId < 0 && !pwI.text) { toast.show("رمز عبور الزامی است", "error"); return }
                            const data = {
                                username:     uI.text,
                                display_name: dnI.text,
                                role:         adminForm.role,
                                permissions:  adminForm.role === "super" ? "*" : adminForm.perms.join(",")
                            };
                            if (pwI.text) data.password = pwI.text;
                            if (adminForm.editId >= 0) Api.updateAdmin(adminForm.editId, data);
                            else                       Api.createAdmin(data);
                            adminForm.open = false;
                        }
                    }
                }
            }
        }
    }

    ConfirmDialog {
        id: confirmRm
        property var target: ({})
        title: "حذف ادمین"
        body: "ادمین «" + (target.username || "") + "» حذف بشه؟ این عمل غیرقابل بازگشت است."
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: Api.deleteAdmin(target.id)
    }

    Toast { id: toast }
}
