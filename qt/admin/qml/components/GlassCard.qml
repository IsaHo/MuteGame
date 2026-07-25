// GlassCard — translucent surface with a subtle top accent strip and
// hover lift. Used as the base for stat cards, settings groups, modals.
import QtQuick
import "../theme"

Rectangle {
    id: root
    property color accent: Theme.violet
    property bool  showAccentStrip: true

    radius: Theme.radiusLg
    color: hovered ? Theme.cardHover : Theme.card
    border.color: hovered ? Theme.border2 : Theme.border
    border.width: 1
    Behavior on color        { ColorAnimation { duration: 200 } }
    Behavior on border.color { ColorAnimation { duration: 200 } }

    property bool hovered: hover.hovered

    HoverHandler { id: hover }

    // Top accent line — fades from transparent through the accent colour
    Rectangle {
        visible: root.showAccentStrip
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: 2
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "transparent" }
            GradientStop { position: 0.5; color: root.accent }
            GradientStop { position: 1.0; color: "transparent" }
        }
        opacity: 0.6
    }
}
