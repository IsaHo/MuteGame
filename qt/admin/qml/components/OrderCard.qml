// OrderCard — pending order panel. Shows the user, computer, items list,
// total, and timestamps. Approve / cancel buttons fire signals — the parent
// page wires them to ApiClient.
//
// Sizing rule: implicitHeight comes from the inner ColumnLayout's content
// height. Column lays out children top-to-bottom; we use ColumnLayout
// because some children (RowLayout, Repeater wrappers) need fillWidth.
import QtQuick
import QtQuick.Layouts
import "../theme"

GlassCard {
    id: root
    property var order: ({})
    property bool readOnly: false   // true → no buttons, status badge instead
    accent: {
        if (root.readOnly) {
            return order.status === "completed" ? Theme.green
                 : order.status === "cancelled" ? Theme.red
                 : Theme.text3;
        }
        return order.payment_method === "credits" ? Theme.violet : Theme.amber;
    }

    signal approve()
    signal cancel()

    // Parse items. The Node.js shop route already JSON.parses the column,
    // but the value comes through QJsonArray → JS array. We handle both
    // shapes (string fallback) just in case.
    readonly property var items: {
        const o = root.order;
        if (!o) return [];
        const raw = o.items;
        if (!raw) return [];
        if (typeof raw === "string") {
            try { return JSON.parse(raw); }
            catch (e) { return []; }
        }
        // Already an array-like — coerce length so Repeater iterates
        const out = [];
        for (let i = 0; i < (raw.length || 0); ++i) out.push(raw[i]);
        return out;
    }

    implicitHeight: Math.max(180, column.implicitHeight + 32)

    ColumnLayout {
        id: column
        x: 16; y: 16
        width: root.width - 32
        spacing: 10

        // ── Header: pulsing dot + user/PC + timestamp + payment tag ────
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            layoutDirection: Qt.RightToLeft

            Rectangle {
                Layout.preferredWidth: 10; Layout.preferredHeight: 10; radius: 5
                Layout.alignment: Qt.AlignVCenter
                color: root.readOnly
                    ? (root.order.status === "completed" ? Theme.green : Theme.red)
                    : Theme.amber
                SequentialAnimation on opacity {
                    running: !root.readOnly
                    loops: Animation.Infinite
                    NumberAnimation { to: 0.3; duration: 700 }
                    NumberAnimation { to: 1.0; duration: 700 }
                }
            }
            Column {
                Layout.alignment: Qt.AlignVCenter
                spacing: 2
                Row {
                    spacing: 6
                    layoutDirection: Qt.RightToLeft
                    Text { text: root.order.username || "مهمان"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                    Text { text: "·"; color: Theme.text3; font.pixelSize: 12 }
                    Text { text: root.order.computer_name || "—"; color: Theme.cyanSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 12 }
                }
                Text {
                    text: typeof Jalali !== 'undefined' && root.order.created_at
                        ? Jalali.dateTimeFromIso(root.order.created_at)
                        : (root.order.created_at || "—")
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                }
            }
            Item { Layout.fillWidth: true }   // pushes payment tag to leading edge
            Rectangle {
                Layout.preferredWidth: pmTxt.implicitWidth + 18
                Layout.preferredHeight: 24
                Layout.alignment: Qt.AlignVCenter
                radius: 12
                color: root.order.payment_method === "credits"
                    ? Qt.rgba(0.55, 0.36, 0.96, 0.15)
                    : Qt.rgba(0.96, 0.62, 0.04, 0.15)
                border.color: root.order.payment_method === "credits"
                    ? Qt.rgba(0.55, 0.36, 0.96, 0.35)
                    : Qt.rgba(0.96, 0.62, 0.04, 0.35)
                border.width: 1
                Text {
                    id: pmTxt
                    anchors.centerIn: parent
                    text: root.order.payment_method === "credits" ? "💳 از اعتبار" : "💵 نقدی"
                    color: root.order.payment_method === "credits" ? Theme.violetSoft : Theme.amber
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // ── Items list ─────────────────────────────────────────────────
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 6

            Repeater {
                model: root.items
                delegate: RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    layoutDirection: Qt.RightToLeft

                    Text {
                        text: modelData.emoji || "🍔"
                        font.pixelSize: 18
                        Layout.alignment: Qt.AlignVCenter
                    }
                    Text {
                        text: (modelData.name || "—") + " × " + (modelData.qty || 1)
                        color: Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 13
                        Layout.alignment: Qt.AlignVCenter
                    }
                    Item { Layout.fillWidth: true }    // pushes price to leading
                    Text {
                        Layout.alignment: Qt.AlignVCenter
                        text: Currency.format((Number(modelData.price) || 0) * (Number(modelData.qty) || 1))
                        color: Theme.text3
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 12
                    }
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.border }

        // ── Total + buttons (single RTL Row; total leading, buttons trailing)
        // Uses an explicit Row + Item.fillWidth spacer so we don't rely on
        // RowLayout fillWidth quirks that swallowed the total earlier.
        Row {
            Layout.fillWidth: true
            Layout.preferredHeight: 44
            spacing: 8
            // Inherit RTL (default true here) so children render right-to-left

            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 2
                Text { text: "مجموع"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                Text {
                    text: Currency.format(Number(root.order.total) || 0)
                    color: Theme.text
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 18
                    font.weight: Font.Black
                }
            }

            // Flexible gap — calculated from Row width so the buttons hug
            // the trailing edge. We use Math.max to avoid negative widths
            // on very narrow cards (which would otherwise eat children).
            Item {
                width: Math.max(8, parent.width - totalW - btnW - 24)
                height: 1
                readonly property int totalW: 90    // approx total column width
                readonly property int btnW: 130 + 100 + 8   // approve + cancel + spacing
            }

            // Cancel button (renders right-of-approve in RTL flow → second from leading)
            Rectangle {
                visible: !root.readOnly
                width: 100; height: 36; radius: 18
                anchors.verticalCenter: parent.verticalCenter
                color: cancelM.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.25) : Qt.rgba(0.94, 0.27, 0.27, 0.12)
                border.color: Qt.rgba(0.94, 0.27, 0.27, 0.40); border.width: 1
                Behavior on color { ColorAnimation { duration: 130 } }
                Text { anchors.centerIn: parent; text: "✕ لغو"; color: Theme.red; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                MouseArea { id: cancelM; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.cancel() }
            }

            // Approve button (gradient)
            Rectangle {
                visible: !root.readOnly
                width: 130; height: 36; radius: 18
                anchors.verticalCenter: parent.verticalCenter
                gradient: Gradient {
                    orientation: Gradient.Horizontal
                    GradientStop { position: 0.0; color: "#10b981" }
                    GradientStop { position: 1.0; color: "#06b6d4" }
                }
                Text { anchors.centerIn: parent; text: "✓ تایید سفارش"; color: "white"; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.approve()
                }
            }

            // Status badge — replaces the buttons when readOnly
            Rectangle {
                visible: root.readOnly
                width: statusTxt.implicitWidth + 28; height: 32; radius: 16
                anchors.verticalCenter: parent.verticalCenter
                readonly property bool ok: root.order.status === "completed"
                color: ok ? Qt.rgba(0.06, 0.73, 0.51, 0.15) : Qt.rgba(0.94, 0.27, 0.27, 0.15)
                border.color: ok ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Qt.rgba(0.94, 0.27, 0.27, 0.40)
                border.width: 1
                Text {
                    id: statusTxt
                    anchors.centerIn: parent
                    text: parent.ok ? "✓ تأیید شده" : "✕ لغو شده"
                    color: parent.ok ? Theme.green : Theme.red
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                    font.weight: Font.Bold
                }
            }
        }
    }
}
