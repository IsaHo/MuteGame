// UserFormModal — create/edit user dialog. Fields: name, family, phone,
// initial credits (toman, with 3-digit grouping + Enter chain), limit
// minutes, allowed seats, post-pay toggle. On Enter from the last field,
// `submitted(payload)` fires with a server-ready JSON object.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)  // dark, near-opaque so dialogs stand out on any desktop
    visible: open
    z: 1000

    property bool open: false
    property string mode: "create"          // create | edit
    property var initial: ({})              // existing user when editing

    signal closed()
    signal submitted(var payload)

    onOpenChanged: if (open) {
        // Hydrate fields
        nameInput.text       = initial.name        || "";
        familyInput.text     = initial.family      || "";
        phoneInput.text      = initial.phone       || "";
        creditsInput.text    = initial.credits ? Currency.grouped(String(Math.round(initial.credits / 10))) : "";
        seatsInput.text      = initial.allowed_seats ? String(initial.allowed_seats) : "1";
        postPay.checked      = !!initial.post_pay;
        limitTime.checked    = !!initial.limit_time;
        // Auto-focus the first field
        nameInput.forceActiveFocus();
    }

    MouseArea { anchors.fill: parent; onClicked: { root.open = false; root.closed() } }

    GlassCard {
        width: Math.min(parent.width - 40, 560)
        height: column.implicitHeight + 56
        anchors.centerIn: parent
        accent: Theme.cyan
        radius: 18
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: column
            anchors.fill: parent
            anchors.margins: 28
            spacing: 14

            Text {
                Layout.fillWidth: true
                text: root.mode === "create" ? "➕ کاربر جدید" : ("✏️ ویرایش — " + (root.initial.username || ""))
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 18
                font.weight: Font.Bold
                horizontalAlignment: Text.AlignRight
            }

            // Auto-username info banner (server generates 1000+ codes)
            Rectangle {
                visible: root.mode === "create"
                Layout.fillWidth: true
                Layout.preferredHeight: visible ? 56 : 0
                radius: 10
                color: Qt.rgba(0.06, 0.71, 0.83, 0.08)
                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.20); border.width: 1
                Column {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 2
                    Text { text: "🤖 کد و رمز خودکار"; color: Theme.cyanSoft; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; horizontalAlignment: Text.AlignRight; width: parent.width }
                    Text { text: "سیستم یک کد عددی از ۱۰۰۰ به بعد می‌دهد. رمز همان کد خواهد بود."; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; horizontalAlignment: Text.AlignRight; width: parent.width }
                }
            }

            // Name + Family (2 cols)
            GridLayout {
                Layout.fillWidth: true
                columns: 2
                rowSpacing: 12
                columnSpacing: 12

                GlassInput {
                    id: nameInput
                    Layout.fillWidth: true
                    label: "نام"
                    placeholder: "علی"
                    nextField: familyInput
                }
                GlassInput {
                    id: familyInput
                    Layout.fillWidth: true
                    label: "نام خانوادگی"
                    placeholder: "احمدی"
                    nextField: phoneInput
                }
                GlassInput {
                    id: phoneInput
                    Layout.fillWidth: true
                    label: "شماره تلفن"
                    placeholder: "09120000000"
                    icon: "📱"
                    nextField: creditsInput
                }
                GlassInput {
                    id: creditsInput
                    Layout.fillWidth: true
                    label: "اعتبار اولیه (تومان)"
                    placeholder: "100,000"
                    icon: "💴"
                    numeric: true
                    nextField: seatsInput
                }
                GlassInput {
                    id: seatsInput
                    Layout.fillWidth: true
                    label: "👥 تعداد کاربر مجاز هم‌زمان"
                    placeholder: "1"
                    numeric: true
                    onSubmitted: root.confirm()
                }
            }

            // Limit-time toggle — when ON, this user plays free (no credit
            // deduction, no time cap). The launcher shows "لیمیت تایم" instead
            // of a remaining-time counter.
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 56
                radius: 12
                color: limitTime.checked ? Qt.rgba(0.55, 0.36, 0.96, 0.10) : Theme.card
                border.color: limitTime.checked ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                border.width: 1
                Behavior on color { ColorAnimation { duration: 200 } }

                Row {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 12
                    layoutDirection: Qt.RightToLeft

                    Rectangle {
                        id: limitTime
                        property bool checked: false
                        anchors.verticalCenter: parent.verticalCenter
                        width: 46; height: 26; radius: 13
                        color: checked ? Theme.violet : Theme.border
                        Behavior on color { ColorAnimation { duration: 180 } }
                        Rectangle {
                            width: 22; height: 22; radius: 11
                            anchors.verticalCenter: parent.verticalCenter
                            x: parent.checked ? parent.width - width - 2 : 2
                            color: "white"
                            Behavior on x { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
                        }
                        MouseArea { anchors.fill: parent; onClicked: parent.checked = !parent.checked; cursorShape: Qt.PointingHandCursor }
                    }
                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 1
                        Text { text: "🚦 لیمیت تایم"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 13; font.weight: Font.Bold }
                        Text { text: "بازی نامحدود بدون شارژ — به‌جای تایمر متن «لیمیت تایم» روی کلاینت نشون داده می‌شه."; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    }
                }
            }

            // Post-pay toggle
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 56
                radius: 12
                color: postPay.checked ? Qt.rgba(0.96, 0.62, 0.04, 0.10) : Theme.card
                border.color: postPay.checked ? Qt.rgba(0.96, 0.62, 0.04, 0.35) : Theme.border
                border.width: 1
                Behavior on color { ColorAnimation { duration: 200 } }

                Row {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 12
                    layoutDirection: Qt.RightToLeft

                    Rectangle {
                        id: postPay
                        property bool checked: false
                        anchors.verticalCenter: parent.verticalCenter
                        width: 46; height: 26; radius: 13
                        color: checked ? Theme.amber : Theme.border
                        Behavior on color { ColorAnimation { duration: 180 } }
                        Rectangle {
                            width: 22; height: 22; radius: 11
                            anchors.verticalCenter: parent.verticalCenter
                            x: parent.checked ? parent.width - width - 2 : 2
                            color: "white"
                            Behavior on x { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
                        }
                        MouseArea { anchors.fill: parent; onClicked: parent.checked = !parent.checked; cursorShape: Qt.PointingHandCursor }
                    }
                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 1
                        Text { text: "💳 پس‌پرداخت"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 13; font.weight: Font.Bold }
                        Text { text: "کاربر می‌تواند با اعتبار منفی بازی کند؛ هزینه به بدهی اضافه می‌شود."; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    }
                }
            }

            // Footer
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                GlassButton { Layout.fillWidth: true; text: "انصراف"; variant: "ghost"; onClicked: { root.open = false; root.closed() } }
                GlassButton {
                    Layout.fillWidth: true
                    text: root.mode === "create" ? "✓ ساخت کاربر" : "✓ ذخیره"
                    onClicked: root.confirm()
                }
            }
        }
    }

    function confirm() {
        const payload = {
            name:          nameInput.text.trim(),
            family:        familyInput.text.trim(),
            phone:         phoneInput.text.trim(),
            allowed_seats: Math.max(1, Number(seatsInput.rawDigits) || 1),
            post_pay:      postPay.checked ? 1 : 0,
            limit_time:    limitTime.checked ? 1 : 0,
            // Keep limit_minutes column zeroed — the new limit_time toggle
            // supersedes it. (Existing rows in the DB are untouched.)
            limit_minutes: 0,
        };
        if (root.mode === "create") {
            payload.credits = Currency.tomanInputToRial(creditsInput.text);
        }
        root.submitted(payload);
        root.open = false;
        root.closed();
    }
}
