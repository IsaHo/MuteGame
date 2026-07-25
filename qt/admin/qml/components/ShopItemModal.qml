// ShopItemModal — create/edit dialog for a shop item. Top half: live
// preview card + inline EmojiPicker. Bottom half: form fields with thousand
// separators on prices and Enter-chain navigation.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.82)
    visible: open
    z: 1000

    property bool open: false
    property string mode: "create"   // create | edit
    property var initial: ({})

    signal closed()
    signal submitted(var payload)

    onOpenChanged: if (open) {
        nameInput.text       = initial.name || "";
        priceInput.text      = initial.price ? Currency.grouped(String(Math.round(initial.price / 10))) : "";
        buyPriceInput.text   = initial.buy_price ? Currency.grouped(String(Math.round(initial.buy_price / 10))) : "";
        stockInput.text      = (initial.stock !== undefined) ? String(initial.stock) : "-1";
        emojiBox.current     = initial.emoji || "🍔";
        catCombo.current     = initial.category || "food";
        nameInput.forceActiveFocus();
    }

    MouseArea { anchors.fill: parent; onClicked: { root.open = false; root.closed() } }

    GlassCard {
        width: Math.min(parent.width - 40, 720)
        height: Math.min(parent.height - 40, body.implicitHeight + 56)
        anchors.centerIn: parent
        accent: Theme.cyan
        radius: 18
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            id: body
            anchors.fill: parent
            anchors.margins: 28
            spacing: 16

            Text {
                Layout.fillWidth: true
                text: root.mode === "create" ? "🛒 آیتم جدید شاپ" : ("✏️ ویرایش — " + (root.initial.name || ""))
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 18
                font.weight: Font.Bold
                horizontalAlignment: Text.AlignRight
            }

            // Top: preview card + emoji picker side by side
            RowLayout {
                Layout.fillWidth: true
                spacing: 16

                // Live preview
                Rectangle {
                    Layout.preferredWidth: 200
                    Layout.preferredHeight: 200
                    radius: 16
                    color: Theme.card
                    border.color: Theme.border; border.width: 1
                    ColumnLayout {
                        anchors.centerIn: parent
                        spacing: 12
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: emojiBox.current
                            font.pixelSize: 64
                        }
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: nameInput.text || "نام آیتم"
                            color: nameInput.text ? Theme.text : Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.weight: Font.Bold
                        }
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: priceInput.text ? (priceInput.text + " " + Currency.label()) : "—"
                            color: Theme.green
                            font.family: Theme.fontFamilyEn
                            font.pixelSize: 13
                            font.weight: Font.Bold
                        }
                    }
                }

                // Emoji picker
                EmojiPicker {
                    id: emojiBox
                    Layout.fillWidth: true
                    Layout.preferredHeight: 200
                    onPicked: (emoji) => current = emoji
                }
            }

            // Form fields
            RowLayout {
                Layout.fillWidth: true
                spacing: 12

                GlassInput {
                    id: nameInput
                    Layout.fillWidth: true
                    label: "نام آیتم"
                    placeholder: "ساندویچ مرغ"
                    nextField: priceInput
                }
                // Category
                Column {
                    Layout.preferredWidth: 180
                    spacing: 6
                    Text {
                        text: "دسته‌بندی"
                        color: Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                        font.weight: Font.Medium
                    }
                    Rectangle {
                        id: catCombo
                        property string current: "food"
                        property var options: [
                            { key: "food",  label: "🍔 غذا" },
                            { key: "drink", label: "🥤 نوشیدنی" },
                            { key: "snack", label: "🍿 تنقلات" }
                        ]
                        property bool open: false
                        width: parent.width; height: 46; radius: Theme.radiusMd
                        color: open ? Theme.cardHover : Theme.card
                        border.color: open ? Theme.border2 : Theme.border
                        border.width: 1
                        Behavior on color { ColorAnimation { duration: 150 } }

                        Text {
                            anchors.fill: parent
                            anchors.leftMargin: 14
                            anchors.rightMargin: 30
                            verticalAlignment: Text.AlignVCenter
                            horizontalAlignment: Text.AlignRight
                            text: {
                                for (let i = 0; i < catCombo.options.length; ++i)
                                    if (catCombo.options[i].key === catCombo.current)
                                        return catCombo.options[i].label;
                                return "—";
                            }
                            color: Theme.text
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontMd
                        }
                        Text {
                            anchors.left: parent.left; anchors.leftMargin: 12
                            anchors.verticalCenter: parent.verticalCenter
                            text: "▾"; color: Theme.text3; font.pixelSize: 14
                        }

                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: catCombo.open = !catCombo.open
                        }

                        // Dropdown
                        Rectangle {
                            visible: catCombo.open
                            anchors.top: parent.bottom; anchors.topMargin: 4
                            width: parent.width
                            height: catList.implicitHeight + 12
                            radius: Theme.radiusMd
                            color: Qt.rgba(0.05, 0.06, 0.14, 0.98)
                            border.color: Theme.border2; border.width: 1
                            z: 100
                            Column {
                                id: catList
                                width: parent.width - 12
                                x: 6; y: 6
                                spacing: 0
                                Repeater {
                                    model: catCombo.options
                                    delegate: Rectangle {
                                        width: parent.width; height: 34; radius: 8
                                        color: hov.containsMouse ? Theme.cardHover : "transparent"
                                        Behavior on color { ColorAnimation { duration: 100 } }
                                        Text {
                                            anchors.right: parent.right; anchors.rightMargin: 10
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: modelData.label
                                            color: catCombo.current === modelData.key ? Theme.violetSoft : Theme.text2
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 13
                                        }
                                        HoverHandler { id: hov }
                                        TapHandler {
                                            onTapped: { catCombo.current = modelData.key; catCombo.open = false }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 12

                GlassInput {
                    id: priceInput
                    Layout.fillWidth: true
                    label: "قیمت فروش (تومان)"
                    placeholder: "25,000"
                    icon: "💴"
                    numeric: true
                    nextField: buyPriceInput
                }
                GlassInput {
                    id: buyPriceInput
                    Layout.fillWidth: true
                    label: "قیمت خرید (تومان)"
                    placeholder: "10,000"
                    icon: "🧾"
                    numeric: true
                    nextField: stockInput
                }
                GlassInput {
                    id: stockInput
                    Layout.preferredWidth: 160
                    label: "موجودی (-1 = ∞)"
                    placeholder: "-1"
                    icon: "📦"
                    onSubmitted: root.confirm()
                }
            }

            // Profit hint
            Text {
                Layout.fillWidth: true
                visible: priceInput.rawDigits && buyPriceInput.rawDigits
                text: {
                    const p = Number(priceInput.rawDigits) || 0;
                    const b = Number(buyPriceInput.rawDigits) || 0;
                    const profit = p - b;
                    const margin = p > 0 ? Math.round((profit / p) * 100) : 0;
                    return profit >= 0
                        ? `سود هر فروش: ${Currency.grouped(String(profit))} ${Currency.label()} (${margin}%)`
                        : `⚠️ ضرر هر فروش: ${Currency.grouped(String(-profit))} ${Currency.label()}`;
                }
                color: (Number(priceInput.rawDigits) || 0) >= (Number(buyPriceInput.rawDigits) || 0)
                       ? Theme.green : Theme.red
                font.family: Theme.fontFamily
                font.pixelSize: 12
                horizontalAlignment: Text.AlignRight
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 10
                GlassButton { Layout.fillWidth: true; text: "انصراف"; variant: "ghost"; onClicked: { root.open = false; root.closed() } }
                GlassButton {
                    Layout.fillWidth: true
                    text: root.mode === "create" ? "✓ افزودن" : "✓ ذخیره"
                    onClicked: root.confirm()
                }
            }
        }
    }

    function confirm() {
        if (!nameInput.text.trim()) return;
        const payload = {
            name:      nameInput.text.trim(),
            price:     Currency.tomanInputToRial(priceInput.text),
            buy_price: Currency.tomanInputToRial(buyPriceInput.text),
            emoji:     emojiBox.current,
            category:  catCombo.current,
            stock:     Number(stockInput.text) || -1,
            active:    1,
        };
        root.submitted(payload);
        root.open = false;
        root.closed();
    }
}
