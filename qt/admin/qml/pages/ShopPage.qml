// ShopPage — three tabs:
//   1) آیتم‌ها  (catalogue grid + create/edit modal with emoji picker)
//   2) سفارش‌های معلق (pending orders feed with approve/cancel — polls 4s)
//   3) تاریخچه (completed + cancelled orders, read-only — polls 10s)
//
// Items are reloaded on every successful mutation and once on mount.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import "../theme"

Item {
    id: page

    property var items: []
    property var pendingOrders: []
    property var historyOrders: []     // completed + cancelled, latest first
    property var shopRevenue: []       // [{ date, revenue }] — last 7 days
    property string search: ""
    property string tab: "items"
    property string itemFilter: "all"
    // Off by default — operator who clicked "حذف" expects the item to
    // disappear. They can flip this on if they want to recover something
    // that was kept (soft-deleted because it was referenced by an order).
    property bool showInactive: false

    // Lets us route the single ordersDone signal back to the right list.
    // (Could be cleaner with two separate cpp endpoints, but this avoids
    //  touching ApiClient for one extra fetch.)
    property string _lastOrdersQuery: ""

    function fetchPending() { _lastOrdersQuery = "pending"; Api.getOrders("pending") }
    function fetchHistory() { _lastOrdersQuery = "history"; Api.getOrders("") }

    readonly property bool compact: page.width < Theme.bpLg

    // server returns `active` (0/1), not `is_active`
    readonly property int activeItemsCount:   items.filter(i => i.active !== 0).length
    readonly property int inactiveItemsCount: items.filter(i => i.active === 0).length
    readonly property real todayRevenue: {
        if (!shopRevenue || shopRevenue.length === 0) return 0;
        // server returns rows ordered by date — take the latest
        const last = shopRevenue[shopRevenue.length - 1];
        return last && last.revenue ? last.revenue : 0;
    }

    readonly property var filteredItems: {
        const s = page.search.trim().toLowerCase();
        return items.filter(it => {
            const matchSearch = !s || (it.name || "").toLowerCase().includes(s);
            const matchCat = (page.itemFilter === "all" || it.category === page.itemFilter);
            // Hide soft-deleted items unless the operator explicitly toggles
            // "نمایش حذف‌شده‌ها". Server returns inactive items only when we
            // pass ?all=1 and we always do — the visibility decision is local
            // so toggling is instant (no roundtrip).
            const matchActive = page.showInactive || it.active !== 0;
            return matchSearch && matchCat && matchActive;
        });
    }

    Component.onCompleted: {
        Api.getShopItems(true);
        page.fetchPending();
        Api.getShopReport(7);
        if (!Socket.connected) Socket.connectTo(Api.baseUrl);
        if (typeof __startPage !== 'undefined') {
            if (__startPage === "shop-create") {
                Qt.callLater(() => { itemModal.mode = "create"; itemModal.initial = {}; itemModal.open = true });
            } else if (__startPage === "shop-orders") {
                page.tab = "orders";
            }
        }
    }

    // Live: server emits shop:update with the active-items array on every
    // CRUD mutation. Admin view wants ALL items (incl. inactive), so refetch
    // through getShopItems(true) instead of consuming the payload directly.
    Connections {
        target: Socket
        function onMessageReceived(name, _payload) {
            if (name === "shop:update") Api.getShopItems(true);
        }
    }

    Timer {
        interval: 4000
        running: page.tab === "orders"
        repeat: true
        triggeredOnStart: true
        onTriggered: page.fetchPending()
    }

    Timer {
        interval: 10000   // history is less hot than live orders
        running: page.tab === "history"
        repeat: true
        triggeredOnStart: true
        onTriggered: page.fetchHistory()
    }

    Timer {
        interval: 30000  // refresh shop revenue every 30s
        running: true
        repeat: true
        onTriggered: Api.getShopReport(7)
    }

    Connections {
        target: Api
        function onShopItemsDone(rows)   { page.items = rows }
        function onOrdersDone(rows) {
            if (page._lastOrdersQuery === "history") {
                // Server returns ALL orders when status is empty — filter to non-pending,
                // newest first (created_at desc), capped to 50 to keep the list snappy.
                const nonPending = rows.filter(r => r.status !== "pending");
                nonPending.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                page.historyOrders = nonPending.slice(0, 50);
            } else {
                page.pendingOrders = rows;
            }
        }
        function onShopReportDone(rows)  { page.shopRevenue = rows }
        function onShopMutationDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getShopItems(true);
            toast.show("ذخیره شد ✅", "success");
        }
        function onOrderActionDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            page.fetchPending();
            Api.getShopReport(7);   // sale just happened — refresh revenue
            toast.show("انجام شد ✅", "success");
        }
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // Topbar
        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Text {
                text: "شاپ"
                color: Theme.text
                font.family: Theme.fontFamily
                font.pixelSize: 24
                font.weight: Font.Bold
            }
            Rectangle {
                radius: 999; height: 24
                implicitWidth: cntT.implicitWidth + 18
                color: Qt.rgba(0.06, 0.71, 0.83, 0.12)
                border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                Text {
                    id: cntT
                    anchors.centerIn: parent
                    text: page.items.length + " آیتم"
                    color: Theme.cyanSoft
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 11
                    font.weight: Font.Bold
                }
            }

            Item { Layout.fillWidth: true }

            GlassInput {
                id: searchInput
                Layout.preferredWidth: 280
                visible: page.tab === "items"
                placeholder: "🔍 جستجو در آیتم‌ها…"
                text: page.search
                onTextChanged: page.search = text
            }
            GlassButton {
                visible: page.tab === "items"
                text: "➕ آیتم جدید"
                onClicked: {
                    itemModal.mode = "create";
                    itemModal.initial = {};
                    itemModal.open = true;
                }
            }
        }

        // Stat row — quick at-a-glance shop health
        GridLayout {
            Layout.fillWidth: true
            columns: page.compact ? 2 : 4
            columnSpacing: 12
            rowSpacing: 12

            ShopStatPill { Layout.fillWidth: true; iconText: "✅"; label: "آیتم‌های فعال";    value: page.activeItemsCount + "";   accent: Theme.green }
            ShopStatPill { Layout.fillWidth: true; iconText: "🚫"; label: "آیتم‌های غیرفعال"; value: page.inactiveItemsCount + ""; accent: Theme.text3 }
            ShopStatPill { Layout.fillWidth: true; iconText: "📦"; label: "سفارش‌های معلق";   value: page.pendingOrders.length + ""; accent: Theme.amber; pulse: page.pendingOrders.length > 0 }
            ShopStatPill { Layout.fillWidth: true; iconText: "💰"; label: "فروش امروز";       value: Currency.format(page.todayRevenue || 0); accent: Theme.cyan; isMoney: true }
        }

        // Tabs
        Row {
            Layout.fillWidth: true
            spacing: 8

            Repeater {
                model: [
                    { key: "items",   label: "🛒 آیتم‌ها",        count: page.activeItemsCount,        color: Theme.cyan },
                    { key: "orders",  label: "📦 سفارش‌های معلق", count: page.pendingOrders.length,    color: Theme.amber },
                    { key: "history", label: "📜 تاریخچه",         count: 0,                            color: Theme.violet }
                ]
                delegate: Rectangle {
                    height: 36; radius: 18
                    width: lab.implicitWidth + 36 + (modelData.count > 0 ? 28 : 0)
                    property bool active: page.tab === modelData.key
                    color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.15) : Theme.card
                    border.color: active ? Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.35) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 180 } }

                    Row {
                        anchors.centerIn: parent
                        spacing: 8
                        layoutDirection: Qt.RightToLeft
                        Text {
                            id: lab
                            text: modelData.label
                            color: active ? Theme.text : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: modelData.count > 0
                            width: 22; height: 18; radius: 9
                            color: Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.25)
                            SequentialAnimation on opacity {
                                running: modelData.key === "orders" && modelData.count > 0
                                loops: Animation.Infinite
                                NumberAnimation { to: 0.4; duration: 700 }
                                NumberAnimation { to: 1.0; duration: 700 }
                            }
                            Text {
                                anchors.centerIn: parent
                                text: modelData.count
                                color: modelData.color
                                font.family: Theme.fontFamilyEn
                                font.pixelSize: 10
                                font.weight: Font.Bold
                            }
                        }
                    }
                    MouseArea { anchors.fill: parent; onClicked: page.tab = modelData.key; cursorShape: Qt.PointingHandCursor }
                }
            }
        }

        // ── Items tab body ───────────────────────────────────────────
        ColumnLayout {
            visible: page.tab === "items"
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            // Category filters + a trailing toggle for soft-deleted items
            RowLayout {
                Layout.fillWidth: true
                spacing: 6

                Row {
                    spacing: 6
                    Repeater {
                        model: [
                            { key: "all",   label: "همه" },
                            { key: "food",  label: "🍔 غذا" },
                            { key: "drink", label: "🥤 نوشیدنی" },
                            { key: "snack", label: "🍿 تنقلات" }
                        ]
                        delegate: Rectangle {
                            height: 28; radius: 14
                            width: txt.implicitWidth + 18
                            color: page.itemFilter === modelData.key ? Qt.rgba(0.55, 0.36, 0.96, 0.18) : Theme.card
                            border.color: page.itemFilter === modelData.key ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                            border.width: 1
                            Text {
                                id: txt
                                anchors.centerIn: parent
                                text: modelData.label
                                color: page.itemFilter === modelData.key ? Theme.text : Theme.text2
                                font.family: Theme.fontFamily
                                font.pixelSize: 11
                                font.weight: Font.Bold
                            }
                            MouseArea { anchors.fill: parent; onClicked: page.itemFilter = modelData.key; cursorShape: Qt.PointingHandCursor }
                        }
                    }
                }

                Item { Layout.fillWidth: true }

                // Soft-deleted toggle — visible only when at least one inactive
                // item exists (no point showing it if there's nothing to reveal).
                Rectangle {
                    visible: page.inactiveItemsCount > 0
                    Layout.preferredHeight: 28
                    Layout.preferredWidth: invTxt.implicitWidth + 28
                    radius: 14
                    color: page.showInactive ? Qt.rgba(0.94, 0.27, 0.27, 0.18) : Theme.card
                    border.color: page.showInactive ? Qt.rgba(0.94, 0.27, 0.27, 0.40) : Theme.border
                    border.width: 1
                    Behavior on color { ColorAnimation { duration: 150 } }
                    Text {
                        id: invTxt
                        anchors.centerIn: parent
                        text: (page.showInactive ? "🔴 " : "⚪️ ") + "حذف‌شده‌ها (" + page.inactiveItemsCount + ")"
                        color: page.showInactive ? Theme.red : Theme.text2
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: page.showInactive = !page.showInactive
                    }
                }
            }

            Text {
                visible: page.filteredItems.length === 0
                Layout.alignment: Qt.AlignHCenter
                topPadding: 60
                text: "آیتمی پیدا نشد — دکمه «آیتم جدید» را بزن"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }

            // Items grid using GridView for proper scrolling without parent.parent refs
            GridView {
                visible: page.filteredItems.length > 0
                Layout.fillWidth: true
                Layout.fillHeight: true
                cellWidth: 220
                cellHeight: 260
                clip: true
                model: page.filteredItems
                delegate: Item {
                    width: 220; height: 260
                    ShopItemCard {
                        anchors.centerIn: parent
                        width: 200; height: 240
                        item: modelData
                        onEdit:   { itemModal.mode = "edit"; itemModal.initial = modelData; itemModal.open = true; }
                        onRemove: { confirmRemove.item = modelData; confirmRemove.open = true; }
                        onToggleActive: {
                            // Server expects the full item shape — flip just `active`.
                            const flipped = (modelData.active === 0) ? 1 : 0;
                            Api.updateShopItem(modelData.id, {
                                name: modelData.name,
                                price: modelData.price,
                                buy_price: modelData.buy_price || 0,
                                category: modelData.category,
                                emoji: modelData.emoji,
                                stock: modelData.stock !== undefined ? modelData.stock : -1,
                                active: flipped
                            });
                        }
                    }
                }
            }
        }

        // ── Orders tab body ──────────────────────────────────────────
        Item {
            visible: page.tab === "orders"
            Layout.fillWidth: true
            Layout.fillHeight: true

            Column {
                visible: page.pendingOrders.length === 0
                anchors.centerIn: parent
                spacing: 14
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: 80; height: 80; radius: 20
                    color: Qt.rgba(0.06, 0.73, 0.51, 0.10)
                    border.color: Qt.rgba(0.06, 0.73, 0.51, 0.25); border.width: 1
                    Text { anchors.centerIn: parent; text: "✅"; font.pixelSize: 40 }
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "همه‌ی سفارش‌ها رسیدگی شده — هیچ سفارش معلقی نیست"
                    color: Theme.text2
                    font.family: Theme.fontFamily
                    font.pixelSize: 14
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "این لیست هر ۴ ثانیه به‌صورت زنده آپدیت می‌شه."
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                }
            }

            ListView {
                visible: page.pendingOrders.length > 0
                anchors.fill: parent
                spacing: 12
                clip: true
                model: page.pendingOrders
                delegate: OrderCard {
                    width: ListView.view.width
                    order: modelData
                    onApprove: Api.approveOrder(modelData.id)
                    onCancel:  Api.cancelOrder(modelData.id)
                }
            }
        }

        // ── History tab body ─────────────────────────────────────────
        Item {
            visible: page.tab === "history"
            Layout.fillWidth: true
            Layout.fillHeight: true

            Column {
                visible: page.historyOrders.length === 0
                anchors.centerIn: parent
                spacing: 14
                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: 80; height: 80; radius: 20
                    color: Qt.rgba(0.55, 0.36, 0.96, 0.10)
                    border.color: Qt.rgba(0.55, 0.36, 0.96, 0.25); border.width: 1
                    Text { anchors.centerIn: parent; text: "📜"; font.pixelSize: 40 }
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "هیچ سفارش رسیدگی‌شده‌ای ثبت نشده"
                    color: Theme.text2
                    font.family: Theme.fontFamily
                    font.pixelSize: 14
                }
            }

            // Counts header (only when there's history)
            Row {
                visible: page.historyOrders.length > 0
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.left: parent.left
                spacing: 10
                layoutDirection: Qt.RightToLeft
                height: 32

                Rectangle {
                    height: 26; radius: 13
                    width: cmpT.implicitWidth + 22
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(0.06, 0.73, 0.51, 0.12)
                    border.color: Qt.rgba(0.06, 0.73, 0.51, 0.32); border.width: 1
                    Text {
                        id: cmpT
                        anchors.centerIn: parent
                        text: "✓ " + page.historyOrders.filter(o => o.status === "completed").length + " تأیید شده"
                        color: Theme.green
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                }
                Rectangle {
                    height: 26; radius: 13
                    width: cnT.implicitWidth + 22
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(0.94, 0.27, 0.27, 0.12)
                    border.color: Qt.rgba(0.94, 0.27, 0.27, 0.32); border.width: 1
                    Text {
                        id: cnT
                        anchors.centerIn: parent
                        text: "✕ " + page.historyOrders.filter(o => o.status === "cancelled").length + " لغو شده"
                        color: Theme.red
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                        font.weight: Font.Bold
                    }
                }

                Item { width: 8; height: 1 }

                Text {
                    text: "آخرین " + page.historyOrders.length + " سفارش"
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    anchors.verticalCenter: parent.verticalCenter
                }
            }

            ListView {
                visible: page.historyOrders.length > 0
                anchors.top: parent.top
                anchors.topMargin: 40
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                spacing: 12
                clip: true
                model: page.historyOrders
                delegate: OrderCard {
                    width: ListView.view.width
                    order: modelData
                    readOnly: true
                }
            }
        }
    }

    // ── Modals ────────────────────────────────────────────────────────
    ShopItemModal {
        id: itemModal
        onSubmitted: (payload) => {
            if (mode === "create") Api.createShopItem(payload);
            else Api.updateShopItem(initial.id, payload);
        }
    }

    ConfirmDialog {
        id: confirmRemove
        property var item: ({})
        title: "حذف آیتم"
        body: "آیا «" + (item.name || "") + "» حذف بشه؟ مشتری‌ها دیگه نمی‌بینن."
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: Api.deleteShopItem(item.id)
    }

    Toast { id: toast }

    // ── Inline reusable stat pill (used in the stat row above) ──────
    component ShopStatPill: GlassCard {
        id: pill
        property string iconText: ""
        property string label: ""
        property string value: ""
        property bool   isMoney: false
        property bool   pulse: false
        accent: Theme.violet
        implicitHeight: 72

        Item {
            anchors.fill: parent
            anchors.margins: 14

            Row {
                anchors.fill: parent
                spacing: 12
                layoutDirection: Qt.RightToLeft

                Rectangle {
                    width: 44; height: 44; radius: 12
                    anchors.verticalCenter: parent.verticalCenter
                    color: Qt.rgba(pill.accent.r, pill.accent.g, pill.accent.b, 0.14)
                    border.color: Qt.rgba(pill.accent.r, pill.accent.g, pill.accent.b, 0.32)
                    border.width: 1
                    Text { anchors.centerIn: parent; text: pill.iconText; font.pixelSize: 20 }
                    SequentialAnimation on opacity {
                        running: pill.pulse
                        loops: Animation.Infinite
                        NumberAnimation { to: 0.5; duration: 700 }
                        NumberAnimation { to: 1.0; duration: 700 }
                    }
                }

                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 4
                    Text {
                        text: pill.label
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 11
                        horizontalAlignment: Text.AlignRight
                    }
                    Text {
                        text: pill.value
                        color: Theme.text
                        font.family: pill.isMoney ? Theme.fontFamily : Theme.fontFamilyEn
                        font.pixelSize: pill.isMoney ? 15 : 20
                        font.weight: Font.Black
                        horizontalAlignment: Text.AlignRight
                    }
                }
            }
        }
    }
}
