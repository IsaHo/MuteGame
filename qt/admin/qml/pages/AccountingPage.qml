// AccountingPage — simple/modern financial cockpit (QuickBooks/Xero-inspired).
//
// Design goals (rewrite from scratch):
//   • 3 first-class tabs: درآمد (income), هزینه (expense), بدهی (debt)
//   • 4 big KPI cards at the top (always visible across all tabs)
//   • StackLayout for tab body — no anchor overlap, clean transitions
//   • Debt tab is fully wired: KPIs + debtors list + recent debt transactions
//   • Inline-add for expenses, no large form pane
//
// All data sources are pre-existing:
//   Api.getRevenueReport / getShopReport / getShopProfit / getUsers
//   Api.getDebtors       / getDebtTransactions
//   Api.payDebt          (rial-denominated)
//   Expenses singleton   (.items, .addExpense, .updateExpense, .removeExpense)
//
// Period selector at the top drives every query and is the single source of
// truth for the date range. Auto-refresh every 60s + immediate fetch on
// period change + live refresh on `clients:update` socket events.

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    // ── State ────────────────────────────────────────────────────────
    property int    period: 30           // 0 = today, else N days
    property int    tabIndex: 0          // 0 income · 1 expense · 2 debt · 3 shift · 4 reconciliation

    // ── Shift state ─────────────────────────────────────────────────
    property var    shiftData:     null   // null=no open shift, object=current open shift
    property var    shiftPreview:  null   // previewShift response body
    property var    shiftHistory:  []     // recent closed+open shifts
    property var    reconSummary:  ({ total_users: 0, drifted: 0, baseline_only: 0, total_drift_magnitude: 0 })
    property var    reconRows:     []
    property bool   reconDriftOnly: false

    property var revenueRows:    []
    property var shopRows:       []
    property var shopProfit:     ({ totalRevenue: 0, totalCost: 0, grossProfit: 0, totalItems: 0, ordersCount: 0 })
    property var debtors:        []
    property var debtTxns:       []
    property var serverExpenses: []   // populated by Api.getExpenses

    readonly property bool compact: page.width < Theme.bpLg

    // ── Derived totals ───────────────────────────────────────────────
    // Cash-basis income = fresh charges + shop sales + debt collections.
    // Server's /api/reports/revenue now returns `charged` (type='charge') and
    // `debtPaid` (type='debt_pay') as separate columns so Dashboard/Reports
    // keep showing only `charged` while accounting sees the full picture.
    readonly property real totalChargeRevenue: revenueRows.reduce((s, r) => s + (r.charged || 0), 0)
    readonly property real totalDebtRevenue:   revenueRows.reduce((s, r) => s + (r.debtPaid || 0), 0)
    readonly property real totalShopRevenue:   shopRows.reduce((s, r) => s + (r.revenue || 0), 0)
    readonly property real totalIncome:        totalChargeRevenue + totalShopRevenue + totalDebtRevenue

    readonly property real totalUserDebt: debtors.reduce((s, u) => s + Number(u.debt || 0), 0)

    readonly property real totalDebtAdded: debtTxns
        .filter(t => t.type === "debt_add").reduce((s, t) => s + Number(t.amount || 0), 0)
    readonly property real totalDebtPaid: debtTxns
        .filter(t => t.type === "debt_pay").reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0)

    // Server already date-filters via getExpenses(dateFrom, dateTo).
    readonly property var  periodExpenses: serverExpenses
    readonly property real totalExpenses:  periodExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
    readonly property real netProfit:     totalIncome - totalExpenses
    readonly property real marginPct:     totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

    // Combined daily series for the income chart — three cash streams.
    readonly property var combinedDaily: {
        const map = {};
        for (const r of revenueRows) map[r.date] = { date: r.date, charge: r.charged || 0, debt: r.debtPaid || 0, shop: 0 };
        for (const s of shopRows) {
            if (!map[s.date]) map[s.date] = { date: s.date, charge: 0, debt: 0, shop: 0 };
            map[s.date].shop = s.revenue || 0;
        }
        return Object.values(map).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }

    // ── Polling ──────────────────────────────────────────────────────
    function refreshShift() {
        Api.getOpenShift()
        Api.getShifts(10)
    }
    function refreshReconciliation() {
        Api.getReconciliationSummary()
        Api.getReconciliationUsers(page.reconDriftOnly, 100, 0)
    }
    function refreshExpenses() {
        const today = new Date().toISOString().split('T')[0]
        if (page.period === 0) {
            Api.getExpenses(today, today)
        } else {
            const from = new Date()
            from.setDate(from.getDate() - page.period)
            Api.getExpenses(from.toISOString().split('T')[0], today)
        }
    }
    function refresh() {
        const days = page.period === 0 ? 1 : page.period;
        Api.getRevenueReport(days);
        Api.getShopReport(days);
        Api.getShopProfit(days);
        Api.getDebtors();
        Api.getDebtTransactions(days);
        refreshExpenses();
    }

    // Snapshot of how many items were sent in the current migration attempt.
    property int _migrationBatchSize: 0

    Component.onCompleted: {
        refresh()
        refreshShift()
        // One-time migration: import local QSettings expenses to server.
        // Runs only if flag is not set. Empty store marks as done immediately.
        // On network failure nothing is marked — retry happens next login.
        if (Expenses.needsServerMigration()) {
            const items = Expenses.migrationItems()
            if (items.length === 0) {
                Expenses.markServerMigrationComplete()
            } else {
                page._migrationBatchSize = items.length
                Api.importExpenses(items)
            }
        }
    }
    onPeriodChanged: refresh()
    onTabIndexChanged: if (tabIndex === 4) refreshReconciliation()
    onReconDriftOnlyChanged: if (tabIndex === 4) Api.getReconciliationUsers(reconDriftOnly, 100, 0)

    Timer { interval: 60000; running: true; repeat: true; onTriggered: page.refresh() }

    Connections {
        target: Api
        function onRevenueDone(rows)         { page.revenueRows = rows }
        function onShopReportDone(rows)      { page.shopRows = rows }
        function onShopProfitDone(p)         { page.shopProfit = p }
        function onDebtorsDone(rows)         { page.debtors = rows }
        function onDebtTransactionsDone(arr) { page.debtTxns = arr }
        function onUserMutationDone(ok) {
            if (ok) {
                // Any user-finance mutation (charge, debt add/pay, post-pay
                // toggle) potentially shifts revenue/debt aggregates — refresh
                // the whole panel so KPIs (especially "کل درآمد" which now
                // includes debt collections) update instantly without waiting
                // for the 60s timer.
                const days = page.period === 0 ? 1 : page.period;
                Api.getRevenueReport(days);
                Api.getDebtors();
                Api.getDebtTransactions(days);
            }
        }
        function onGetExpensesDone(ok, body) {
            if (ok) page.serverExpenses = body.expenses || []
        }
        function onOpenShiftLoaded(shift)    { page.shiftData = shift }
        function onOpenShiftNotFound()       { page.shiftData = null }
        function onShiftOpened(shift)        { page.shiftData = shift; page.shiftPreview = null; page.refreshShift(); toast.show("شیفت باز شد ✅", "success") }
        function onOpenShiftFailed(err)      { toast.show(err || "خطا در باز کردن شیفت", "error") }
        function onShiftPreviewReady(p)      { page.shiftPreview = p }
        function onShiftPreviewFailed(err)   { toast.show(err || "خطا در پیش‌نمایش", "error") }
        function onShiftClosed(shift, already) {
            page.shiftData = null; page.shiftPreview = null; page.refreshShift()
            toast.show(already ? "شیفت قبلاً بسته شده بود" : "شیفت بسته شد ✅", "success")
        }
        function onShiftCloseFailed(err)     { toast.show(err || "خطا در بستن شیفت", "error") }
        function onShiftsLoaded(arr)         { page.shiftHistory = arr }
        function onReconciliationSummaryDone(ok, body) {
            if (ok) page.reconSummary = body
            else toast.show(body.error || "خطا در گزارش تطبیق", "error")
        }
        function onReconciliationUsersDone(ok, body) {
            if (ok) page.reconRows = body.rows || []
            else toast.show(body.error || "خطا در دریافت مغایرت‌ها", "error")
        }
        function onReconciliationLedgerDone(ok, body) {
            if (ok) reconciliationModal.ledgerRows = body.rows || []
            else toast.show(body.error || "خطا در دریافت دفتر کاربر", "error")
        }
        function onReconciliationCorrectionDone(ok, body) {
            if (ok) {
                reconciliationModal.open = false
                toast.show("اصلاح مغایرت ثبت شد ✅", "success")
                page.refreshReconciliation()
            } else {
                toast.show(body.error || "اصلاح مغایرت انجام نشد", "error")
            }
        }
        function onCreateExpenseDone(ok, body) {
            if (ok) { toast.show("ثبت شد ✅", "success"); expForm.reset(); page.refreshExpenses() }
            else toast.show(body.error || "خطا در ثبت هزینه", "error")
        }
        function onUpdateExpenseDone(ok, body) {
            if (ok) { toast.show("ذخیره شد ✅", "success"); expForm.reset(); page.refreshExpenses() }
            else toast.show(body.error || "خطا در ویرایش هزینه", "error")
        }
        function onVoidExpenseDone(ok, body) {
            if (ok) { toast.show("حذف شد", "success"); page.refreshExpenses() }
            else toast.show(body.error || "خطا در حذف هزینه", "error")
        }
        function onImportExpensesDone(ok, body) {
            // Only mark complete when every item was either imported or already existed.
            // HTTP 400 or count mismatch keeps the local data for a later retry.
            if (ok && (body.imported + body.skipped) === page._migrationBatchSize) {
                Expenses.markServerMigrationComplete()
                page.refreshExpenses()
            } else {
                toast.show(body.error || "انتقال هزینه‌های قبلی کامل نشد؛ اطلاعات محلی محفوظ است", "error")
            }
        }
    }
    Connections {
        target: Socket
        function onMessageReceived(name) {
            if (name === "clients:update") Api.getDebtors();
        }
    }

    BgEffects {}

    // ── Page content ────────────────────────────────────────────────
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 16

        // Title + period selector
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Text {
                text: "حسابداری"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Text {
                text: "  ·  " + (page.period === 0 ? "امروز" : page.period + " روز اخیر")
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }

            Item { Layout.fillWidth: true }

            Row {
                spacing: 6
                Repeater {
                    model: [
                        { d: 0,   l: "امروز" },
                        { d: 7,   l: "۷ روز" },
                        { d: 30,  l: "۳۰ روز" },
                        { d: 90,  l: "۹۰ روز" },
                        { d: 365, l: "۱ سال" }
                    ]
                    delegate: Rectangle {
                        height: 30; radius: 15
                        width: pl.implicitWidth + 22
                        property bool active: page.period === modelData.d
                        color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.18) : Theme.card
                        border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                        border.width: 1
                        Behavior on color { ColorAnimation { duration: 150 } }
                        Text {
                            id: pl
                            anchors.centerIn: parent
                            text: modelData.l
                            color: parent.active ? Theme.text : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 11
                            font.weight: Font.Bold
                        }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.period = modelData.d }
                    }
                }
            }
        }

        // ── KPI strip — 4 big cards always visible
        GridLayout {
            Layout.fillWidth: true
            columns: page.compact ? 2 : 4
            columnSpacing: 14
            rowSpacing: 14

            AccKpi {
                Layout.fillWidth: true
                iconText: "💰"; label: "کل درآمد"
                value: Currency.format(page.totalIncome)
                sub: "شارژ + شاپ"
                accent: Theme.green
            }
            AccKpi {
                Layout.fillWidth: true
                iconText: "💸"; label: "کل هزینه"
                value: Currency.format(page.totalExpenses)
                sub: page.periodExpenses.length + " ردیف"
                accent: Theme.amber
            }
            AccKpi {
                Layout.fillWidth: true
                iconText: page.netProfit >= 0 ? "📈" : "📉"
                label: "سود خالص"
                value: (page.netProfit >= 0 ? "+" : "") + Currency.format(page.netProfit)
                sub: "حاشیه " + page.marginPct.toFixed(1) + "%"
                accent: page.netProfit >= 0 ? Theme.green : Theme.red
            }
            AccKpi {
                Layout.fillWidth: true
                iconText: "💳"; label: "بدهی شبکه"
                value: Currency.format(page.totalUserDebt)
                sub: page.debtors.length + " بدهکار"
                accent: page.totalUserDebt > 0 ? Theme.red : Theme.text3
            }
        }

        // ── Tab strip
        Row {
            Layout.fillWidth: true
            spacing: 6
            Repeater {
                model: [
                    { key: 0, label: "💰 درآمد",  color: Theme.green },
                    { key: 1, label: "💸 هزینه",  color: Theme.amber },
                    { key: 2, label: "💳 بدهی",   color: Theme.red },
                    { key: 3, label: "🔄 شیفت",   color: Theme.violet },
                    { key: 4, label: "⚖ تطبیق حساب", color: Theme.cyan }
                ]
                delegate: Rectangle {
                    height: 38; radius: 12
                    width: tlab.implicitWidth + 36
                    property bool active: page.tabIndex === modelData.key
                    color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.16) : Theme.card
                    border.color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.40) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 160 } }

                    Text {
                        id: tlab
                        anchors.centerIn: parent
                        text: modelData.label
                        color: parent.active ? Theme.text : Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 13
                        font.weight: Font.Bold
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.tabIndex = modelData.key }
                }
            }
        }

        // ── Tab body — StackLayout (clean, no overlap) ────────────────
        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: page.tabIndex

            // ────────── Tab 0 — درآمد ──────────
            ColumnLayout {
                spacing: 14

                // Income breakdown card — three cash streams + sub note
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 140
                    accent: Theme.green
                    Item {
                        anchors.fill: parent
                        anchors.margins: 20
                        Row {
                            anchors.fill: parent
                            spacing: 22
                            layoutDirection: Qt.RightToLeft

                            // Charge revenue
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 6
                                Row {
                                    spacing: 8; layoutDirection: Qt.RightToLeft
                                    Text { text: "🔋"; font.pixelSize: 18 }
                                    Text { text: "درآمد شارژ"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Text {
                                    text: Currency.format(page.totalChargeRevenue)
                                    color: Theme.violetSoft
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 20
                                    font.weight: Font.Black
                                }
                            }

                            Rectangle { width: 1; height: 80; color: Theme.border; anchors.verticalCenter: parent.verticalCenter }

                            // Shop revenue
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 6
                                Row {
                                    spacing: 8; layoutDirection: Qt.RightToLeft
                                    Text { text: "🛒"; font.pixelSize: 18 }
                                    Text { text: "درآمد شاپ"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Text {
                                    text: Currency.format(page.totalShopRevenue)
                                    color: Theme.cyanSoft
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 20
                                    font.weight: Font.Black
                                }
                            }

                            Rectangle { width: 1; height: 80; color: Theme.border; anchors.verticalCenter: parent.verticalCenter }

                            // Debt collections (cash from prior debt)
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 6
                                Row {
                                    spacing: 8; layoutDirection: Qt.RightToLeft
                                    Text { text: "💵"; font.pixelSize: 18 }
                                    Text { text: "درآمد پرداخت بدهی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Text {
                                    text: Currency.format(page.totalDebtRevenue)
                                    color: Theme.green
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 20
                                    font.weight: Font.Black
                                }
                                Text {
                                    text: page.totalIncome > 0
                                          ? (page.totalDebtRevenue / page.totalIncome * 100).toFixed(1) + "% از کل درآمد"
                                          : "—"
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 10
                                }
                            }

                            Rectangle { width: 1; height: 80; color: Theme.border; anchors.verticalCenter: parent.verticalCenter }

                            // Gross profit (shop)
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 6
                                Row {
                                    spacing: 8; layoutDirection: Qt.RightToLeft
                                    Text { text: "📦"; font.pixelSize: 18 }
                                    Text { text: "سود ناخالص شاپ"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
                                }
                                Text {
                                    text: Currency.format(page.shopProfit.grossProfit || 0)
                                    color: (page.shopProfit.grossProfit || 0) >= 0 ? Theme.green : Theme.red
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 20
                                    font.weight: Font.Black
                                }
                            }

                            Item { width: 14; height: 1 }

                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "💰"
                                font.pixelSize: 50
                                opacity: 0.30
                            }
                        }
                    }
                }

                // Daily revenue chart
                GlassCard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: 220
                    accent: Theme.violet

                    Item {
                        anchors.fill: parent
                        anchors.margins: 20

                        Row {
                            id: chHeader
                            anchors.top: parent.top
                            anchors.right: parent.right
                            anchors.left: parent.left
                            height: 26
                            spacing: 10
                            layoutDirection: Qt.RightToLeft
                            Text {
                                text: "📊 درآمد روزانه"
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: 14
                                font.weight: Font.Bold
                            }
                            Text {
                                text: page.combinedDaily.length + " روز"
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 11
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }

                        Text {
                            visible: page.combinedDaily.length === 0
                            anchors.centerIn: parent
                            text: "هنوز داده‌ای نیست"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 13
                        }

                        LineChart {
                            visible: page.combinedDaily.length > 0
                            anchors.top: chHeader.bottom
                            anchors.topMargin: 12
                            anchors.right: parent.right
                            anchors.left: parent.left
                            anchors.bottom: parent.bottom
                            accent: Theme.violetSoft
                            // rial → toman for the y-axis label
                            series: page.combinedDaily.map(d => ({ date: d.date, value: Math.round(((d.charge || 0) + (d.shop || 0) + (d.debt || 0)) / 10) }))
                        }
                    }
                }
            }

            // ────────── Tab 1 — هزینه ──────────
            ColumnLayout {
                spacing: 14

                // Inline-add bar
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 78
                    accent: Theme.amber

                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 14
                        spacing: 10

                        // Date pill (tap → Jalali picker)
                        Rectangle {
                            Layout.preferredWidth: 170
                            Layout.preferredHeight: 46
                            radius: 10
                            color: Theme.bg2
                            border.color: dateMA.containsMouse ? Theme.border2 : Theme.border
                            border.width: 1
                            Row {
                                anchors.fill: parent
                                anchors.margins: 12
                                spacing: 8
                                layoutDirection: Qt.RightToLeft
                                Text { text: "📅"; font.pixelSize: 15; anchors.verticalCenter: parent.verticalCenter }
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: expForm.gregorianIso
                                          ? Jalali.dateFromIso(expForm.gregorianIso)
                                          : "انتخاب تاریخ"
                                    color: expForm.gregorianIso ? Theme.text : Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                    font.weight: Font.Medium
                                }
                            }
                            MouseArea {
                                id: dateMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    datePicker.isoDate = expForm.gregorianIso || "";
                                    datePicker.open = true;
                                }
                            }
                        }

                        // Category combo
                        Rectangle {
                            Layout.preferredWidth: 150
                            Layout.preferredHeight: 46
                            radius: 10
                            color: Theme.bg2
                            border.color: catMA.containsMouse ? Theme.border2 : Theme.border
                            border.width: 1
                            Row {
                                anchors.fill: parent
                                anchors.margins: 12
                                spacing: 8
                                layoutDirection: Qt.RightToLeft
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: expForm.category
                                    color: Theme.text
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                }
                                Item { Layout.fillWidth: true; width: 6; height: 1 }
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "▾"
                                    color: Theme.text3
                                    font.pixelSize: 12
                                }
                            }
                            MouseArea {
                                id: catMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: catMenu.open = !catMenu.open
                            }

                            // Dropdown
                            Rectangle {
                                id: catMenu
                                property bool open: false
                                visible: open
                                anchors.top: parent.bottom
                                anchors.topMargin: 6
                                anchors.right: parent.right
                                width: parent.width
                                height: catCol.implicitHeight + 8
                                z: 100
                                radius: 10
                                color: Theme.bg2
                                border.color: Theme.border2; border.width: 1
                                Column {
                                    id: catCol
                                    anchors.fill: parent
                                    anchors.margins: 4
                                    spacing: 0
                                    Repeater {
                                        model: ["اجاره", "برق", "اینترنت", "حقوق", "تجهیزات", "شاپ (خرید)", "تعمیرات", "سایر"]
                                        delegate: Rectangle {
                                            width: parent.width
                                            height: 30
                                            radius: 6
                                            color: itemMA.containsMouse ? Theme.cardHover : "transparent"
                                            Text {
                                                anchors.right: parent.right
                                                anchors.rightMargin: 12
                                                anchors.verticalCenter: parent.verticalCenter
                                                text: modelData
                                                color: Theme.text
                                                font.family: Theme.fontFamily
                                                font.pixelSize: 12
                                            }
                                            MouseArea {
                                                id: itemMA
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: {
                                                    expForm.category = modelData;
                                                    catMenu.open = false;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Description
                        GlassInput {
                            id: descInput
                            Layout.fillWidth: true
                            Layout.preferredHeight: 46
                            placeholder: "توضیح هزینه…"
                            text: expForm.desc
                        }

                        // Amount (rial)
                        GlassInput {
                            id: amountInput
                            Layout.preferredWidth: 180
                            Layout.preferredHeight: 46
                            placeholder: "مبلغ (ریال)"
                            numeric: true
                            text: expForm.amount
                        }

                        // Payment method selector
                        Row {
                            spacing: 4
                            Repeater {
                                model: [
                                    { key: "cash",     label: "💵" },
                                    { key: "card",     label: "💳" },
                                    { key: "transfer", label: "🏦" }
                                ]
                                delegate: Rectangle {
                                    width: 36; height: 46; radius: 8
                                    property bool active: expForm.paymentMethod === modelData.key
                                    color: active ? Qt.rgba(0.55,0.36,0.96,0.18) : Theme.bg2
                                    border.color: active ? Qt.rgba(0.55,0.36,0.96,0.40) : Theme.border
                                    border.width: 1
                                    Behavior on color { ColorAnimation { duration: 120 } }
                                    Text { anchors.centerIn: parent; text: modelData.label; font.pixelSize: 14 }
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: expForm.paymentMethod = modelData.key }
                                }
                            }
                        }

                        // Submit
                        GlassButton {
                            Layout.preferredHeight: 46
                            Layout.preferredWidth: expForm.editId > 0 ? 130 : 120
                            text: expForm.editId > 0 ? "✅ ذخیره" : "➕ ثبت"
                            variant: "primary"
                            onClicked: expForm.submit()
                        }
                        GlassButton {
                            visible: expForm.editId > 0
                            Layout.preferredHeight: 46
                            text: "لغو"
                            variant: "ghost"
                            onClicked: expForm.reset()
                        }
                    }
                }

                // Expense list
                GlassCard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    accent: Theme.red

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 8

                        Row {
                            Layout.fillWidth: true
                            spacing: 10
                            layoutDirection: Qt.RightToLeft
                            Text { text: "📋"; font.pixelSize: 18; anchors.verticalCenter: parent.verticalCenter }
                            Text { text: "هزینه‌های بازه"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 15; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            Item { width: 6; height: 1 }
                            Text { text: page.periodExpenses.length + " مورد"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; opacity: 0.5 }

                        Text {
                            visible: page.periodExpenses.length === 0
                            Layout.alignment: Qt.AlignHCenter
                            topPadding: 40
                            text: "هزینه‌ای ثبت نشده — از فرم بالا اضافه کن"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 13
                        }

                        ListView {
                            visible: page.periodExpenses.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            spacing: 4
                            clip: true
                            model: page.periodExpenses
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 50
                                radius: 8
                                color: rowMouse.containsMouse ? Theme.cardHover : "transparent"
                                border.color: Theme.border; border.width: 1
                                Behavior on color { ColorAnimation { duration: 130 } }

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 12
                                    spacing: 10
                                    layoutDirection: Qt.RightToLeft

                                    Rectangle {
                                        width: 90; height: 28; radius: 6
                                        color: Theme.bg2
                                        border.color: Theme.border; border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData.date ? Jalali.dateFromIso(modelData.date) : "—"
                                            color: Theme.text2
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 10
                                            font.weight: Font.Bold
                                        }
                                    }
                                    Rectangle {
                                        height: 22; radius: 11
                                        width: catBL.implicitWidth + 16
                                        color: Qt.rgba(0.96, 0.62, 0.04, 0.15)
                                        border.color: Qt.rgba(0.96, 0.62, 0.04, 0.35); border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { id: catBL; anchors.centerIn: parent; text: modelData.category || "سایر"; color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                                    }
                                    Text {
                                        width: parent.width - 90 - catBL.implicitWidth - 16 - 130 - 80 - 50
                                        text: modelData.desc || ""
                                        color: Theme.text
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 12
                                        anchors.verticalCenter: parent.verticalCenter
                                        elide: Text.ElideRight
                                    }
                                    Text {
                                        width: 130
                                        text: Currency.format(Number(modelData.amount) || 0)
                                        color: Theme.red
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 13
                                        font.weight: Font.Bold
                                        horizontalAlignment: Text.AlignLeft
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                    Rectangle {
                                        width: 30; height: 26; radius: 6
                                        color: editX.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : "transparent"
                                        border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { anchors.centerIn: parent; text: "✏️"; font.pixelSize: 11 }
                                        MouseArea { id: editX; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: expForm.beginEdit(modelData) }
                                    }
                                    Rectangle {
                                        width: 30; height: 26; radius: 6
                                        color: rmX.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.20) : "transparent"
                                        border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                                        anchors.verticalCenter: parent.verticalCenter
                                        Text { anchors.centerIn: parent; text: "🗑"; font.pixelSize: 11 }
                                        MouseArea { id: rmX; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { confirmDelete.targetId = modelData.id; confirmDelete.targetDesc = modelData.desc || ""; confirmDelete.open = true } }
                                    }
                                }
                                HoverHandler { id: rowMouse }
                            }
                        }
                    }
                }
            }

            // ────────── Tab 2 — بدهی ──────────
            ColumnLayout {
                spacing: 14

                // Sub-KPIs specific to debt
                GridLayout {
                    Layout.fillWidth: true
                    columns: page.compact ? 2 : 3
                    columnSpacing: 14
                    rowSpacing: 14
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "📈"; label: "افزایش بدهی (دوره)"
                        value: Currency.format(page.totalDebtAdded)
                        sub: page.debtTxns.filter(t => t.type === "debt_add").length + " تراکنش"
                        accent: Theme.red
                    }
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "💵"; label: "پرداخت بدهی (دوره)"
                        value: Currency.format(page.totalDebtPaid)
                        sub: page.debtTxns.filter(t => t.type === "debt_pay").length + " تراکنش"
                        accent: Theme.green
                    }
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "👥"; label: "بدهکاران فعلی"
                        value: String(page.debtors.length)
                        sub: page.debtors.length > 0
                             ? "بزرگ‌ترین: " + Currency.format(page.debtors.reduce((m, u) => Math.max(m, Number(u.debt || 0)), 0))
                             : "—"
                        accent: Theme.amber
                    }
                }

                // Debtors list
                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(380, page.height * 0.4)
                    accent: Theme.red

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 8

                        Row {
                            Layout.fillWidth: true
                            spacing: 10
                            layoutDirection: Qt.RightToLeft
                            Text { text: "💳"; font.pixelSize: 18; anchors.verticalCenter: parent.verticalCenter }
                            Text { text: "بدهکاران فعلی"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 15; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            Item { width: 6; height: 1 }
                            Text { text: page.debtors.length + " نفر · مجموع " + Currency.format(page.totalUserDebt); color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; opacity: 0.5 }

                        // Empty
                        Column {
                            visible: page.debtors.length === 0
                            Layout.alignment: Qt.AlignCenter
                            topPadding: 30
                            spacing: 6
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "✅"; font.pixelSize: 36 }
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "هیچ بدهی فعالی وجود ندارد"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 13 }
                        }

                        ListView {
                            visible: page.debtors.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            clip: true
                            spacing: 4
                            model: page.debtors
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 52
                                radius: 8
                                color: dRowMA.containsMouse ? Theme.cardHover : "transparent"
                                border.color: Number(modelData.debt) > 1000000 ? Qt.rgba(0.94, 0.27, 0.27, 0.40) : Theme.border
                                border.width: 1
                                Behavior on color { ColorAnimation { duration: 120 } }

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 12
                                    spacing: 12
                                    layoutDirection: Qt.RightToLeft

                                    // Avatar bubble
                                    Rectangle {
                                        width: 32; height: 32; radius: 16
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: Qt.rgba(0.94, 0.27, 0.27, 0.18)
                                        border.color: Qt.rgba(0.94, 0.27, 0.27, 0.35); border.width: 1
                                        Text {
                                            anchors.centerIn: parent
                                            text: ((modelData.name || modelData.username || "?").charAt(0)).toUpperCase()
                                            color: Theme.red
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 13
                                            font.weight: Font.Bold
                                        }
                                    }

                                    // Name + username
                                    Column {
                                        width: 220
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 2
                                        Text {
                                            text: ((modelData.name || "") + " " + (modelData.family || "")).trim() || "—"
                                            color: Theme.text
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 13
                                            font.weight: Font.Bold
                                            elide: Text.ElideRight
                                            width: parent.width
                                            horizontalAlignment: Text.AlignRight
                                        }
                                        Text {
                                            text: "@" + (modelData.username || "") + (modelData.phone ? "  ·  " + modelData.phone : "")
                                            color: Theme.text3
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 11
                                            elide: Text.ElideRight
                                            width: parent.width
                                            horizontalAlignment: Text.AlignRight
                                        }
                                    }

                                    Item { Layout.fillWidth: true; width: 12 }

                                    // From-date
                                    Column {
                                        width: 130
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 2
                                        Text { text: "از"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 9; horizontalAlignment: Text.AlignRight; width: parent.width }
                                        Text {
                                            text: modelData.debt_since ? Jalali.dateTimeFromIso(modelData.debt_since) : "—"
                                            color: Theme.text2
                                            font.family: Theme.fontFamilyEn
                                            font.pixelSize: 10
                                            horizontalAlignment: Text.AlignRight
                                            width: parent.width
                                        }
                                    }

                                    // Debt amount
                                    Column {
                                        width: 140
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 2
                                        Text { text: "بدهی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 9; horizontalAlignment: Text.AlignRight; width: parent.width }
                                        Text {
                                            text: Currency.format(Number(modelData.debt || 0))
                                            color: Theme.red
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 13
                                            font.weight: Font.Black
                                            horizontalAlignment: Text.AlignRight
                                            width: parent.width
                                        }
                                    }

                                    // Pay button
                                    Rectangle {
                                        width: 86; height: 30; radius: 8
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: payMA.containsMouse ? Qt.rgba(0.06,0.73,0.51,0.32) : Qt.rgba(0.06,0.73,0.51,0.16)
                                        border.color: Qt.rgba(0.06,0.73,0.51,0.45); border.width: 1
                                        Behavior on color { ColorAnimation { duration: 120 } }
                                        Text {
                                            anchors.centerIn: parent
                                            text: "💵 پرداخت"
                                            color: Theme.green
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 11
                                            font.weight: Font.Bold
                                        }
                                        MouseArea {
                                            id: payMA
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: {
                                                payDebtModal.userId          = modelData.id;
                                                payDebtModal.username        = modelData.username || "";
                                                payDebtModal.fullName        = ((modelData.name||"")+" "+(modelData.family||"")).trim();
                                                payDebtModal.currentDebtRial = Number(modelData.debt || 0);
                                                payDebtModal.amountToman     = Math.round(Number(modelData.debt || 0) / 10);
                                                payDebtModal.open            = true;
                                            }
                                        }
                                    }
                                }
                                HoverHandler { id: dRowMA }
                            }
                        }
                    }
                }

                // Recent debt transactions
                GlassCard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    accent: Theme.amber

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 8

                        Row {
                            Layout.fillWidth: true
                            spacing: 10
                            layoutDirection: Qt.RightToLeft
                            Text { text: "📜"; font.pixelSize: 18; anchors.verticalCenter: parent.verticalCenter }
                            Text { text: "تراکنش‌های بدهی"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 15; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                            Item { width: 6; height: 1 }
                            Text { text: page.debtTxns.length + " مورد · " + (page.period === 0 ? "امروز" : page.period + " روز اخیر"); color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border; opacity: 0.5 }

                        Column {
                            visible: page.debtTxns.length === 0
                            Layout.alignment: Qt.AlignCenter
                            topPadding: 30
                            spacing: 6
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "📭"; font.pixelSize: 30 }
                            Text { anchors.horizontalCenter: parent.horizontalCenter; text: "تراکنشی در این بازه ثبت نشده"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12 }
                        }

                        ListView {
                            visible: page.debtTxns.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            clip: true
                            spacing: 3
                            model: page.debtTxns
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 40
                                radius: 6
                                color: "transparent"
                                border.color: Theme.border; border.width: 1

                                Row {
                                    anchors.fill: parent
                                    anchors.margins: 10
                                    spacing: 10
                                    layoutDirection: Qt.RightToLeft

                                    Rectangle {
                                        width: 80; height: 22; radius: 11
                                        anchors.verticalCenter: parent.verticalCenter
                                        color: modelData.type === "debt_pay" ? Qt.rgba(0.06,0.73,0.51,0.18) : Qt.rgba(0.94,0.27,0.27,0.18)
                                        border.color: modelData.type === "debt_pay" ? Qt.rgba(0.06,0.73,0.51,0.40) : Qt.rgba(0.94,0.27,0.27,0.40)
                                        border.width: 1
                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData.type === "debt_pay" ? "💵 پرداخت" : "📈 افزایش"
                                            color: modelData.type === "debt_pay" ? Theme.green : Theme.red
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 10
                                            font.weight: Font.Bold
                                        }
                                    }
                                    Text {
                                        width: 240
                                        text: ((modelData.name||"")+" "+(modelData.family||"")).trim() + "  · @" + (modelData.username || "")
                                        color: Theme.text2
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 11
                                        elide: Text.ElideRight
                                        horizontalAlignment: Text.AlignRight
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                    Text {
                                        width: 130
                                        text: Currency.format(Math.abs(Number(modelData.amount || 0)))
                                        color: modelData.type === "debt_pay" ? Theme.green : Theme.red
                                        font.family: Theme.fontFamilyEn
                                        font.pixelSize: 12
                                        font.weight: Font.Bold
                                        horizontalAlignment: Text.AlignRight
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                    Item { Layout.fillWidth: true; width: 1 }
                                    Text {
                                        text: Jalali.dateTimeFromIso(modelData.created_at)
                                        color: Theme.text3
                                        font.family: Theme.fontFamilyEn
                                        font.pixelSize: 10
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ────────── Tab 3 — شیفت صندوق ──────────
            ColumnLayout {
                spacing: 14

                GlassCard {
                    Layout.fillWidth: true
                    Layout.preferredHeight: page.shiftData ? 190 : 170
                    accent: page.shiftData ? Theme.green : Theme.amber

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 12

                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                text: page.shiftData ? "🟢 شیفت صندوق باز است" : "🟠 شیفت صندوق باز نیست"
                                color: page.shiftData ? Theme.green : Theme.amber
                                font.family: Theme.fontFamily
                                font.pixelSize: 16
                                font.weight: Font.Bold
                            }
                            Item { Layout.fillWidth: true }
                            Text {
                                visible: page.shiftData !== null
                                text: page.shiftData ? ("#" + page.shiftData.id + " · " + (page.shiftData.opened_by_name || "")) : ""
                                color: Theme.text2
                                font.family: Theme.fontFamily
                                font.pixelSize: 12
                            }
                        }

                        RowLayout {
                            visible: page.shiftData === null
                            Layout.fillWidth: true
                            spacing: 10
                            GlassInput {
                                id: openingCashInput
                                Layout.fillWidth: true
                                label: "موجودی اول صندوق (تومان)"
                                placeholder: "مثلاً 500,000"
                                numeric: true
                            }
                            GlassButton {
                                Layout.alignment: Qt.AlignBottom
                                text: "باز کردن شیفت"
                                onClicked: {
                                    const toman = Number(openingCashInput.rawDigits) || 0
                                    Api.openShift(toman * 10)
                                }
                            }
                        }

                        RowLayout {
                            visible: page.shiftData !== null
                            Layout.fillWidth: true
                            spacing: 14
                            Text {
                                text: "موجودی اول: " + Currency.format(Number(page.shiftData ? page.shiftData.opening_cash : 0))
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: 13
                            }
                            Item { Layout.fillWidth: true }
                            GlassButton {
                                text: "پیش‌نمایش بستن"
                                variant: "danger"
                                onClicked: if (page.shiftData) Api.previewShift(page.shiftData.id)
                            }
                        }
                    }
                }

                GlassCard {
                    visible: page.shiftPreview !== null
                    Layout.fillWidth: true
                    Layout.preferredHeight: 245
                    accent: Theme.red

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 18
                        spacing: 10
                        Text {
                            text: "پیش‌نمایش بستن شیفت"
                            color: Theme.text
                            font.family: Theme.fontFamily
                            font.pixelSize: 16
                            font.weight: Font.Bold
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 18
                            Text { text: "نقد ورودی: " + Currency.format(Number(page.shiftPreview?.totals?.total_cash_in || 0)); color: Theme.green; font.family: Theme.fontFamily }
                            Text { text: "هزینه نقدی: " + Currency.format(Number(page.shiftPreview?.totals?.total_cash_out || 0)); color: Theme.red; font.family: Theme.fontFamily }
                            Text { text: "موجودی مورد انتظار: " + Currency.format(Number(page.shiftPreview?.expected_cash || 0)); color: Theme.amber; font.family: Theme.fontFamily; font.weight: Font.Bold }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 10
                            GlassInput {
                                id: countedCashInput
                                Layout.fillWidth: true
                                label: "موجودی شمارش‌شده (تومان)"
                                numeric: true
                            }
                            GlassInput {
                                id: closeNoteInput
                                Layout.fillWidth: true
                                label: "یادداشت اختلاف (اختیاری)"
                                placeholder: "توضیح کوتاه"
                            }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Item { Layout.fillWidth: true }
                            GlassButton { text: "انصراف"; variant: "ghost"; onClicked: page.shiftPreview = null }
                            GlassButton {
                                text: "ثبت و بستن شیفت"
                                variant: "danger"
                                onClicked: {
                                    if (!page.shiftData) return
                                    if (countedCashInput.rawDigits.length === 0) {
                                        toast.show("موجودی شمارش‌شده را وارد کن", "error")
                                        return
                                    }
                                    const toman = Number(countedCashInput.rawDigits)
                                    if (!Number.isFinite(toman) || toman < 0) {
                                        toast.show("موجودی شمارش‌شده معتبر نیست", "error")
                                        return
                                    }
                                    Api.closeShift(page.shiftData.id, toman * 10, closeNoteInput.text.trim())
                                }
                            }
                        }
                    }
                }

                GlassCard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    accent: Theme.violet

                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 8
                        Text {
                            text: "تاریخچه اخیر شیفت‌ها"
                            color: Theme.text
                            font.family: Theme.fontFamily
                            font.pixelSize: 15
                            font.weight: Font.Bold
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
                        Text {
                            visible: page.shiftHistory.length === 0
                            Layout.alignment: Qt.AlignCenter
                            text: "هنوز شیفتی ثبت نشده"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                        }
                        ListView {
                            visible: page.shiftHistory.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            clip: true
                            spacing: 4
                            model: page.shiftHistory
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 46
                                radius: 6
                                color: "transparent"
                                border.color: Theme.border
                                border.width: 1
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.margins: 10
                                    Text { text: "#" + modelData.id; color: Theme.text; font.family: Theme.fontFamilyEn; font.weight: Font.Bold }
                                    Text { text: modelData.opened_by_name || "—"; color: Theme.text2; font.family: Theme.fontFamily }
                                    Text { text: modelData.status === "open" ? "باز" : "بسته"; color: modelData.status === "open" ? Theme.green : Theme.text3; font.family: Theme.fontFamily }
                                    Item { Layout.fillWidth: true }
                                    Text {
                                        text: modelData.status === "closed"
                                              ? ("اختلاف: " + Currency.format(Number(modelData.variance || 0)))
                                              : ("اول صندوق: " + Currency.format(Number(modelData.opening_cash || 0)))
                                        color: Number(modelData.variance || 0) === 0 ? Theme.text2 : Theme.red
                                        font.family: Theme.fontFamily
                                    }
                                    Text { text: Jalali.dateTimeFromIso(modelData.created_at); color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 10 }
                                }
                            }
                        }
                    }
                }
            }

            // ────────── Tab 4 — تطبیق حساب ──────────
            ColumnLayout {
                spacing: 14

                GridLayout {
                    Layout.fillWidth: true
                    columns: page.compact ? 2 : 4
                    columnSpacing: 12
                    rowSpacing: 12
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "👥"; label: "کاربران بررسی‌شده"
                        value: String(page.reconSummary.total_users || 0)
                        sub: "آخرین مانده ledger"
                        accent: Theme.cyan
                    }
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "⚠"; label: "دارای اختلاف"
                        value: String(page.reconSummary.drifted || 0)
                        sub: "نیازمند بررسی"
                        accent: Theme.red
                    }
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "📌"; label: "baseline قدیمی"
                        value: String(page.reconSummary.baseline_only || 0)
                        sub: "فقط خواندنی"
                        accent: Theme.amber
                    }
                    AccKpi {
                        Layout.fillWidth: true
                        iconText: "Σ"; label: "مجموع قدر مطلق اختلاف"
                        value: Currency.format(Number(page.reconSummary.total_drift_magnitude || 0))
                        sub: "شارژ + بدهی"
                        accent: Theme.violet
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10
                    Text {
                        text: "فقط حساب‌های دارای اختلاف"
                        color: Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 12
                    }
                    Switch {
                        checked: page.reconDriftOnly
                        onToggled: page.reconDriftOnly = checked
                    }
                    Item { Layout.fillWidth: true }
                    GlassButton {
                        text: "بازخوانی"
                        variant: "ghost"
                        onClicked: page.refreshReconciliation()
                    }
                }

                GlassCard {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    accent: Theme.cyan
                    ColumnLayout {
                        anchors.fill: parent
                        anchors.margins: 14
                        spacing: 8
                        Text {
                            text: "وضعیت مانده کاربران"
                            color: Theme.text
                            font.family: Theme.fontFamily
                            font.pixelSize: 15
                            font.weight: Font.Bold
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }
                        Text {
                            visible: page.reconRows.length === 0
                            Layout.alignment: Qt.AlignCenter
                            text: "مغایرتی برای نمایش نیست"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                        }
                        ListView {
                            visible: page.reconRows.length > 0
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            clip: true
                            spacing: 4
                            model: page.reconRows
                            delegate: Rectangle {
                                width: ListView.view.width
                                height: 58
                                radius: 6
                                color: "transparent"
                                border.width: 1
                                border.color: modelData.status === "drift" ? Qt.rgba(0.94, 0.27, 0.27, 0.45) : Theme.border
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.margins: 10
                                    spacing: 12
                                    Column {
                                        Layout.preferredWidth: 190
                                        Text {
                                            width: parent.width
                                            text: ((modelData.name || "") + " " + (modelData.family || "")).trim() || modelData.username
                                            color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold
                                            elide: Text.ElideRight
                                        }
                                        Text { text: "@" + (modelData.username || ""); color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 10 }
                                    }
                                    Text {
                                        Layout.preferredWidth: 150
                                        text: "واقعی: " + Currency.format(Number(modelData.actual_credits || 0))
                                        color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11
                                    }
                                    Text {
                                        Layout.preferredWidth: 150
                                        text: modelData.status === "baseline"
                                              ? "ledger: بدون سابقه"
                                              : "ledger: " + Currency.format(Number(modelData.expected_credits || 0))
                                        color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11
                                    }
                                    Text {
                                        Layout.preferredWidth: 145
                                        text: "اختلاف: " + Currency.format(
                                                  Math.abs(Number(modelData.credits_drift || 0))
                                                + Math.abs(Number(modelData.debt_drift || 0)))
                                        color: modelData.status === "drift" ? Theme.red : Theme.text3
                                        font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold
                                    }
                                    Rectangle {
                                        width: 78; height: 24; radius: 6
                                        color: modelData.status === "clean" ? Qt.rgba(0.06,0.73,0.51,0.16)
                                             : modelData.status === "drift" ? Qt.rgba(0.94,0.27,0.27,0.16)
                                             : Qt.rgba(0.96,0.62,0.04,0.16)
                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData.status === "clean" ? "سالم"
                                                : modelData.status === "drift" ? "اختلاف"
                                                : "baseline"
                                            color: modelData.status === "clean" ? Theme.green
                                                 : modelData.status === "drift" ? Theme.red : Theme.amber
                                            font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold
                                        }
                                    }
                                    Item { Layout.fillWidth: true }
                                    GlassButton {
                                        visible: modelData.status === "drift"
                                        text: "بررسی و اصلاح"
                                        Layout.preferredHeight: 34
                                        onClicked: {
                                            reconciliationModal.userRow = modelData
                                            reconciliationModal.ledgerRows = []
                                            reconciliationModal.reason = ""
                                            reconciliationModal.open = true
                                            Api.getReconciliationLedger(modelData.id, 20, 0)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }   // ColumnLayout root

    // ── Form state for the inline expense bar ───────────────────────
    QtObject {
        id: expForm
        property string gregorianIso:   new Date().toISOString().split('T')[0]
        property string category:       "سایر"
        property string paymentMethod:  "cash"
        property string desc:           ""
        property string amount:         ""
        property int    editId:         -1   // server expense id; -1 = create mode

        function reset() {
            const today = new Date().toISOString().split('T')[0];
            gregorianIso = today;
            desc = "";   descInput.text   = "";
            amount = ""; amountInput.text = "";
            category = "سایر";
            paymentMethod = "cash";
            editId = -1;
        }
        function parsedAmount() { return Number(String(amountInput.text).replace(/,/g, "")) || 0 }
        function payload() {
            return {
                date: gregorianIso,
                category: category,
                desc: descInput.text,
                amount: parsedAmount(),
                payment_method: paymentMethod
            };
        }
        function submit() {
            if (!descInput.text || !parsedAmount()) {
                toast.show("توضیح و مبلغ الزامی است", "error");
                return;
            }
            // Toast and reset happen on server confirmation (onCreateExpenseDone / onUpdateExpenseDone).
            if (editId > 0) {
                Api.updateExpense(editId, payload());
            } else {
                Api.createExpense(payload());
            }
        }
        function beginEdit(exp) {
            gregorianIso = exp.date || new Date().toISOString().split('T')[0];
            const ds = exp.desc || "";
            const a  = String(exp.amount || "");
            desc = ds;     descInput.text   = ds;
            amount = a;    amountInput.text = a;
            category = exp.category || "سایر";
            editId = exp.id;
            page.tabIndex = 1;   // ensure expense tab is visible while editing
        }
    }

    JalaliDatePicker {
        id: datePicker
        onSelected: (iso) => { expForm.gregorianIso = iso }
    }

    ConfirmDialog {
        id: confirmDelete
        property int    targetId: -1
        property string targetDesc: ""
        title: "حذف هزینه"
        body: "هزینه «" + targetDesc + "» حذف بشه؟"
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: {
            if (confirmDelete.targetId <= 0) return;
            Api.voidExpense(confirmDelete.targetId, "حذف توسط اپراتور");
            // toast and list refresh happen in onVoidExpenseDone
        }
    }

    // ── Pay-debt modal ──────────────────────────────────────────────
    Rectangle {
        id: payDebtModal
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        z: 2000
        visible: open
        property bool   open: false
        property int    userId: -1
        property string username: ""
        property string fullName: ""
        property real   currentDebtRial: 0
        property int    amountToman: 0
        property string paymentMethod: "cash"

        MouseArea { anchors.fill: parent; onClicked: payDebtModal.open = false }
        Rectangle {
            width: 440; height: pdCol.implicitHeight + 36
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }

            ColumnLayout {
                id: pdCol
                anchors.fill: parent
                anchors.margins: 22
                spacing: 12

                Text { text: "💵 پرداخت بدهی"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 17; font.weight: Font.Bold }
                Text {
                    text: payDebtModal.fullName + " · @" + payDebtModal.username
                    color: Theme.text2
                    font.family: Theme.fontFamily; font.pixelSize: 12
                }
                Text {
                    text: "بدهی فعلی: " + Currency.format(payDebtModal.currentDebtRial)
                    color: Theme.red
                    font.family: Theme.fontFamily; font.pixelSize: 13; font.weight: Font.Bold
                }
                Column { Layout.fillWidth: true; spacing: 4
                    Text { text: "مبلغ پرداخت (تومان)"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    GlassInput {
                        id: pdInput
                        width: parent.width
                        numeric: true
                        text: Number(payDebtModal.amountToman).toLocaleString(Qt.locale("en_US"), 'f', 0)
                    }
                }
                RowLayout { Layout.fillWidth: true; spacing: 6
                    Repeater {
                        model: [
                            { key: "cash",     label: "💵 نقد" },
                            { key: "card",     label: "💳 کارت" },
                            { key: "transfer", label: "🏦 انتقال" }
                        ]
                        delegate: GlassButton {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 34
                            text: modelData.label
                            variant: payDebtModal.paymentMethod === modelData.key ? "primary" : "ghost"
                            onClicked: payDebtModal.paymentMethod = modelData.key
                        }
                    }
                }
                RowLayout { Layout.fillWidth: true; spacing: 10
                    GlassButton { Layout.fillWidth: true; text: "انصراف"; variant: "ghost"; onClicked: payDebtModal.open = false }
                    GlassButton {
                        Layout.fillWidth: true
                        text: "💵 ثبت پرداخت"
                        variant: "primary"
                        onClicked: {
                            const t = Number(String(pdInput.text).replace(/,/g, "")) || 0;
                            if (t <= 0) { toast.show("مبلغ معتبر وارد کن", "error"); return; }
                            Api.payDebt(payDebtModal.userId, t * 10, "پرداخت بدهی از حسابداری", payDebtModal.paymentMethod);
                            payDebtModal.open = false;
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        id: reconciliationModal
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.82)
        z: 2100
        visible: open
        property bool open: false
        property var userRow: ({})
        property var ledgerRows: []
        property string reason: ""

        MouseArea { anchors.fill: parent; onClicked: reconciliationModal.open = false }
        Rectangle {
            width: Math.min(620, page.width - 40)
            height: Math.min(560, page.height - 40)
            anchors.centerIn: parent
            radius: 12
            color: Theme.bg2
            border.color: Theme.border2
            border.width: 1
            MouseArea { anchors.fill: parent }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 22
                spacing: 12

                Text {
                    text: "اصلاح کنترل‌شده مغایرت"
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: 18
                    font.weight: Font.Bold
                }
                Text {
                    text: ((reconciliationModal.userRow.name || "") + " "
                           + (reconciliationModal.userRow.family || "")).trim()
                          + " · @" + (reconciliationModal.userRow.username || "")
                    color: Theme.text2
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                }

                GridLayout {
                    Layout.fillWidth: true
                    columns: 2
                    columnSpacing: 12
                    rowSpacing: 8
                    Text {
                        text: "شارژ فعلی: " + Currency.format(Number(reconciliationModal.userRow.actual_credits || 0))
                        color: Theme.red; font.family: Theme.fontFamily
                    }
                    Text {
                        text: "شارژ ledger: " + Currency.format(Number(reconciliationModal.userRow.expected_credits || 0))
                        color: Theme.green; font.family: Theme.fontFamily
                    }
                    Text {
                        text: "بدهی فعلی: " + Currency.format(Number(reconciliationModal.userRow.actual_debt || 0))
                        color: Theme.red; font.family: Theme.fontFamily
                    }
                    Text {
                        text: "بدهی ledger: " + Currency.format(Number(reconciliationModal.userRow.expected_debt || 0))
                        color: Theme.green; font.family: Theme.fontFamily
                    }
                }

                GlassInput {
                    id: reconciliationReasonInput
                    Layout.fillWidth: true
                    label: "دلیل اصلاح (حداقل ۱۰ کاراکتر)"
                    placeholder: "مثلاً اختلاف پس از قطع برق و بازیابی سیستم"
                    text: reconciliationModal.reason
                    onTextChanged: reconciliationModal.reason = text
                }

                Text {
                    text: "آخرین رویدادهای ledger"
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: 13
                    font.weight: Font.Bold
                }
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 3
                    model: reconciliationModal.ledgerRows
                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 34
                        radius: 5
                        color: "transparent"
                        border.color: Theme.border
                        border.width: 1
                        RowLayout {
                            anchors.fill: parent
                            anchors.margins: 7
                            Text { text: "#" + modelData.id; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 9 }
                            Text { text: modelData.event_type || ""; color: Theme.text2; font.family: Theme.fontFamilyEn; font.pixelSize: 10 }
                            Text {
                                text: Currency.format(Number(modelData.credits_after || 0))
                                      + " / بدهی " + Currency.format(Number(modelData.debt_after || 0))
                                color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 10
                            }
                            Item { Layout.fillWidth: true }
                            Text { text: Jalali.dateTimeFromIso(modelData.created_at); color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 9 }
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    GlassButton {
                        Layout.fillWidth: true
                        text: "انصراف"
                        variant: "ghost"
                        onClicked: reconciliationModal.open = false
                    }
                    GlassButton {
                        Layout.fillWidth: true
                        text: "ثبت اصلاح"
                        variant: "danger"
                        onClicked: {
                            const reason = reconciliationReasonInput.text.trim()
                            if (reason.length < 10) {
                                toast.show("دلیل اصلاح باید حداقل ۱۰ کاراکتر باشد", "error")
                                return
                            }
                            Api.correctReconciliation(
                                reconciliationModal.userRow.id,
                                reason,
                                Number(reconciliationModal.userRow.actual_credits),
                                Number(reconciliationModal.userRow.actual_debt),
                                Number(reconciliationModal.userRow.last_ledger_id))
                        }
                    }
                }
            }
        }
    }

    Toast { id: toast }

    // ── Inline KPI card component ──────────────────────────────────
    component AccKpi: GlassCard {
        id: kpi
        property string iconText: ""
        property string label: ""
        property string value: ""
        property string sub: ""
        accent: Theme.violet
        implicitHeight: 96

        Item {
            anchors.fill: parent
            anchors.margins: 16

            Row {
                anchors.fill: parent
                spacing: 14
                layoutDirection: Qt.RightToLeft

                Rectangle {
                    width: 52; height: 52; radius: 14
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(kpi.accent.r, kpi.accent.g, kpi.accent.b, 0.16)
                    border.color: Qt.rgba(kpi.accent.r, kpi.accent.g, kpi.accent.b, 0.34)
                    border.width: 1
                    Text { anchors.centerIn: parent; text: kpi.iconText; font.pixelSize: 24 }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 3
                    Text {
                        text: kpi.label
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                    }
                    Text {
                        text: kpi.value
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 18
                        font.weight: Font.Black
                    }
                    Text {
                        visible: kpi.sub !== ""
                        text: kpi.sub
                        color: Qt.rgba(kpi.accent.r, kpi.accent.g, kpi.accent.b, 0.85)
                        font.family: Theme.fontFamily
                        font.pixelSize: 10
                        font.weight: Font.Medium
                    }
                }
            }
        }
    }
}
