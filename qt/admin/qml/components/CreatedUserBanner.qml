// CreatedUserBanner — celebratory modal that appears after creating a
// user, prominently showing the auto-generated username so the operator
// can write it down for the customer.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)  // dark, near-opaque so dialogs stand out on any desktop
    visible: open
    z: 1600

    property bool open: false
    property string username: ""
    property string fullName: ""

    function show(u, n) { username = u; fullName = (n || "").trim(); open = true }

    MouseArea { anchors.fill: parent; onClicked: root.open = false }

    GlassCard {
        width: Math.min(parent.width - 40, 380)
        height: col.implicitHeight + 56
        anchors.centerIn: parent
        accent: Theme.cyanSoft
        radius: 18
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: col
            anchors.fill: parent
            anchors.margins: 28
            spacing: 14

            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "✅"; font.pixelSize: 44
            }
            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "کاربر ساخته شد"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 17
                font.weight: Font.Bold
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 100
                radius: 14
                color: Qt.rgba(0.06, 0.71, 0.83, 0.10)
                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.40); border.width: 2
                Column {
                    anchors.centerIn: parent
                    spacing: 4
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "کد کاربری (نام کاربری + رمز)"
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: root.username
                        color: Theme.cyanSoft
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 42
                        font.weight: Font.Black
                        font.letterSpacing: 4
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        visible: root.fullName.length > 0
                        text: root.fullName
                        color: Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                text: "این کد را به کاربر بدهید — هم نام کاربری هم رمز همین عدد است."
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 12
                wrapMode: Text.Wrap
                horizontalAlignment: Text.AlignCenter
            }

            GlassButton {
                Layout.fillWidth: true
                text: "✓ متوجه شدم"
                onClicked: root.open = false
            }
        }
    }
}
