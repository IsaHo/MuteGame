// PcContextMenu — right-click popover for a single PC.
// Spawns at the click position and lists every supported per-PC action.
// Closes on outside-click or when an item is picked.
import QtQuick
import "../theme"

Item {
    id: root
    anchors.fill: parent
    visible: open
    z: 900

    property bool   open: false
    property real   px: 0
    property real   py: 0
    property string socketId: ""
    property string computerName: ""
    property string username: ""

    signal pick(string action)

    // Click-away
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onPressed: { root.open = false }
        z: 1
    }

    // Menu — clamped inside the parent so it's never partially off-screen
    Rectangle {
        z: 2
        x: Math.min(root.px, root.width - width - 10)
        y: Math.min(root.py, root.height - height - 10)
        width: 250
        height: col.implicitHeight + 16
        radius: 12
        color: Qt.rgba(0.05, 0.06, 0.14, 0.96)
        border.color: Qt.rgba(0.55, 0.36, 0.96, 0.20); border.width: 1

        MouseArea { anchors.fill: parent; onClicked: {} }

        Column {
            id: col
            width: parent.width - 12
            x: 6; y: 8
            spacing: 2

            // Header
            Item {
                width: parent.width
                height: 40
                Column {
                    anchors.right: parent.right; anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 1
                    Text { text: root.computerName; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; horizontalAlignment: Text.AlignRight }
                    Text { visible: root.username.length > 0 && root.username !== "—"; text: "کاربر: " + root.username; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; horizontalAlignment: Text.AlignRight }
                }
            }
            Rectangle { width: parent.width; height: 1; color: Theme.border }
            Item { width: 1; height: 4 }

            Repeater {
                model: [
                    { key: "voice",       icon: "🎙", label: "وویس (Push-to-Talk)",     color: Theme.violetSoft },
                    { key: "message",     icon: "✉️", label: "ارسال پیام",                color: Theme.cyanSoft },
                    { key: "charge",      icon: "💳", label: "افزایش شارژ (تومان)",       color: Theme.green },
                    { key: "pay-debt",    icon: "💵", label: "پرداخت بدهی",                color: Theme.green },
                    { key: "post-pay",    icon: "📋", label: "تغییر پس‌پرداخت",            color: Theme.amber },
                    { key: "assign-user", icon: "👤", label: "تخصیص کاربر",                color: Theme.cyan },
                    { key: "network",     icon: "🌐", label: "تنظیم مودم / DNS",           color: Theme.amber },
                    { key: "power",       icon: "🔌", label: "قفل / ری‌استارت / خاموش",     color: Theme.violet },
                    { key: "kick",        icon: "⏻",  label: "پایان نشست (اخراج)",         color: Theme.red }
                ]
                delegate: Rectangle {
                    width: parent.width; height: 34; radius: 8
                    color: hover.containsMouse ? Theme.cardHover : "transparent"
                    Behavior on color { ColorAnimation { duration: 120 } }

                    Row {
                        anchors.fill: parent
                        anchors.leftMargin: 8; anchors.rightMargin: 8
                        spacing: 10
                        layoutDirection: Qt.RightToLeft
                        Text { text: modelData.icon; font.pixelSize: 14; anchors.verticalCenter: parent.verticalCenter }
                        Text {
                            text: modelData.label
                            color: modelData.color
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Medium
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }

                    HoverHandler { id: hover }
                    TapHandler {
                        onTapped: {
                            root.pick(modelData.key);
                            root.open = false;
                        }
                    }
                }
            }
        }
    }
}
