// Main.qml — root window. Shows the LoginPage until Api.authenticated,
// then swaps to the layout (Sidebar + main StackView).
import QtQuick
import QtQuick.Window
import QtQuick.Controls.Basic
import "components"
import "pages"
import "theme"

Window {
    id: root
    visible: true
    width: 1440
    height: 900
    minimumWidth: 720       // allow shrinking to small screens
    minimumHeight: 600
    title: "MuteGame Admin"
    color: Theme.bg

    LayoutMirroring.enabled: true        // Persian RTL across the app
    LayoutMirroring.childrenInherit: true

    // Expose window dimensions to all child pages so they can react via
    // Theme.gridColumns(root.width) etc.
    readonly property int  ww: root.width
    readonly property int  wh: root.height
    readonly property bool compact: Theme.isCompact(ww)
    readonly property bool mobile:  Theme.isMobile(ww)

    property string activePage: "dashboard"
    // Logged-in operator info — populated by /api/admins/me on login + every
    // app launch with a stored token. Used by Sidebar (and in future, the
    // dashboard topbar) to greet the operator by display name.
    property string adminUsername: ""
    property string adminDisplay:  ""

    StackView {
        id: stack
        anchors.fill: parent
        initialItem: (Api.authenticated || __startPage.length > 0) ? layoutComponent : loginComponent
    }

    Component.onCompleted: {
        if (__startPage === "users" || __startPage === "users-create") activePage = "users";
        else if (__startPage === "shop" || __startPage === "shop-create" || __startPage === "shop-orders") activePage = "shop";
        // If we already have a saved token, prime the operator card right away
        // so the sidebar doesn't flash "admin" placeholder on launch.
        if (Api.authenticated) Api.getMe();
        // Dial the realtime socket too so the global order:new listener is
        // wired up regardless of which page is shown first.
        if (Api.authenticated && !Socket.connected) Socket.connectTo(Api.baseUrl);
    }

    Connections {
        target: Api
        function onAuthenticatedChanged() {
            stack.replace(Api.authenticated ? layoutComponent : loginComponent);
            if (Api.authenticated) {
                Api.getMe();
                if (!Socket.connected) Socket.connectTo(Api.baseUrl);
            } else {
                root.adminUsername = ""; root.adminDisplay = "";
            }
        }
        function onMeDone(me) {
            root.adminUsername = me.username || "";
            root.adminDisplay  = me.display_name || "";
        }
    }

    Component {
        id: loginComponent
        LoginPage { onLoggedIn: stack.replace(layoutComponent) }
    }

    Component {
        id: layoutComponent
        Item {
            id: layoutRoot
            BgEffects {}

            // Sidebar collapses to a 64px rail on compact, fully off-screen
            // on mobile (toggleable via the topbar button).
            property bool sidebarOpen: !root.mobile

            Row {
                anchors.fill: parent
                layoutDirection: Qt.LeftToRight

                StackView {
                    id: pages
                    width: parent.width - (layoutRoot.sidebarOpen ? sidebar.width : 0)
                    height: parent.height
                    initialItem:
                          __startPage === "users" || __startPage === "users-create" ? usersComponent
                        : __startPage === "shop"  || __startPage === "shop-create" || __startPage === "shop-orders" ? shopComponent
                        : dashboardComponent
                    Behavior on width { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
                }

                Sidebar {
                    id: sidebar
                    height: parent.height
                    width: layoutRoot.sidebarOpen ? (root.compact ? 220 : 280) : 0
                    visible: width > 0
                    clip: true
                    activeKey: root.activePage
                    adminName:    root.adminUsername || "admin"
                    adminDisplay: root.adminDisplay
                    onNavigate: (key) => {
                        root.activePage = key;
                        if (key === "dashboard")       pages.replace(dashboardComponent);
                        else if (key === "users")      pages.replace(usersComponent);
                        else if (key === "shop")       pages.replace(shopComponent);
                        else if (key === "accounting") pages.replace(accountingComponent);
                        else if (key === "settings")   pages.replace(settingsComponent);
                        else if (key === "computers")  pages.replace(computersComponent);
                        else if (key === "games")      pages.replace(gamesComponent);
                        else if (key === "network")    pages.replace(networkComponent);
                        else if (key === "reports")    pages.replace(reportsComponent);
                        else if (key === "admins")     pages.replace(adminsComponent);
                        if (root.mobile) layoutRoot.sidebarOpen = false;   // auto-close on phone
                    }
                    onLogoutRequested: logoutConfirm.open = true
                    Behavior on width { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
                }
            }

            // Hamburger toggle for mobile (top-left in RTL = top-right visually)
            Rectangle {
                visible: root.mobile
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.margins: 14
                width: 44; height: 44; radius: 22
                color: Theme.card
                border.color: Theme.border; border.width: 1
                Text { anchors.centerIn: parent; text: "☰"; color: Theme.text; font.pixelSize: 20 }
                MouseArea {
                    anchors.fill: parent
                    onClicked: layoutRoot.sidebarOpen = !layoutRoot.sidebarOpen
                }
            }

            ConfirmDialog {
                id: logoutConfirm
                title: "خروج از پنل"
                body: "از پنل ادمین خارج بشی؟ باید دوباره وارد بشی."
                confirmText: "↩ خروج"
                confirmVariant: "danger"
                onConfirmed: Api.logout()
            }
        }
    }

    // ── Global admin notifications ────────────────────────────────────
    // Whenever the kiosk places a shop order, the server broadcasts
    // `order:new` with the full order. Admin should know IMMEDIATELY,
    // regardless of which page is open — show a banner toast + a small
    // pulsing badge near the sidebar shop icon (handled in Sidebar later).
    // Also re-fetch any open ShopPage view.
    Connections {
        target: Socket
        enabled: Api.authenticated
        function onMessageReceived(name, payload) {
            if (name !== "order:new") return;
            try {
                const data = JSON.parse(payload || "{}");
                const who = (data && data.username) ? data.username : "کاربر";
                const where = (data && data.computer_name) ? data.computer_name : "کامپیوتر";
                const total = Number(data?.total || 0);
                const tomans = Math.round(total / 10).toLocaleString(Qt.locale("en_US"), 'f', 0);
                globalToast.show(
                    "🛒 سفارش جدید — " + who + " (" + where + ") · " + tomans + " تومان",
                    "info", 8000);
                // Also nudge any open shop page to refresh — cheap + idempotent.
                Api.getOrders("pending");
            } catch (e) { console.log("order:new parse:", e); }
        }
    }
    Toast { id: globalToast }

    Component { id: dashboardComponent;  DashboardPage {} }
    Component { id: usersComponent;      UsersPage {} }
    Component { id: shopComponent;       ShopPage {} }
    Component { id: accountingComponent; AccountingPage {} }
    Component { id: settingsComponent;   SettingsPage {} }
    Component { id: computersComponent;  ComputersPage {} }
    Component { id: gamesComponent;      GamesPage {} }
    Component { id: networkComponent;    NetworkPage {} }
    Component { id: reportsComponent;    ReportsPage {} }
    Component { id: adminsComponent;     AdminsPage {} }
}
