// UserFinanceModal — financial operations against a single user.
//
// Six ops:
//   • charge       — increase credit (counts as revenue)
//   • free_charge  — gift credit (does NOT pollute revenue)
//   • charge_debt  — credit + matching debt (play-now-pay-later)
//   • decharge     — reduce credit
//   • debt_add     — add debt
//   • debt_pay     — settle existing debt
//
// Amount input has 3-digit grouping in Toman; converted to Rial before
// hitting the server. Enter on the amount field submits.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)  // dark, near-opaque so dialogs stand out on any desktop
    visible: open
    z: 1000

    property bool   open: false
    property var    user: ({})         // { id, username, credits, debt, ... }
    property string op: "charge"

    signal closed()
    signal submitted(string op, var rialAmount, string description)  // var: QML doesn't know qint64

    onOpenChanged: if (open) {
        amountInput.text = "";
        descInput.text = "";
        amountInput.forceActiveFocus();
    }

    readonly property var ops: [
        { key: "charge",      label: "🔋 افزایش شارژ",  color: Theme.green },
        { key: "free_charge", label: "🎁 شارژ رایگان",   color: Theme.violetSoft },
        { key: "charge_debt", label: "🟠 شارژ بدهی",     color: Theme.orange },
        { key: "decharge",    label: "📉 کاهش شارژ",     color: Theme.amber },
        { key: "debt_add",    label: "💸 افزایش بدهی",    color: Theme.red },
        { key: "debt_pay",    label: "✅ پرداخت بدهی",    color: Theme.cyanSoft }
    ]
    readonly property var quickAmounts: [10000, 30000, 50000, 100000, 200000, 500000]

    MouseArea { anchors.fill: parent; onClicked: { root.open = false; root.closed() } }

    GlassCard {
        width: Math.min(parent.width - 40, 520)
        height: column.implicitHeight + 56
        anchors.centerIn: parent
        accent: Theme.amber
        radius: 18
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: column
            anchors.fill: parent
            anchors.margins: 28
            spacing: 14

            Text {
                Layout.fillWidth: true
                text: "💰 عملیات مالی — " + (root.user.username || "")
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 18
                font.weight: Font.Bold
                horizontalAlignment: Text.AlignRight
            }

            // Current balance summary
            GridLayout {
                Layout.fillWidth: true
                columns: 2
                columnSpacing: 10

                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 60
                    radius: 10
                    color: Theme.card
                    border.color: Theme.border; border.width: 1
                    Column {
                        anchors.right: parent.right; anchors.rightMargin: 14
                        anchors.verticalCenter: parent.verticalCenter
                        Text { text: "اعتبار فعلی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        Text { text: Currency.format(root.user.credits || 0)
                               color: (root.user.credits || 0) > 0 ? Theme.green : Theme.red
                               font.family: Theme.fontFamilyEn; font.pixelSize: 16; font.weight: Font.Bold }
                    }
                }
                Rectangle {
                    Layout.fillWidth: true; Layout.preferredHeight: 60
                    radius: 10
                    color: (root.user.debt || 0) > 0 ? Qt.rgba(0.94, 0.27, 0.27, 0.06) : Theme.card
                    border.color: (root.user.debt || 0) > 0 ? Qt.rgba(0.94, 0.27, 0.27, 0.30) : Theme.border
                    border.width: 1
                    Column {
                        anchors.right: parent.right; anchors.rightMargin: 14
                        anchors.verticalCenter: parent.verticalCenter
                        Text { text: "بدهی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        Text { text: (root.user.debt || 0) > 0 ? Currency.format(root.user.debt) : "—"
                               color: (root.user.debt || 0) > 0 ? Theme.red : Theme.text3
                               font.family: Theme.fontFamilyEn; font.pixelSize: 16; font.weight: Font.Bold }
                    }
                }
            }

            // Op selector — 3 columns × 2 rows
            GridLayout {
                Layout.fillWidth: true
                columns: 3
                rowSpacing: 6
                columnSpacing: 6
                Repeater {
                    model: root.ops
                    delegate: GlassButton {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 38
                        text: modelData.label
                        variant: root.op === modelData.key ? "primary" : "ghost"
                        onClicked: root.op = modelData.key
                    }
                }
            }

            // Quick amounts
            GridLayout {
                Layout.fillWidth: true
                columns: 3
                rowSpacing: 6
                columnSpacing: 6
                Repeater {
                    model: root.quickAmounts
                    delegate: GlassButton {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 32
                        text: Currency.grouped(String(Math.round(modelData / 10))) + " ت"
                        variant: Number(amountInput.rawDigits) === Math.round(modelData / 10) ? "primary" : "ghost"
                        onClicked: amountInput.text = Currency.grouped(String(Math.round(modelData / 10)))
                    }
                }
            }

            GlassInput {
                id: amountInput
                Layout.fillWidth: true
                label: "مبلغ (تومان)"
                placeholder: "10,000"
                icon: "💴"
                numeric: true
                nextField: descInput
            }
            GlassInput {
                id: descInput
                Layout.fillWidth: true
                label: "توضیح (اختیاری)"
                placeholder: "..."
                onSubmitted: root.confirm()
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                GlassButton { Layout.fillWidth: true; text: "انصراف"; variant: "ghost"; onClicked: { root.open = false; root.closed() } }
                GlassButton {
                    Layout.fillWidth: true
                    text: "✓ اعمال"
                    onClicked: root.confirm()
                }
            }
        }
    }

    function confirm() {
        const tomanAmount = Number(amountInput.rawDigits) || 0;
        if (tomanAmount <= 0) return;
        const rial = tomanAmount * 10;
        root.submitted(root.op, rial, descInput.text.trim());
        root.open = false;
        root.closed();
    }
}
