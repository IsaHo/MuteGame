// ConfirmDialog — generic yes/no overlay used for destructive actions.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)  // dark, near-opaque so dialogs stand out on any desktop
    visible: open
    z: 1500

    property bool   open: false
    property string title: ""
    property string body:  ""
    property string confirmText: "تایید"
    property string confirmVariant: "primary"

    signal confirmed()
    signal cancelled()

    MouseArea { anchors.fill: parent; onClicked: { root.open = false; root.cancelled() } }

    GlassCard {
        width: Math.min(parent.width - 40, 420)
        height: col.implicitHeight + 48
        anchors.centerIn: parent
        accent: Theme.red
        radius: 16
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: col
            anchors.fill: parent
            anchors.margins: 24
            spacing: 12
            Text {
                Layout.fillWidth: true
                text: root.title
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 17
                font.weight: Font.Bold
                horizontalAlignment: Text.AlignRight
            }
            Text {
                Layout.fillWidth: true
                text: root.body
                color: Theme.text2
                font.family: Theme.fontFamily
                font.pixelSize: 13
                wrapMode: Text.Wrap
                horizontalAlignment: Text.AlignRight
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                GlassButton {
                    Layout.fillWidth: true
                    text: "انصراف"
                    variant: "ghost"
                    onClicked: { root.open = false; root.cancelled() }
                }
                GlassButton {
                    Layout.fillWidth: true
                    text: root.confirmText
                    variant: root.confirmVariant
                    onClicked: { root.open = false; root.confirmed() }
                }
            }
        }
    }
}
