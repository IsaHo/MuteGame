// SettingsPage — system configuration. Loads from /api/settings on mount,
// edits stay local until the user hits "ذخیره". Save POSTs the full settings
// object back; the server upserts and broadcasts settings:update so other
// admins / clients pick up pricing/currency changes live.
//
// Sections (responsive 2-col → 1-col below 1100px):
//   ▸ اطلاعات گیم‌نت  (name / address / phone — for receipts)
//   ▸ قیمت‌گذاری بازی  (price/hour + peak multiplier + peak window)
//   ▸ ساعت تخفیف     (off-peak multiplier + window)
//   ▸ تخفیف رده‌بندی  (tier1/2/3 percent)
//   ▸ کاربران بدحساب (bad-payer threshold days)
//   ▸ واحد پول       (rial / toman display preference)
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    property var settings: ({})
    property bool loading: true
    property bool saving:  false

    readonly property bool compact: page.width < Theme.bpLg

    // Convenience getters with sensible fallbacks
    function s(k, def) {
        const v = page.settings[k];
        return (v === undefined || v === null || v === "") ? def : v;
    }

    Component.onCompleted: Api.getSettings()

    Connections {
        target: Api
        function onSettingsLoaded(obj) {
            page.settings = obj || {};
            page.loading = false;
            // Pre-fill the inputs from server values
            cafeNameI.text   = page.s("cafe_name", "MuteGame");
            cafeAddrI.text   = page.s("cafe_address", "");
            cafePhoneI.text  = page.s("cafe_phone", "");
            priceHourI.text  = String(page.s("gaming_price_per_hour", 30000));
            peakMultI.text   = String(page.s("gaming_peak_multiplier", 1.5));
            peakStartI.text  = String(page.s("gaming_peak_start", 18));
            peakEndI.text    = String(page.s("gaming_peak_end", 23));
            offpkMultI.text  = String(page.s("gaming_offpeak_multiplier", 0.7));
            offpkStartI.text = String(page.s("gaming_offpeak_start", 0));
            offpkEndI.text   = String(page.s("gaming_offpeak_end", 12));
            tier1I.text      = String(page.s("tier1_discount", 10));
            tier2I.text      = String(page.s("tier2_discount", 7));
            tier3I.text      = String(page.s("tier3_discount", 5));
            badPayerI.text   = String(page.s("bad_payer_days", 7));
            currencyUnit     = page.s("currency_unit", "rial");
            kioskPwdI.text   = String(page.s("client_admin_password", "1234"));
            kioskPwdConfirmI.text = "";
        }
        function onSettingsSaved(ok, err) {
            page.saving = false;
            if (ok) toast.show("تنظیمات ذخیره شد ✅", "success");
            else    toast.show("خطا در ذخیره: " + err, "error");
        }
    }

    property string currencyUnit: "rial"

    function buildPayload() {
        return {
            cafe_name:                cafeNameI.text,
            cafe_address:             cafeAddrI.text,
            cafe_phone:               cafePhoneI.text,
            gaming_price_per_hour:    Number(String(priceHourI.text).replace(/,/g, "")) || 0,
            gaming_peak_multiplier:   Number(peakMultI.text)  || 1,
            gaming_peak_start:        Number(peakStartI.text) || 0,
            gaming_peak_end:          Number(peakEndI.text)   || 0,
            gaming_offpeak_multiplier:Number(offpkMultI.text) || 1,
            gaming_offpeak_start:     Number(offpkStartI.text)|| 0,
            gaming_offpeak_end:       Number(offpkEndI.text)  || 0,
            tier1_discount:           Number(tier1I.text)     || 0,
            tier2_discount:           Number(tier2I.text)     || 0,
            tier3_discount:           Number(tier3I.text)     || 0,
            bad_payer_days:           Number(badPayerI.text)  || 7,
            currency_unit:            page.currencyUnit,
            client_admin_password:    kioskPwdI.text || "1234"
        };
    }

    function save() {
        // Validate kiosk admin password — confirm field must match if changed
        if (kioskPwdConfirmI.text.length > 0 && kioskPwdConfirmI.text !== kioskPwdI.text) {
            toast.show("⚠ رمز ادمین کلاینت و تکرارش یکی نیستن", "error");
            return;
        }
        if (kioskPwdI.text.length < 4) {
            toast.show("⚠ رمز ادمین کلاینت حداقل ۴ کاراکتر", "error");
            return;
        }
        page.saving = true;
        Api.saveSettings(buildPayload());
    }

    BgEffects {}

    // Loading overlay
    Rectangle {
        visible: page.loading
        anchors.fill: parent
        color: "transparent"
        z: 100
        Text {
            anchors.centerIn: parent
            text: "⏳ در حال بارگذاری تنظیمات…"
            color: Theme.text3
            font.family: Theme.fontFamily
            font.pixelSize: 14
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14
        visible: !page.loading

        // Topbar
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Text {
                text: "تنظیمات سیستم"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Text {
                text: "  ·  پیکربندی گیم‌نت"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }

            Item { Layout.fillWidth: true }

            GlassButton {
                text: page.saving ? "⏳ ذخیره…" : "💾 ذخیره همه تنظیمات"
                variant: "primary"
                enabled: !page.saving
                onClicked: page.save()
            }
        }

        // Two-column body using ScrollView so long forms stay accessible
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth

            GridLayout {
                width: parent.width
                columns: page.compact ? 1 : 2
                columnSpacing: 14
                rowSpacing: 14

                // ── Cafe info ─────────────────────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.cyan
                    iconText: "🏪"
                    title: "اطلاعات گیم‌نت"
                    subtitle: "در گزارشات و رسیدها نمایش داده می‌شه"

                    Column {
                        width: parent.width
                        spacing: 12
                        Column { width: parent.width; spacing: 4
                            Text { text: "نام گیم‌نت"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: cafeNameI; width: parent.width; placeholder: "MuteGame" }
                        }
                        Column { width: parent.width; spacing: 4
                            Text { text: "آدرس"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: cafeAddrI; width: parent.width; placeholder: "آدرس گیم‌نت…" }
                        }
                        Column { width: parent.width; spacing: 4
                            Text { text: "شماره تلفن"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: cafePhoneI; width: parent.width; placeholder: "021xxxxxxxx" }
                        }
                    }
                }

                // ── Gaming pricing ─────────────────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.violet
                    iconText: "🎮"
                    title: "قیمت‌گذاری ساعت بازی"
                    subtitle: "هزینه بازی به ازای هر ساعت (ریال)"

                    Column {
                        width: parent.width
                        spacing: 12
                        Column { width: parent.width; spacing: 4
                            Text { text: "قیمت هر ساعت (ریال)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: priceHourI; width: parent.width; numeric: true; placeholder: "30000" }
                            Text {
                                text: "معادل: " + Currency.format(Math.ceil((Number(String(priceHourI.text).replace(/,/g,'')) || 0) / 60)) + " در دقیقه"
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 10
                            }
                        }

                        // Quick price preview (30/60/120 min)
                        Row {
                            width: parent.width
                            spacing: 8
                            Repeater {
                                model: [
                                    { l: "۳۰ دقیقه", m: 30 },
                                    { l: "۱ ساعت",   m: 60 },
                                    { l: "۲ ساعت",   m: 120 }
                                ]
                                delegate: Rectangle {
                                    width: (parent.width - parent.spacing * 2) / 3; height: 50; radius: 10
                                    color: Theme.bg2
                                    border.color: Theme.border; border.width: 1
                                    Column {
                                        anchors.centerIn: parent; spacing: 4
                                        Text { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.l; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10 }
                                        Text {
                                            anchors.horizontalCenter: parent.horizontalCenter
                                            text: Currency.format(Math.ceil(((Number(String(priceHourI.text).replace(/,/g,'')) || 0) / 60) * modelData.m))
                                            color: Theme.violetSoft
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 11
                                            font.weight: Font.Bold
                                        }
                                    }
                                }
                            }
                        }

                        // Divider
                        Rectangle { width: parent.width; height: 1; color: Theme.border; opacity: 0.5 }

                        // Peak multiplier
                        Column { width: parent.width; spacing: 4
                            Text { text: "ضریب ساعت شلوغ (peak)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            Row { width: parent.width; spacing: 8
                                GlassInput { id: peakMultI; width: parent.width - 70; placeholder: "1.5" }
                                Rectangle {
                                    width: 62; height: 46; radius: 10
                                    color: Qt.rgba(0.96, 0.62, 0.04, 0.10)
                                    border.color: Qt.rgba(0.96, 0.62, 0.04, 0.30); border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { anchors.centerIn: parent; text: "×" + peakMultI.text; color: Theme.amber; font.family: Theme.fontFamilyEn; font.pixelSize: 13; font.weight: Font.Bold }
                                }
                            }
                        }
                        Row { width: parent.width; spacing: 10
                            Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                                Text { text: "شروع شلوغ (ساعت)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                                GlassInput { id: peakStartI; width: parent.width; placeholder: "18" }
                            }
                            Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                                Text { text: "پایان شلوغ (ساعت)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                                GlassInput { id: peakEndI; width: parent.width; placeholder: "23" }
                            }
                        }
                        Rectangle {
                            width: parent.width; height: 50; radius: 10
                            color: Qt.rgba(0.96, 0.62, 0.04, 0.08)
                            border.color: Qt.rgba(0.96, 0.62, 0.04, 0.22); border.width: 1
                            Row {
                                anchors.fill: parent
                                anchors.margins: 12
                                layoutDirection: Qt.RightToLeft
                                spacing: 8
                                Text { text: "⚡ " + peakStartI.text + ":00 تا " + peakEndI.text + ":00"; color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                                Item { Layout.fillWidth: true; width: 1 }
                                Text { text: Currency.format((Number(String(priceHourI.text).replace(/,/g,'')) || 0) * (Number(peakMultI.text) || 1)); color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            }
                        }
                    }
                }

                // ── Off-peak (تخفیف ساعت آرام) ─────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.green
                    iconText: "🟢"
                    title: "ساعت‌های تخفیف (Off-peak)"
                    subtitle: "در این ساعات قیمت پایین‌تر اعمال می‌شه"

                    Column {
                        width: parent.width
                        spacing: 12
                        Column { width: parent.width; spacing: 4
                            Text { text: "ضریب تخفیف (مثلاً 0.7 = ۳۰٪ تخفیف)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: offpkMultI; width: parent.width; placeholder: "0.7" }
                        }
                        Row { width: parent.width; spacing: 10
                            Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                                Text { text: "شروع تخفیف"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                                GlassInput { id: offpkStartI; width: parent.width; placeholder: "0" }
                            }
                            Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                                Text { text: "پایان تخفیف"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                                GlassInput { id: offpkEndI; width: parent.width; placeholder: "12" }
                            }
                        }
                        Rectangle {
                            visible: Number(offpkMultI.text) > 0 && Number(offpkMultI.text) < 1
                            width: parent.width; height: 50; radius: 10
                            color: Qt.rgba(0.06, 0.73, 0.51, 0.10)
                            border.color: Qt.rgba(0.06, 0.73, 0.51, 0.25); border.width: 1
                            Row {
                                anchors.fill: parent
                                anchors.margins: 12
                                layoutDirection: Qt.RightToLeft
                                spacing: 8
                                Text { text: "🟢 " + offpkStartI.text + ":00 تا " + offpkEndI.text + ":00"; color: Theme.green; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                                Item { width: 8; height: 1 }
                                Text { text: Currency.format(Math.round((Number(String(priceHourI.text).replace(/,/g,'')) || 0) * (Number(offpkMultI.text) || 1))); color: Theme.green; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            }
                        }
                    }
                }

                // ── Tier discounts ─────────────────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.amber
                    iconText: "🏆"
                    title: "تخفیف رده‌بندی کاربران"
                    subtitle: "بر اساس بیشترین زمان بازی"

                    Column {
                        width: parent.width
                        spacing: 12

                        // Rank 1
                        Column { width: parent.width; spacing: 4
                            Text { text: "🥇 رتبه اول"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                            Row { width: parent.width; spacing: 8
                                GlassInput { id: tier1I; width: parent.width - 92; placeholder: "10" }
                                Rectangle {
                                    width: 84; height: 46; radius: 10
                                    color: Theme.bg2
                                    border.color: Theme.border; border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { anchors.centerIn: parent; text: tier1I.text + "% تخفیف"; color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                                }
                            }
                        }
                        // Rank 2
                        Column { width: parent.width; spacing: 4
                            Text { text: "🥈 رتبه دوم"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                            Row { width: parent.width; spacing: 8
                                GlassInput { id: tier2I; width: parent.width - 92; placeholder: "7" }
                                Rectangle {
                                    width: 84; height: 46; radius: 10
                                    color: Theme.bg2
                                    border.color: Theme.border; border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { anchors.centerIn: parent; text: tier2I.text + "% تخفیف"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                                }
                            }
                        }
                        // Rank 3
                        Column { width: parent.width; spacing: 4
                            Text { text: "🥉 رتبه سوم"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                            Row { width: parent.width; spacing: 8
                                GlassInput { id: tier3I; width: parent.width - 92; placeholder: "5" }
                                Rectangle {
                                    width: 84; height: 46; radius: 10
                                    color: Theme.bg2
                                    border.color: Theme.border; border.width: 1
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text { anchors.centerIn: parent; text: tier3I.text + "% تخفیف"; color: "#cd7f32"; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                                }
                            }
                        }
                        Rectangle { width: parent.width; height: 1; color: Theme.border; opacity: 0.5 }
                        Text {
                            width: parent.width
                            text: "💡 تخفیف هنگام شارژ اعتبار اعمال می‌شه — اگه کاربر تخفیف فردی هم داشته باشه، بالاترین تخفیف اعمال می‌شه."
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 11
                            wrapMode: Text.Wrap
                        }
                    }
                }

                // ── Currency unit ──────────────────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.violet
                    iconText: "💰"
                    title: "واحد پول"
                    subtitle: "قیمت‌ها همیشه ریال ذخیره می‌شن، فقط نمایش عوض می‌شه"

                    Column {
                        width: parent.width
                        spacing: 12
                        Row {
                            width: parent.width; spacing: 10
                            Repeater {
                                model: [
                                    { v: "rial",  label: "💵 ریال" },
                                    { v: "toman", label: "💴 تومان" }
                                ]
                                delegate: Rectangle {
                                    width: (parent.width - parent.spacing) / 2; height: 50; radius: 12
                                    property bool active: page.currencyUnit === modelData.v
                                    color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.20) : Theme.card
                                    border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.45) : Theme.border
                                    border.width: 1
                                    Behavior on color { ColorAnimation { duration: 150 } }
                                    Text {
                                        anchors.centerIn: parent
                                        text: modelData.label
                                        color: parent.active ? Theme.text : Theme.text2
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 14
                                        font.weight: Font.Bold
                                    }
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.currencyUnit = modelData.v }
                                }
                            }
                        }
                    }
                }

                // ── Bad payer threshold ────────────────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Theme.red
                    iconText: "⚠️"
                    title: "کاربران بدحساب"
                    subtitle: "آستانه روزها برای علامت‌گذاری"

                    Column {
                        width: parent.width
                        spacing: 12
                        Column { width: parent.width; spacing: 4
                            Text { text: "نمایش کاربران با بدهی بیش از (روز)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: badPayerI; width: parent.width; placeholder: "7" }
                            Text {
                                text: "کاربری که بیش از " + (badPayerI.text || "7") + " روزه بدهی داره نشون داده می‌شه"
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 10
                            }
                        }
                    }
                }

                // ── Client (kiosk) admin password ──────────────────
                SettingsCard {
                    Layout.fillWidth: true
                    Layout.preferredWidth: 100
                    Layout.horizontalStretchFactor: 1
                    accent: Qt.rgba(0.929, 0.282, 0.6, 1.0)
                    iconText: "🔐"
                    title: "رمز پنل ادمین کلاینت"
                    subtitle: "رمز خروج از کیوسک با Ctrl+Shift+X — روی همه کلاینت‌ها sync می‌شه"

                    Column {
                        width: parent.width
                        spacing: 12
                        Column { width: parent.width; spacing: 4
                            Text { text: "رمز جدید (حداقل ۴ کاراکتر)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: kioskPwdI; width: parent.width; placeholder: "1234"; password: true }
                        }
                        Column { width: parent.width; spacing: 4
                            Text { text: "تکرار رمز (در صورت تغییر)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: kioskPwdConfirmI; width: parent.width; placeholder: "اگه نمی‌خوای رمز عوض شه خالی بذار"; password: true }
                        }
                        Rectangle {
                            visible: kioskPwdConfirmI.text.length > 0 && kioskPwdConfirmI.text !== kioskPwdI.text
                            width: parent.width; height: 36; radius: 8
                            color: Qt.rgba(1, 0.27, 0.27, 0.10)
                            border.color: Qt.rgba(1, 0.27, 0.27, 0.30); border.width: 1
                            Text {
                                anchors.centerIn: parent
                                text: "⚠ رمز و تکرارش یکی نیستن"
                                color: Theme.red
                                font.family: Theme.fontFamily
                                font.pixelSize: 11
                                font.weight: Font.Bold
                            }
                        }
                        Text {
                            width: parent.width
                            text: "💡 با ذخیره، این رمز به کل کلاینت‌ها فرستاده می‌شه (settings:update). اگه کلاینتی آفلاین باشه، دفعه بعد که آنلاین بشه پیش‌فرضش بروز می‌شه."
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 11
                            wrapMode: Text.Wrap
                        }
                    }
                }
            }
        }
    }

    Toast { id: toast }

    // Card helper component — every section uses this shape.
    // Children declared inside a SettingsCard {} get added to `bodyCol`
    // automatically via the default property alias.
    component SettingsCard: GlassCard {
        id: card
        property string iconText: ""
        property string title: ""
        property string subtitle: ""
        default property alias content: bodyCol.children
        accent: Theme.violet

        // Sum of header (60) + body content + margins (36)
        implicitHeight: 60 + bodyCol.implicitHeight + 36

        Column {
            anchors.fill: parent
            anchors.margins: 18
            spacing: 14

            Row {
                width: parent.width
                spacing: 12
                layoutDirection: Qt.RightToLeft

                Rectangle {
                    width: 48; height: 48; radius: 12
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(card.accent.r, card.accent.g, card.accent.b, 0.14)
                    border.color: Qt.rgba(card.accent.r, card.accent.g, card.accent.b, 0.32)
                    border.width: 1
                    Text { anchors.centerIn: parent; text: card.iconText; font.pixelSize: 22 }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Text { text: card.title; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 14; font.weight: Font.Bold }
                    Text { text: card.subtitle; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                }
            }

            Column {
                id: bodyCol
                width: parent.width
                spacing: 12
            }
        }
    }
}
