// SessionsTable — last N rows of /api/sessions. RTL header + alternating
// row backgrounds. Clicking a row could open a detail modal (future).
import QtQuick
import QtQuick.Controls.Basic
import "../theme"

GlassCard {
    id: root
    property var rows: []

    Column {
        anchors.fill: parent
        anchors.margins: 22
        spacing: 16

        // Header
        Row {
            width: parent.width
            spacing: 12
            layoutDirection: Qt.RightToLeft
            Rectangle {
                width: 32; height: 32; radius: 10
                color: Qt.rgba(0.06, 0.71, 0.83, 0.15)
                Text { anchors.centerIn: parent; text: "⏱"; font.pixelSize: 16 }
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                Text { text: "آخرین جلسات بازی"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold }
                Text { text: "بروزرسانی هر ۳۰ ثانیه"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
            }
        }

        // Empty state
        Text {
            visible: root.rows.length === 0
            anchors.horizontalCenter: parent.horizontalCenter
            text: "جلسه‌ای ثبت نشده"
            color: Theme.text3
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }

        // Header row
        Row {
            visible: root.rows.length > 0
            width: parent.width
            layoutDirection: Qt.RightToLeft
            spacing: 0
            Repeater {
                model: ["کاربر", "کامپیوتر", "شروع", "پایان", "مدت", "وضعیت"]
                delegate: Item {
                    width: parent.width / 6; height: 32
                    Text {
                        anchors.right: parent.right
                        anchors.rightMargin: 8
                        anchors.verticalCenter: parent.verticalCenter
                        text: modelData
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                        font.weight: Font.Medium
                        font.letterSpacing: 1
                    }
                }
            }
        }

        // Rows
        ScrollView {
            visible: root.rows.length > 0
            width: parent.width
            height: 200
            clip: true

            Column {
                width: parent.width
                spacing: 1

                Repeater {
                    model: root.rows.slice(0, 10)
                    delegate: Rectangle {
                        width: parent.width
                        height: 44
                        color: index % 2 === 0 ? "transparent" : Qt.rgba(1, 1, 1, 0.015)

                        // Hover highlight
                        Rectangle {
                            anchors.fill: parent
                            color: hover.containsMouse ? Qt.rgba(0.55, 0.36, 0.96, 0.05) : "transparent"
                            Behavior on color { ColorAnimation { duration: 150 } }
                        }
                        HoverHandler { id: hover }

                        Row {
                            anchors.fill: parent
                            layoutDirection: Qt.RightToLeft

                            // Username
                            Item {
                                width: parent.width / 6; height: parent.height
                                Text {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.username || "—"
                                    color: Theme.text
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 13
                                    font.weight: Font.Bold
                                }
                            }
                            // Computer
                            Item {
                                width: parent.width / 6; height: parent.height
                                Text {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.computer_name || "—"
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                }
                            }
                            // Start (Shamsi)
                            Item {
                                width: parent.width / 6; height: parent.height
                                Text {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.start_time
                                        ? Jalali.dateTimeFromIso(modelData.start_time)
                                        : "—"
                                    color: Theme.text3
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 11
                                }
                            }
                            // End (Shamsi)
                            Item {
                                width: parent.width / 6; height: parent.height
                                Text {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.end_time
                                        ? Jalali.dateTimeFromIso(modelData.end_time)
                                        : "—"
                                    color: Theme.text3
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 11
                                }
                            }
                            // Duration
                            Item {
                                width: parent.width / 6; height: parent.height
                                Text {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: (modelData.duration || 0) + " دقیقه"
                                    color: Theme.cyanSoft
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                    font.weight: Font.Bold
                                }
                            }
                            // Status
                            Item {
                                width: parent.width / 6; height: parent.height
                                Rectangle {
                                    anchors.right: parent.right; anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: badgeText.implicitWidth + 18; height: 20; radius: 10
                                    color: modelData.end_time
                                        ? Qt.rgba(0.42, 0.44, 0.56, 0.15)
                                        : Qt.rgba(0.06, 0.73, 0.51, 0.18)
                                    border.color: modelData.end_time
                                        ? Qt.rgba(0.42, 0.44, 0.56, 0.30)
                                        : Qt.rgba(0.06, 0.73, 0.51, 0.35)
                                    border.width: 1
                                    Text {
                                        id: badgeText
                                        anchors.centerIn: parent
                                        text: modelData.end_time ? "پایان" : "● فعال"
                                        color: modelData.end_time ? Theme.text3 : Theme.green
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 10
                                        font.weight: Font.Bold
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
