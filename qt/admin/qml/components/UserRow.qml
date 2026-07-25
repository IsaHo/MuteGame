// UserRow — one row in the users table. Hover-highlights, badges for
// active/post-pay, action buttons (money / edit / toggle / remove). The
// `compact` flag hides secondary columns on narrow windows.
import QtQuick
import "../theme"

Rectangle {
    id: row
    property var  user: ({})
    property bool compact: false

    height: 56
    color: hover.containsMouse ? Qt.rgba(0.55, 0.36, 0.96, 0.04) : "transparent"
    Behavior on color { ColorAnimation { duration: 150 } }
    HoverHandler { id: hover }

    signal edit()
    signal money()
    signal toggle()
    signal remove()

    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }

    Row {
        anchors.fill: parent
        anchors.rightMargin: 8
        anchors.leftMargin: 8
        layoutDirection: Qt.RightToLeft

        // ── Username + name ───────────────────────────────────────────
        Item {
            width: parent.width * 2.0 / 8.8
            height: parent.height
            Column {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                spacing: 1
                Text {
                    text: user.username || "—"
                    color: Theme.cyanSoft
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 14
                    font.weight: Font.Bold
                    horizontalAlignment: Text.AlignRight
                }
                Text {
                    text: ((user.name || "") + " " + (user.family || "")).trim() || "—"
                    color: Theme.text2
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    horizontalAlignment: Text.AlignRight
                }
            }
        }

        // ── Phone ─────────────────────────────────────────────────────
        Item {
            visible: !row.compact
            width: visible ? parent.width * 1.2 / 8.8 : 0
            height: parent.height
            Text {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: user.phone || "—"
                color: Theme.text3
                font.family: Theme.fontFamilyEn
                font.pixelSize: 12
                LayoutMirroring.enabled: false   // phone numbers always LTR
            }
        }

        // ── Credit ────────────────────────────────────────────────────
        Item {
            width: parent.width * 1.4 / 8.8
            height: parent.height
            Text {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: Currency.format(user.credits || 0)
                color: (user.credits || 0) > 0 ? Theme.green : Theme.text3
                font.family: Theme.fontFamilyEn
                font.pixelSize: 13
                font.weight: Font.Bold
            }
        }

        // ── Debt ──────────────────────────────────────────────────────
        Item {
            width: parent.width * 1.0 / 8.8
            height: parent.height
            Text {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: (user.debt || 0) > 0 ? Currency.format(user.debt) : "—"
                color: (user.debt || 0) > 0 ? Theme.red : Theme.text3
                font.family: Theme.fontFamilyEn
                font.pixelSize: 13
                font.weight: Font.Bold
            }
        }

        // ── Limit-time toggle (no countdown — free unlimited play) ────
        // Always visible — the badge is small and is critical info for the
        // operator at a glance, so we don't drop it on compact layouts.
        Item {
            width: parent.width * 0.8 / 8.8
            height: parent.height
            Rectangle {
                visible: !!user.limit_time
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                width: lt.implicitWidth + 18; height: 22; radius: 11
                color: Qt.rgba(0.55, 0.36, 0.96, 0.20)
                border.color: Qt.rgba(0.55, 0.36, 0.96, 0.45); border.width: 1
                Text {
                    id: lt
                    anchors.centerIn: parent
                    text: "🚦 لیمیت تایم"
                    color: Theme.violetSoft
                    font.family: Theme.fontFamily
                    font.pixelSize: 10
                    font.weight: Font.Bold
                }
            }
            Text {
                visible: !user.limit_time
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: "—"
                color: Theme.text3
                font.family: Theme.fontFamilyEn
                font.pixelSize: 12
            }
        }

        // ── Allowed seats ─────────────────────────────────────────────
        Item {
            visible: !row.compact
            width: visible ? parent.width * 0.8 / 8.8 : 0
            height: parent.height
            Text {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                text: (user.allowed_seats || 1) + ""
                color: (user.allowed_seats || 1) > 1 ? Theme.cyanSoft : Theme.text3
                font.family: Theme.fontFamilyEn
                font.pixelSize: 12
                font.weight: (user.allowed_seats || 1) > 1 ? Font.Bold : Font.Normal
            }
        }

        // ── Status badges ─────────────────────────────────────────────
        Item {
            width: parent.width * 0.8 / 8.8
            height: parent.height
            Row {
                anchors.right: parent.right; anchors.rightMargin: 8
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                Rectangle {
                    width: 50; height: 20; radius: 10
                    color: user.is_active ? Qt.rgba(0.06, 0.73, 0.51, 0.18) : Qt.rgba(0.42, 0.44, 0.56, 0.15)
                    border.color: user.is_active ? Qt.rgba(0.06, 0.73, 0.51, 0.35) : Qt.rgba(0.42, 0.44, 0.56, 0.30)
                    border.width: 1
                    Text {
                        anchors.centerIn: parent
                        text: user.is_active ? "● فعال" : "○ غیرفعال"
                        color: user.is_active ? Theme.green : Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 9
                        font.weight: Font.Bold
                    }
                }
                Rectangle {
                    visible: !!user.post_pay
                    width: 22; height: 20; radius: 10
                    color: Qt.rgba(0.96, 0.62, 0.04, 0.18)
                    border.color: Qt.rgba(0.96, 0.62, 0.04, 0.35); border.width: 1
                    Text { anchors.centerIn: parent; text: "💳"; font.pixelSize: 10 }
                }
            }
        }

        // ── Action buttons ────────────────────────────────────────────
        Item {
            width: parent.width * 1.6 / 8.8
            height: parent.height
            Row {
                anchors.right: parent.right; anchors.rightMargin: 4
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                layoutDirection: Qt.RightToLeft

                IconBtn { icon: "💰"; tooltip: "عملیات مالی"; tint: Theme.amber;     onClicked: row.money() }
                IconBtn { icon: "✏️"; tooltip: "ویرایش";        tint: Theme.cyanSoft; onClicked: row.edit() }
                // Toggle (lock/unlock) removed by request — operators just
                // edit or delete now. Lock added unnecessary state to the
                // workflow that the cafe manager didn't actually use.
                IconBtn { icon: "🗑"; tooltip: "حذف";              tint: Theme.red;       onClicked: row.remove() }
            }
        }
    }

    component IconBtn: Rectangle {
        property string icon: ""
        property string tooltip: ""
        property color  tint: Theme.text2
        signal clicked()
        width: 30; height: 30; radius: 8
        color: bMouse.containsMouse ? Qt.rgba(tint.r, tint.g, tint.b, 0.18) : Qt.rgba(tint.r, tint.g, tint.b, 0.10)
        border.color: Qt.rgba(tint.r, tint.g, tint.b, 0.25); border.width: 1
        Behavior on color { ColorAnimation { duration: 130 } }
        Text { anchors.centerIn: parent; text: icon; font.pixelSize: 13 }
        MouseArea {
            id: bMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: parent.clicked()
        }
    }
}
