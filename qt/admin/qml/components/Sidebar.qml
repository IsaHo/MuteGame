// Sidebar — right-edge navigation panel (RTL). The mockup's brand mark sits
// to the LEFT of the title text in the box (because dir=RTL inverts row
// order). Active item gets a glowing left-edge bar.
import QtQuick
import "../theme"

Rectangle {
    id: root
    width: 280
    color: Qt.rgba(0.04, 0.04, 0.10, 0.6)
    border.color: Theme.border
    border.width: 1

    property string activeKey: "dashboard"
    property string adminName: "admin"
    // Optional friendly name shown above the username (e.g. "علی محمدی").
    // Falls back to the username if empty.
    property string adminDisplay: ""
    signal navigate(string key)
    signal logoutRequested()

    readonly property var menu: [
        { key: "dashboard",  label: "داشبورد",   icon: "📊" },
        { key: "computers",  label: "کامپیوترها", icon: "🖥" },
        { key: "users",      label: "کاربران",    icon: "👥" },
        { key: "shop",       label: "شاپ",        icon: "🛒" },
        { key: "games",      label: "بازی‌ها",     icon: "🎮" },
        { key: "accounting", label: "حسابداری",   icon: "💰" },
        { key: "reports",    label: "گزارشات",    icon: "📈" },
        { key: "network",    label: "شبکه",       icon: "🌐" },
        { key: "admins",     label: "ادمین‌ها",    icon: "👑" },
        { key: "settings",   label: "تنظیمات",    icon: "⚙️" }
    ]

    Column {
        id: topGroup
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: footer.top
        anchors.margins: 16
        anchors.bottomMargin: 8
        spacing: 24
        clip: true

        // Brand
        Row {
            spacing: 12
            anchors.right: parent.right

            Column {
                anchors.verticalCenter: parent.verticalCenter
                Text {
                    text: "MuteGame"
                    color: Theme.text
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 18
                    font.weight: Font.Bold
                }
                Text {
                    text: "ADMIN · GAME CENTER"
                    color: Theme.text3
                    font.pixelSize: 10
                    font.letterSpacing: 2
                }
            }

            Rectangle {
                width: 44; height: 44; radius: 12
                gradient: Gradient {
                    orientation: Gradient.Vertical
                    GradientStop { position: 0.0; color: Theme.indigo }
                    GradientStop { position: 1.0; color: Theme.pink }
                }
                Text {
                    anchors.centerIn: parent
                    text: "M"; color: "white"
                    font.pixelSize: 22; font.weight: Font.Black
                }
            }
        }

        // Menu items
        Column {
            spacing: 4
            width: parent.width

            Repeater {
                model: root.menu
                delegate: Rectangle {
                    width: parent.width
                    height: 48
                    radius: 12
                    property bool active: modelData.key === root.activeKey

                    color: active
                        ? Qt.rgba(0.39, 0.40, 0.95, 0.15)
                        : (mouse.containsMouse ? Theme.cardHover : "transparent")
                    border.color: active ? Theme.border2 : "transparent"
                    border.width: 1

                    Behavior on color { ColorAnimation { duration: 200 } }

                    // Active glow strip on the leading edge (left in RTL)
                    Rectangle {
                        visible: parent.active
                        width: 3; height: 24; radius: 2
                        anchors.left: parent.left
                        anchors.leftMargin: -16
                        anchors.verticalCenter: parent.verticalCenter
                        gradient: Gradient {
                            GradientStop { position: 0; color: Theme.indigo }
                            GradientStop { position: 1; color: Theme.pink }
                        }
                    }

                    Row {
                        anchors.right: parent.right
                        anchors.rightMargin: 14
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 12
                        layoutDirection: Qt.RightToLeft

                        Rectangle {
                            width: 36; height: 36; radius: 10
                            color: parent.parent.active
                                ? Qt.rgba(0.55, 0.36, 0.96, 0.4)
                                : Theme.card
                            Text {
                                anchors.centerIn: parent
                                text: modelData.icon
                                font.pixelSize: 18
                            }
                        }
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData.label
                            color: parent.parent.active ? Theme.text : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.weight: Font.Medium
                        }
                    }

                    MouseArea {
                        id: mouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: root.navigate(modelData.key)
                        cursorShape: Qt.PointingHandCursor
                    }
                }
            }
        }
    }

    // ── Footer: profile chip + logout ────────────────────────────────
    Column {
        id: footer
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.margins: 16
        spacing: 10

        // Divider
        Rectangle {
            width: parent.width
            height: 1
            color: Theme.border
            opacity: 0.5
        }

        // Admin chip (avatar + name)
        Row {
            width: parent.width
            spacing: 10
            layoutDirection: Qt.RightToLeft

            Rectangle {
                width: 36; height: 36; radius: 18
                gradient: Gradient {
                    orientation: Gradient.Vertical
                    GradientStop { position: 0.0; color: Theme.cyan }
                    GradientStop { position: 1.0; color: Theme.violet }
                }
                Text {
                    anchors.centerIn: parent
                    text: (root.adminName.length > 0 ? root.adminName.charAt(0).toUpperCase() : "A")
                    color: "white"
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 16
                    font.weight: Font.Black
                }
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                Text {
                    text: root.adminDisplay && root.adminDisplay.length > 0
                          ? root.adminDisplay
                          : root.adminName
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: 13
                    font.weight: Font.Bold
                }
                // When a friendly name is set, show the username underneath
                // (otherwise the small caption stays "ادمین" as before).
                Text {
                    text: root.adminDisplay && root.adminDisplay.length > 0
                          ? ("@" + root.adminName)
                          : "ادمین"
                    color: Theme.text3
                    font.family: root.adminDisplay && root.adminDisplay.length > 0
                                 ? Theme.fontFamilyEn
                                 : Theme.fontFamily
                    font.pixelSize: 10
                }
            }
        }

        // Logout button — coral accent (destructive but soft)
        Rectangle {
            id: logoutBtn
            width: parent.width
            height: 44
            radius: 12
            property bool hovered: logoutMouse.containsMouse
            color: hovered ? Qt.rgba(0.96, 0.36, 0.45, 0.18) : Qt.rgba(0.96, 0.36, 0.45, 0.08)
            border.color: hovered ? Qt.rgba(0.96, 0.36, 0.45, 0.45) : Qt.rgba(0.96, 0.36, 0.45, 0.22)
            border.width: 1
            Behavior on color { ColorAnimation { duration: 180 } }
            Behavior on border.color { ColorAnimation { duration: 180 } }

            Row {
                anchors.centerIn: parent
                spacing: 8
                layoutDirection: Qt.RightToLeft
                Text {
                    text: "↩"
                    color: Qt.rgba(0.98, 0.55, 0.62, 1.0)
                    font.pixelSize: 16
                    font.weight: Font.Bold
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    text: "خروج از پنل"
                    color: Qt.rgba(0.98, 0.55, 0.62, 1.0)
                    font.family: Theme.fontFamily
                    font.pixelSize: 13
                    font.weight: Font.Bold
                    anchors.verticalCenter: parent.verticalCenter
                }
            }

            MouseArea {
                id: logoutMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.logoutRequested()
            }
        }
    }
}
