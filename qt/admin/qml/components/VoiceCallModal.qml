// VoiceCallModal — admin push-to-talk overlay.
// Captures mic via the C++ Voice singleton (QAudioSource @ 16kHz mono PCM)
// and forwards each ~250ms chunk to the target client over Socket.IO using
// `voice:chunk { targetSocketId, mime, audio }`. The receiving kiosk plays
// the chunks (raw PCM) — implementation on the client side is a separate
// task. This sender is the same protocol shape the React admin used, only
// the codec differs (PCM here vs webm/opus there).
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    visible: open
    color: Qt.rgba(0.02, 0.02, 0.06, 0.84)
    z: 1500

    property bool   open: false
    property string targetSocketId: ""
    property string computerName:   "—"
    property string username:       "—"
    property bool   muteRemote: false

    signal closeRequested()

    onOpenChanged: if (!open) Voice.stop()

    Connections {
        target: Voice
        function onChunkReady(mime, b64) {
            if (!root.open || !root.targetSocketId) return;
            Socket.emitEvent("voice:chunk", JSON.stringify({
                targetSocketId: root.targetSocketId,
                mime: mime,
                audio: b64
            }));
        }
        function onRecordingChanged() {
            if (Voice.recording) {
                Socket.emitEvent("voice:start", JSON.stringify({ targetSocketId: root.targetSocketId }));
            } else {
                Socket.emitEvent("voice:stop",  JSON.stringify({ targetSocketId: root.targetSocketId }));
            }
        }
        function onError(msg) {
            errBanner.message = msg;
            errBanner.show = true;
            hideErrTimer.restart();
        }
    }
    Timer { id: hideErrTimer; interval: 3000; repeat: false; onTriggered: errBanner.show = false }

    function toggleRemoteMute() {
        const next = !root.muteRemote;
        Api.setClientVoiceMute(root.targetSocketId, next);
        root.muteRemote = next;
    }

    // Backdrop click closes
    MouseArea { anchors.fill: parent; onClicked: { Voice.stop(); root.closeRequested() } }
    Keys.onEscapePressed: { Voice.stop(); root.closeRequested() }
    focus: open

    // Panel
    Rectangle {
        id: panel
        anchors.centerIn: parent
        width: 460
        height: column.implicitHeight + 56
        radius: 22
        color: Qt.rgba(0.047, 0.055, 0.137, 0.97)
        border.color: Qt.rgba(0.486, 0.227, 0.929, 0.30); border.width: 1
        clip: true

        MouseArea { anchors.fill: parent }

        // Close X
        Rectangle {
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 14
            width: 30; height: 30; radius: 15
            color: closeHover.hovered ? Qt.rgba(1, 0.4, 0.4, 0.18) : Qt.rgba(1, 1, 1, 0.06)
            border.color: Theme.border; border.width: 1
            Behavior on color { ColorAnimation { duration: 200 } }
            Text { anchors.centerIn: parent; text: "✕"; color: Theme.text2; font.pixelSize: 12; font.weight: Font.Bold }
            HoverHandler { id: closeHover }
            TapHandler { onTapped: { Voice.stop(); root.closeRequested() } }
            z: 10
        }

        ColumnLayout {
            id: column
            anchors.centerIn: parent
            width: parent.width - 56
            spacing: 14

            // Title
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                layoutDirection: Qt.RightToLeft
                Text { text: "🎙"; font.pixelSize: 24 }
                ColumnLayout {
                    spacing: 1
                    Text {
                        text: "تماس صوتی"
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 17
                        font.weight: Font.Bold
                    }
                    Text {
                        text: "با " + root.computerName + " (" + root.username + ")"
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                    }
                }
                Item { Layout.fillWidth: true }
            }

            // Error banner
            Rectangle {
                id: errBanner
                property bool show: false
                property string message: ""
                Layout.fillWidth: true
                Layout.preferredHeight: show ? 36 : 0
                visible: show
                radius: 10
                color: Qt.rgba(1, 0.27, 0.27, 0.10)
                border.color: Qt.rgba(1, 0.27, 0.27, 0.30); border.width: 1
                Text {
                    anchors.centerIn: parent
                    text: "⚠ " + errBanner.message
                    color: "#ff6b6b"
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
            }

            // Mic / VU panel
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 96
                radius: 14
                color: Qt.rgba(1, 1, 1, 0.04)
                border.color: Voice.recording ? Qt.rgba(1, 0.27, 0.27, 0.45) : Theme.border
                border.width: 1
                Behavior on border.color { ColorAnimation { duration: 200 } }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 14
                    anchors.rightMargin: 14
                    spacing: 14
                    layoutDirection: Qt.RightToLeft

                    Rectangle {
                        Layout.preferredWidth: 64
                        Layout.preferredHeight: 64
                        radius: 16
                        color: Voice.recording
                               ? Qt.rgba(1, 0.27, 0.27, 0.18)
                               : Qt.rgba(0.486, 0.227, 0.929, 0.18)
                        border.color: Voice.recording
                                      ? Qt.rgba(1, 0.27, 0.27, 0.45)
                                      : Qt.rgba(0.486, 0.227, 0.929, 0.30); border.width: 1
                        Behavior on color { ColorAnimation { duration: 200 } }
                        Text { anchors.centerIn: parent; text: "🎙"; font.pixelSize: 30 }
                        // Pulse when recording
                        Rectangle {
                            anchors.fill: parent
                            radius: parent.radius
                            color: "transparent"
                            border.color: Theme.red
                            border.width: 2
                            opacity: 0
                            visible: Voice.recording
                            SequentialAnimation on opacity {
                                loops: Animation.Infinite
                                running: Voice.recording
                                NumberAnimation { from: 0; to: 0.55; duration: 700; easing.type: Easing.InOutSine }
                                NumberAnimation { from: 0.55; to: 0; duration: 700; easing.type: Easing.InOutSine }
                            }
                        }
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 6
                        Text {
                            text: Voice.recording
                                  ? "در حال صحبت — کلاینت می‌شنود"
                                  : "روی «🔴 شروع صحبت» بزن"
                            color: Voice.recording ? Theme.red : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                            horizontalAlignment: Text.AlignRight
                            Layout.fillWidth: true
                        }
                        // VU meter
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 8
                            radius: 4
                            color: Qt.rgba(1, 1, 1, 0.06)
                            Rectangle {
                                anchors.left: parent.left
                                anchors.top: parent.top; anchors.bottom: parent.bottom
                                width: parent.width * Math.min(1.0, Voice.level)
                                radius: parent.radius
                                gradient: Gradient {
                                    orientation: Gradient.Horizontal
                                    GradientStop { position: 0;   color: "#34d399" }
                                    GradientStop { position: 0.55; color: "#fbbf24" }
                                    GradientStop { position: 1;   color: "#ef4444" }
                                }
                                Behavior on width { NumberAnimation { duration: 60; easing.type: Easing.Linear } }
                            }
                        }
                    }
                }
            }

            // Action buttons
            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                layoutDirection: Qt.RightToLeft

                // Push-to-talk
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 48
                    radius: 12
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: Voice.recording ? Theme.red : Theme.violet }
                        GradientStop { position: 1; color: Voice.recording ? "#dc2626" : Theme.violetDeep }
                    }
                    Text {
                        anchors.centerIn: parent
                        text: Voice.recording ? "⏹ پایان صحبت" : "🔴 شروع صحبت"
                        color: "white"
                        font.family: Theme.fontFamily
                        font.pixelSize: 14
                        font.weight: Font.Bold
                    }
                    TapHandler {
                        onTapped: Voice.recording ? Voice.stop() : Voice.start()
                    }
                }

                // Remote mute
                Rectangle {
                    Layout.preferredHeight: 48
                    Layout.preferredWidth: muteT.implicitWidth + 30
                    radius: 12
                    color: root.muteRemote
                           ? Qt.rgba(1, 0.27, 0.27, 0.18)
                           : Qt.rgba(1, 1, 1, 0.05)
                    border.color: root.muteRemote ? Qt.rgba(1, 0.27, 0.27, 0.45) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 200 } }
                    Text {
                        id: muteT
                        anchors.centerIn: parent
                        text: root.muteRemote ? "🔇 وویس بسته" : "🔊 وویس باز"
                        color: root.muteRemote ? Theme.red : Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                        font.weight: Font.Bold
                    }
                    TapHandler { onTapped: root.toggleRemoteMute() }
                }
            }

            // Footer note
            Text {
                Layout.fillWidth: true
                text: "صدا فقط در زمان صحبت روی هدفون کاربر پخش می‌شه — هیچ ضبطی نگه‌داری نمی‌شه."
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 10
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
            }
        }
    }
}
