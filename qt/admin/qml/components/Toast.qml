// Toast — bottom-anchored slide-in notification. Stacks multiple messages
// briefly (3.5s default) before fading out.
import QtQuick
import "../theme"

Item {
    id: root
    anchors.fill: parent
    z: 2000

    function show(msg, kind) {
        const palette = {
            success: { bg: Theme.green,    icon: "✅" },
            error:   { bg: Theme.red,      icon: "⚠️" },
            warning: { bg: Theme.amber,    icon: "⚠️" },
            info:    { bg: Theme.cyanSoft, icon: "ℹ️" }
        }[kind] || { bg: Theme.violet, icon: "•" };
        toastModel.append({ text: msg, kind: kind || "info", color: palette.bg, icon: palette.icon });
    }

    ListModel { id: toastModel }

    Column {
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 24
        anchors.right: parent.right
        anchors.rightMargin: 24
        spacing: 8

        Repeater {
            model: toastModel
            delegate: Rectangle {
                width: contentRow.implicitWidth + 28
                height: 44
                radius: 12
                color: Qt.rgba(0.04, 0.05, 0.12, 0.96)
                border.color: Qt.rgba(model.color.r, model.color.g, model.color.b, 0.45)
                border.width: 1
                opacity: 0
                Component.onCompleted: enterAnim.start()
                NumberAnimation on opacity {
                    id: enterAnim
                    from: 0; to: 1; duration: 220; easing.type: Easing.OutCubic
                }
                Timer {
                    interval: 3500; running: true; repeat: false
                    onTriggered: exitAnim.start()
                }
                NumberAnimation on opacity {
                    id: exitAnim
                    from: 1; to: 0; duration: 280
                    onFinished: toastModel.remove(index)
                }

                Row {
                    id: contentRow
                    anchors.centerIn: parent
                    spacing: 10
                    layoutDirection: Qt.RightToLeft
                    Text { text: model.icon; font.pixelSize: 18; anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        text: model.text
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 13
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
        }
    }
}
