// EmojiPicker — grid of common food/drink/snack/misc emojis with a category
// switcher. Emits `picked(emoji)` when one is tapped. Used inside the shop
// item modal so admins don't have to copy-paste from a system emoji panel.
import QtQuick
import QtQuick.Layouts
import "../theme"

Item {
    id: root
    property string current: ""
    signal picked(string emoji)

    implicitHeight: 220
    implicitWidth: 360

    readonly property var categories: [
        { key: "food", label: "🍔 غذا", list: [
            "🍔","🍕","🌭","🥪","🌮","🌯","🥙","🥗","🍝","🍜","🍣","🍱",
            "🍙","🍚","🍛","🍲","🍳","🥘","🍖","🍗","🥩","🥓","🍤","🦞",
            "🦀","🍟","🥨","🥯","🥖","🍞","🧀","🥞","🧇","🍦","🍰","🎂",
            "🧁","🥧","🍪","🍩","🍫","🍬","🍭","🍯"
        ]},
        { key: "drink", label: "🥤 نوشیدنی", list: [
            "🥤","🧃","🧋","☕","🍵","🥛","🧊","🍶","🍾","🍷","🍸","🍹",
            "🍺","🍻","🥂","🥃","🍼"
        ]},
        { key: "snack", label: "🍿 تنقلات", list: [
            "🍟","🍿","🥨","🥜","🌰","🍪","🍩","🍫","🍬","🍭","🥧","🍮"
        ]},
        { key: "fruit", label: "🍎 میوه", list: [
            "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑","🥭",
            "🍍","🥥","🥝","🍅","🥑","🍈","🥒","🌽","🌶","🫑","🥕","🧅","🧄"
        ]},
        { key: "misc", label: "✨ سایر", list: [
            "🎮","🕹","🎯","🎲","🎁","💎","⭐","✨","🔥","💯","💰","💵",
            "🎉","🎊","🏆","🥇","🥈","🥉","🎟","🎫","💝","💌","🍃","🌿"
        ]}
    ]

    property string activeCat: "food"

    Column {
        anchors.fill: parent
        spacing: 8

        // Category tabs
        Row {
            spacing: 4
            Repeater {
                model: root.categories
                delegate: Rectangle {
                    width: chipText.implicitWidth + 18; height: 28; radius: 14
                    color: root.activeCat === modelData.key
                        ? Qt.rgba(0.55, 0.36, 0.96, 0.18)
                        : Theme.card
                    border.color: root.activeCat === modelData.key
                        ? Qt.rgba(0.55, 0.36, 0.96, 0.40)
                        : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 150 } }
                    Text {
                        id: chipText
                        anchors.centerIn: parent
                        text: modelData.label
                        color: root.activeCat === modelData.key ? Theme.text : Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                    MouseArea { anchors.fill: parent; onClicked: root.activeCat = modelData.key; cursorShape: Qt.PointingHandCursor }
                }
            }
        }

        // Emoji grid
        Rectangle {
            width: parent.width
            height: parent.height - 36
            radius: 12
            color: Theme.card
            border.color: Theme.border; border.width: 1

            Flickable {
                anchors.fill: parent
                anchors.margins: 8
                contentHeight: gridFlow.implicitHeight
                clip: true

                Flow {
                    id: gridFlow
                    width: parent.width
                    spacing: 4

                    Repeater {
                        // Find the active category's emoji list
                        model: {
                            for (let i = 0; i < root.categories.length; ++i)
                                if (root.categories[i].key === root.activeCat)
                                    return root.categories[i].list;
                            return [];
                        }
                        delegate: Rectangle {
                            width: 38; height: 38; radius: 9
                            property bool selected: modelData === root.current
                            color: selected
                                ? Qt.rgba(0.55, 0.36, 0.96, 0.30)
                                : (mouseE.containsMouse ? Theme.cardHover : "transparent")
                            border.color: selected ? Qt.rgba(0.55, 0.36, 0.96, 0.55) : "transparent"
                            border.width: 1
                            Behavior on color { ColorAnimation { duration: 100 } }

                            Text {
                                anchors.centerIn: parent
                                text: modelData
                                font.pixelSize: 22
                            }
                            MouseArea {
                                id: mouseE
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.picked(modelData)
                            }
                        }
                    }
                }
            }
        }
    }
}
