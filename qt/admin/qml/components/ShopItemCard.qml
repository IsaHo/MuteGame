// ShopItemCard — visual card for a shop item in a grid layout. Big emoji,
// name, price, profit margin badge, stock indicator, edit/delete actions
// on hover.
import QtQuick
import QtQuick.Controls.Basic
import "../theme"

GlassCard {
    id: root
    property var item: ({})
    accent: item.category === "drink" ? Theme.cyan
          : item.category === "snack" ? Theme.amber
          : Theme.green

    signal edit()
    signal remove()
    signal toggleActive()

    implicitWidth: 200
    implicitHeight: 240   // bumped from 220 so the profit % row doesn't push buttons off the card

    // Inactive items dim slightly + get a "غیرفعال" ribbon. We don't go below
    // 0.6 so the action buttons (especially "✅ فعال کن") stay readable —
    // otherwise the operator can't tell how to recover a deactivated item.
    opacity: item.active === 0 ? 0.65 : 1

    Column {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 6

        // Big emoji + status row
        Item {
            width: parent.width; height: 76

            // Center emoji
            Text {
                anchors.centerIn: parent
                text: item.emoji || "🍔"
                font.pixelSize: 52
            }

            // Stock badge — visual top-right under RTL means anchors.left
            // (LayoutMirroring is enabled at Window level, so anchors flip).
            Rectangle {
                visible: (item.stock !== undefined && item.stock !== -1)
                anchors.top: parent.top
                anchors.left: parent.left
                width: stockTxt.implicitWidth + 14; height: 20; radius: 10
                color: item.stock <= 5 ? Qt.rgba(0.94, 0.27, 0.27, 0.18) : Qt.rgba(0.06, 0.73, 0.51, 0.18)
                border.color: item.stock <= 5 ? Qt.rgba(0.94, 0.27, 0.27, 0.40) : Qt.rgba(0.06, 0.73, 0.51, 0.40)
                border.width: 1
                Text {
                    id: stockTxt
                    anchors.centerIn: parent
                    text: "📦 " + item.stock
                    color: item.stock <= 5 ? Theme.red : Theme.green
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 10
                    font.weight: Font.Bold
                }
            }

            // Inactive ribbon — visual top-left under RTL = anchors.right
            Rectangle {
                visible: item.active === 0
                anchors.top: parent.top
                anchors.right: parent.right
                width: inactTxt.implicitWidth + 14; height: 20; radius: 10
                color: Qt.rgba(0.94, 0.27, 0.27, 0.18)
                border.color: Qt.rgba(0.94, 0.27, 0.27, 0.40); border.width: 1
                Text {
                    id: inactTxt
                    anchors.centerIn: parent
                    text: "غیرفعال"
                    color: Theme.red
                    font.family: Theme.fontFamily
                    font.pixelSize: 10
                    font.weight: Font.Bold
                }
            }
        }

        // Name
        Text {
            width: parent.width
            text: item.name || "—"
            color: Theme.text
            font.family: Theme.fontFamily
            font.pixelSize: 14
            font.weight: Font.Bold
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
        }

        // Price (toman)
        Text {
            width: parent.width
            text: Currency.format(item.price || 0)
            color: Theme.green
            font.family: Theme.fontFamilyEn
            font.pixelSize: 13
            font.weight: Font.Bold
            horizontalAlignment: Text.AlignHCenter
        }

        // Profit margin
        Text {
            width: parent.width
            visible: (item.buy_price || 0) > 0
            text: {
                const profit = (item.price || 0) - (item.buy_price || 0);
                const margin = (item.price || 0) > 0 ? Math.round((profit / item.price) * 100) : 0;
                return "سود: " + margin + "%";
            }
            color: Theme.text3
            font.family: Theme.fontFamily
            font.pixelSize: 11
            horizontalAlignment: Text.AlignHCenter
        }

        Item { width: 1; height: 4 }   // spacer

        // Action row — three labeled buttons of equal width. Always visible
        // (no hover-fade) so the operator can see exactly what's available
        // without having to discover hidden controls. On inactive cards the
        // toggle becomes "✅ فعال کن" — the recovery path is right there.
        Row {
            id: actionRow
            width: parent.width
            spacing: 5
            // Stay fully readable even on dimmed (inactive) cards — the row's
            // own opacity counteracts the parent dim so the action labels are
            // always sharp and clickable.
            opacity: item.active === 0 ? (1 / 0.65) : 1

            readonly property real btnW: (width - spacing * 2) / 3
            readonly property bool isActive: item.active !== 0

            // ── Toggle (deactivate ↔ activate) ──
            Rectangle {
                width: actionRow.btnW; height: 32; radius: 8
                color: tglM.containsMouse
                    ? (actionRow.isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.28) : Qt.rgba(0.06, 0.73, 0.51, 0.28))
                    : (actionRow.isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.14) : Qt.rgba(0.06, 0.73, 0.51, 0.14))
                border.color: actionRow.isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.40) : Qt.rgba(0.06, 0.73, 0.51, 0.45)
                border.width: 1
                Behavior on color { ColorAnimation { duration: 130 } }
                Text {
                    anchors.centerIn: parent
                    text: actionRow.isActive ? "🚫 غیرفعال" : "✅ فعال کن"
                    color: actionRow.isActive ? Theme.amber : Theme.green
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
                MouseArea {
                    id: tglM
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleActive()
                }
            }

            // ── Edit ──
            Rectangle {
                width: actionRow.btnW; height: 32; radius: 8
                color: editM.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.28) : Qt.rgba(0.06, 0.71, 0.83, 0.14)
                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.40); border.width: 1
                Behavior on color { ColorAnimation { duration: 130 } }
                Text {
                    anchors.centerIn: parent
                    text: "✏️ ویرایش"
                    color: Theme.cyanSoft
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
                MouseArea { id: editM; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.edit() }
            }

            // ── Delete (smart: hard if no orders, soft otherwise) ──
            Rectangle {
                width: actionRow.btnW; height: 32; radius: 8
                color: rmM.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.28) : Qt.rgba(0.94, 0.27, 0.27, 0.14)
                border.color: Qt.rgba(0.94, 0.27, 0.27, 0.40); border.width: 1
                Behavior on color { ColorAnimation { duration: 130 } }
                Text {
                    anchors.centerIn: parent
                    text: "🗑 حذف"
                    color: Theme.red
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
                MouseArea { id: rmM; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.remove() }
            }
        }
    }

    HoverHandler { id: hover }
}
