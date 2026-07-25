// GlassInput — themed text input shared by every form in the admin.
//
// Two project-wide behaviours baked in here once so every page gets them
// for free:
//
//   • numeric          — when true, the field shows the value with comma
//                        thousand separators ("12,345"). The raw integer
//                        stays available as `numericValue`.
//
//   • Enter / Return   — advances to `nextField` if set, otherwise emits
//                        `submitted()` so the parent form can save. This
//                        lets a user fly through a charge form by typing
//                        and hitting Enter without ever touching the mouse.
//
import QtQuick
import QtQuick.Controls.Basic
import "../theme"

FocusScope {
    id: root

    // ── Public API
    property string label: ""
    property string placeholder: ""
    property string text: ""
    property bool   password: false
    property bool   numeric: false
    property string icon: ""
    property var    nextField: null         // Item | null — tab target on Enter

    // Numeric helpers
    readonly property string rawDigits: numeric ? Currency.unGrouped(text) : text
    readonly property real   numericValue: numeric ? Number(rawDigits) || 0 : 0

    // Signals
    signal submitted()                      // fires when user hits Enter on the
                                            // last field in the chain

    implicitHeight: column.implicitHeight
    implicitWidth: 280

    Column {
        id: column
        anchors.fill: parent
        spacing: 6

        Text {
            visible: root.label.length > 0
            text: root.label
            color: Theme.text2
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSm
            font.weight: Font.Medium
        }

        Rectangle {
            id: box
            width: parent.width
            height: 46
            radius: Theme.radiusMd
            color: input.activeFocus ? Theme.cardHover : Theme.card
            border.color: input.activeFocus ? Theme.border2 : Theme.border
            border.width: 1
            Behavior on border.color { ColorAnimation { duration: 180 } }
            Behavior on color        { ColorAnimation { duration: 180 } }

            Row {
                anchors.fill: parent
                anchors.leftMargin: 14
                anchors.rightMargin: 14
                spacing: 10

                Text {
                    visible: root.icon.length > 0
                    text: root.icon
                    color: Theme.text3
                    font.pixelSize: 16
                    anchors.verticalCenter: parent.verticalCenter
                }

                TextField {
                    id: input
                    width: parent.width - (root.icon.length > 0 ? 26 : 0)
                    anchors.verticalCenter: parent.verticalCenter
                    placeholderText: root.placeholder
                    placeholderTextColor: Theme.text3
                    color: Theme.text
                    font.family: root.numeric ? Theme.fontFamilyEn : Theme.fontFamily
                    font.pixelSize: Theme.fontMd
                    font.weight: Font.Medium
                    background: null
                    selectByMouse: true
                    echoMode: root.password ? TextInput.Password : TextInput.Normal

                    text: root.text
                    onTextChanged: {
                        if (root.numeric) {
                            // Keep the cursor where the digits live so typing
                            // doesn't jump around when commas are inserted.
                            const beforeDigits = Currency.unGrouped(text.substring(0, cursorPosition)).length;
                            const grouped = Currency.grouped(text);
                            if (text !== grouped) {
                                text = grouped;
                                // Walk forward to skip exactly `beforeDigits` digits
                                let pos = 0, seen = 0;
                                while (pos < text.length && seen < beforeDigits) {
                                    if (/[0-9]/.test(text[pos])) seen++;
                                    pos++;
                                }
                                cursorPosition = pos;
                            }
                        }
                        if (root.text !== text) root.text = text;
                    }

                    // Numeric reformat above breaks the `text: root.text`
                    // binding (we assign to `text` directly). Bring it back
                    // when the parent rewrites root.text — needed for
                    // form reset and beginEdit pre-fill.
                    Connections {
                        target: root
                        function onTextChanged() {
                            if (input.text !== root.text) input.text = root.text;
                        }
                    }

                    Keys.onPressed: (e) => {
                        if (e.key === Qt.Key_Return || e.key === Qt.Key_Enter) {
                            if (root.nextField) {
                                root.nextField.forceActiveFocus();
                            } else {
                                root.submitted();
                            }
                            e.accepted = true;
                        }
                    }
                }
            }
        }
    }

    function forceActiveFocus() { input.forceActiveFocus(); }
}
