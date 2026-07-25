// LivePcsPanel — scrollable list of every connected client. Right-click on
// a row opens a context menu with voice / message / extend-time / kick.
//
// The model is a JS array of clients (matches /api/clients shape). Driven
// from outside by passing in `clients`; emits `actionRequested(socketId,
// action)` for the parent to dispatch.
import QtQuick
import QtQuick.Controls.Basic
import "../theme"

GlassCard {
    id: root
    property var clients: []
    property int activeCount: clients.filter(c => c.status === "active").length

    signal actionRequested(string socketId, string action)
    signal pcContext(string socketId, string computerName, string username, real x, real y)

    Column {
        anchors.fill: parent
        anchors.margins: 22
        spacing: 18

        // Header
        Row {
            width: parent.width
            spacing: 12
            layoutDirection: Qt.RightToLeft

            Rectangle {
                width: 32; height: 32; radius: 10
                color: Qt.rgba(0.55, 0.36, 0.96, 0.15)
                Text { anchors.centerIn: parent; text: "🖥"; font.pixelSize: 16 }
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                Text { text: "وضعیت زنده · کنترل سریع"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold }
                Text { text: "راست‌کلیک روی هر PC"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
            }
            Item { width: 12; height: 1 }
            Rectangle {
                width: pillTxt.implicitWidth + 22; height: 24; radius: 12
                color: Qt.rgba(0.06, 0.73, 0.51, 0.12)
                border.color: Qt.rgba(0.06, 0.73, 0.51, 0.30); border.width: 1
                Text { id: pillTxt; anchors.centerIn: parent; text: root.activeCount + " فعال"; color: Theme.green; font.pixelSize: 11; font.weight: Font.Bold }
            }
        }

        // Empty state
        Column {
            visible: root.clients.length === 0
            width: parent.width
            spacing: 14
            Item { width: 1; height: 30 }
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 80; height: 80; radius: 20
                color: Qt.rgba(0.39, 0.40, 0.95, 0.10)
                border.color: Qt.rgba(0.39, 0.40, 0.95, 0.25); border.width: 1
                Text { anchors.centerIn: parent; text: "🖥"; font.pixelSize: 36 }
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "هیچ کامپیوتری متصل نیست"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }
        }

        // Client rows
        ScrollView {
            visible: root.clients.length > 0
            width: parent.width
            height: 280
            clip: true

            Column {
                width: parent.width
                spacing: 8

                Repeater {
                    model: root.clients
                    delegate: Rectangle {
                        width: parent.width
                        height: 56; radius: 12
                        property bool isActive: modelData.status === "active"
                        color: isActive
                            ? Qt.rgba(0.06, 0.73, 0.51, 0.08)
                            : Qt.rgba(1, 1, 1, 0.02)
                        border.color: isActive
                            ? Qt.rgba(0.06, 0.73, 0.51, 0.22)
                            : Theme.border
                        border.width: 1

                        Row {
                            anchors.fill: parent
                            anchors.margins: 12
                            spacing: 10
                            layoutDirection: Qt.RightToLeft

                            // Status icon
                            Rectangle {
                                width: 32; height: 32; radius: 10
                                color: isActive ? Qt.rgba(0.06, 0.73, 0.51, 0.20) : Qt.rgba(0.39, 0.40, 0.95, 0.18)
                                Text { anchors.centerIn: parent; text: "🖥"; font.pixelSize: 14 }
                                anchors.verticalCenter: parent.verticalCenter
                            }

                            // Info
                            Column {
                                width: parent.width - 32 - 70 - 20
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text {
                                    text: modelData.computerName || ("PC-" + (modelData.socketId || "").slice(0,4))
                                    color: Theme.text
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 13
                                    font.weight: Font.Bold
                                    horizontalAlignment: Text.AlignRight
                                    width: parent.width
                                }
                                Text {
                                    text: (modelData.username || "خالی") +
                                          (isActive && modelData.credits != null
                                              ? "  ·  " + Currency.format(modelData.credits) + " مانده"
                                              : "")
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 11
                                    horizontalAlignment: Text.AlignRight
                                    width: parent.width
                                }
                            }

                            // Status badge
                            Rectangle {
                                anchors.verticalCenter: parent.verticalCenter
                                width: 60; height: 22; radius: 11
                                color: isActive
                                    ? Qt.rgba(0.06, 0.73, 0.51, 0.15)
                                    : Qt.rgba(0.42, 0.44, 0.56, 0.15)
                                Row {
                                    anchors.centerIn: parent; spacing: 4
                                    Rectangle {
                                        width: 6; height: 6; radius: 3
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: isActive ? Theme.green : Theme.text3
                                        SequentialAnimation on opacity {
                                            running: isActive; loops: Animation.Infinite
                                            NumberAnimation { to: 0.3; duration: 800 }
                                            NumberAnimation { to: 1.0; duration: 800 }
                                        }
                                    }
                                    Text {
                                        text: isActive ? "فعال" : "خالی"
                                        color: isActive ? Theme.green : Theme.text3
                                        font.pixelSize: 10
                                        font.weight: Font.Bold
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                }
                            }
                        }

                        MouseArea {
                            anchors.fill: parent
                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                            onClicked: (mouse) => {
                                if (mouse.button === Qt.RightButton) {
                                    const pos = mapToItem(null, mouse.x, mouse.y);
                                    root.pcContext(modelData.socketId,
                                                   modelData.computerName || "",
                                                   modelData.username || "",
                                                   pos.x, pos.y);
                                }
                            }
                            cursorShape: Qt.PointingHandCursor
                        }
                    }
                }
            }
        }
    }
}
