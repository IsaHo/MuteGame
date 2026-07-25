// GlassButton — primary / ghost / accent variants of the same base shape.
//
// Variants:
//   "primary"   — gradient indigo→violet (default, used for save/confirm)
//   "ghost"     — translucent surface, used for cancel/secondary actions
//   "danger"    — red accent for destructive actions
import QtQuick
import QtQuick.Controls.Basic
import "../theme"

Button {
    id: root
    property string variant: "primary"   // primary | ghost | danger | cyan
    property bool   loading: false
    property string iconText: ""   // emoji/glyph; renamed from `icon` because Button.icon is FINAL

    implicitHeight: 44
    leftPadding: 22
    rightPadding: 22
    enabled: !loading

    contentItem: Row {
        spacing: 8
        anchors.centerIn: parent
        Text {
            visible: root.iconText.length > 0
            text: root.iconText
            color: txt.color
            font.pixelSize: 16
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            id: txt
            text: root.loading ? "⏳…" : root.text
            color: root.variant === "ghost" ? Theme.text2 : "#ffffff"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontMd
            font.weight: Font.Bold
            anchors.verticalCenter: parent.verticalCenter
        }
    }

    background: Rectangle {
        radius: Theme.radiusFull
        gradient: root.variant === "primary" ? primaryGrad
                : root.variant === "danger"  ? dangerGrad
                : root.variant === "cyan"    ? cyanGrad
                : null
        color: root.variant === "ghost" ? (root.hovered ? Theme.cardHover : Theme.card) : "transparent"
        border.color: root.variant === "ghost" ? Theme.border : "transparent"
        border.width: 1

        Behavior on opacity { NumberAnimation { duration: 150 } }
        opacity: root.pressed ? 0.85 : (root.hovered ? 1 : 0.95)

        Gradient {
            id: primaryGrad
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: Theme.indigo }
            GradientStop { position: 1.0; color: Theme.violet }
        }
        Gradient {
            id: dangerGrad
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "#dc2626" }
            GradientStop { position: 1.0; color: Theme.red }
        }
        Gradient {
            id: cyanGrad
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: Theme.cyan }
            GradientStop { position: 1.0; color: Theme.indigo }
        }
    }
}
