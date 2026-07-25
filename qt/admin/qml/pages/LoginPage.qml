// LoginPage.qml — first user-facing page. Two-column layout:
//   • Right side (in RTL): hero brand + tagline
//   • Left side: glass login card with username + password
//
// Demonstrates the GlassInput Enter-chain feature: typing in username and
// pressing Enter advances to password; pressing Enter on password fires
// submitted() which calls Api.adminLogin.
import QtQuick
import QtQuick.Layouts
import "../components"
import "../theme"

Item {
    id: page
    signal loggedIn()

    property string error: ""
    property bool loading: false

    BgEffects {}

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // ── Hero side (right in RTL) ─────────────────────────────────
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.centerIn: parent
                width: 480
                spacing: 18

                Rectangle {
                    Layout.alignment: Qt.AlignRight
                    width: pill.implicitWidth + 24
                    height: 28; radius: 14
                    color: Qt.rgba(0.06, 0.71, 0.83, 0.10)
                    border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                    Text {
                        id: pill
                        anchors.centerIn: parent
                        text: "ADMIN PANEL · ONLINE"
                        color: Theme.cyanSoft
                        font.family: Theme.fontFamilyEn
                        font.pixelSize: 11
                        font.letterSpacing: 2
                        font.weight: Font.Bold
                    }
                }

                Text {
                    Layout.alignment: Qt.AlignRight
                    text: "Mute<font color='%1'>Game</font>".arg(Theme.violetSoft)
                    textFormat: Text.RichText
                    color: Theme.text
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 64
                    font.weight: Font.Black
                }

                Text {
                    Layout.alignment: Qt.AlignRight
                    text: "مرکز کنترل گیم‌نت — مدیریت کامپیوترها، کاربران، فروشگاه و حسابداری از یک پنل واحد."
                    color: Theme.text2
                    font.family: Theme.fontFamily
                    font.pixelSize: 15
                    wrapMode: Text.Wrap
                    Layout.preferredWidth: 460
                    horizontalAlignment: Text.AlignRight
                }

                RowLayout {
                    Layout.alignment: Qt.AlignRight
                    spacing: 28
                    Repeater {
                        model: [
                            { num: Qt.formatTime(new Date(), "HH:mm"), label: "ساعت" },
                            { num: "24/7",                              label: "پشتیبانی" }
                        ]
                        delegate: ColumnLayout {
                            spacing: 2
                            Text {
                                text: modelData.num
                                color: Theme.text
                                font.family: Theme.fontFamilyEn
                                font.pixelSize: 28
                                font.weight: Font.Bold
                                horizontalAlignment: Text.AlignRight
                                Layout.alignment: Qt.AlignRight
                            }
                            Text {
                                text: modelData.label
                                color: Theme.text3
                                font.family: Theme.fontFamily
                                font.pixelSize: 11
                                horizontalAlignment: Text.AlignRight
                                Layout.alignment: Qt.AlignRight
                            }
                        }
                    }
                }
            }
        }

        // ── Login card side (left in RTL) ────────────────────────────
        Item {
            Layout.preferredWidth: 480
            Layout.fillHeight: true

            GlassCard {
                width: 380
                height: column.implicitHeight + 64
                anchors.centerIn: parent
                accent: Theme.violet
                radius: 22

                ColumnLayout {
                    id: column
                    anchors.fill: parent
                    anchors.margins: 32
                    spacing: 18

                    // Logo mark + title
                    Rectangle {
                        Layout.alignment: Qt.AlignHCenter
                        width: 60; height: 60; radius: 16
                        gradient: Gradient {
                            orientation: Gradient.Vertical
                            GradientStop { position: 0.0; color: Theme.indigo }
                            GradientStop { position: 1.0; color: Theme.pink }
                        }
                        Text {
                            anchors.centerIn: parent
                            text: "M"; color: "white"
                            font.pixelSize: 30; font.weight: Font.Black
                        }
                    }

                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: "ورود به پنل ادمین"
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 22
                        font.weight: Font.Bold
                    }
                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: "نام کاربری و رمز عبور را وارد کنید"
                        color: Theme.text3
                        font.family: Theme.fontFamily
                        font.pixelSize: 13
                    }

                    // Server runs locally inside this app — no URL needed.
                    // Show our LAN IP so the operator knows what to type into
                    // each kiosk's ConfigPage.
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 56
                        radius: 12
                        color: Qt.rgba(0.06, 0.71, 0.83, 0.08)
                        border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                        Row {
                            anchors.fill: parent
                            anchors.leftMargin: 14
                            anchors.rightMargin: 14
                            layoutDirection: Qt.RightToLeft
                            spacing: 12
                            Text { text: "🌐"; font.pixelSize: 20; anchors.verticalCenter: parent.verticalCenter }
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text {
                                    text: "آدرس سرور برای کلاینت‌ها"
                                    color: Theme.text3
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 11
                                }
                                Text {
                                    text: Network.localIp + " : " + Network.port
                                    color: Theme.cyanSoft
                                    font.family: Theme.fontFamilyEn
                                    font.pixelSize: 16
                                    font.weight: Font.Bold
                                    LayoutMirroring.enabled: false
                                }
                            }
                        }
                    }

                    GlassInput {
                        id: usernameField
                        Layout.fillWidth: true
                        label: "نام کاربری"
                        placeholder: "admin"
                        icon: "👤"
                        nextField: passwordField
                        Component.onCompleted: {
                            // Force baseUrl to the local server (admin runs it
                            // internally — there is no remote server to point
                            // at, so the user shouldn't have to type it).
                            Api.baseUrl = "http://localhost:" + Network.port;
                        }
                    }

                    GlassInput {
                        id: passwordField
                        Layout.fillWidth: true
                        label: "رمز عبور"
                        placeholder: "••••••••"
                        icon: "🔒"
                        password: true
                        onSubmitted: page.submit()
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        visible: page.error.length > 0
                        radius: 10
                        color: Qt.rgba(0.94, 0.27, 0.27, 0.10)
                        border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                        height: visible ? 38 : 0
                        Text {
                            anchors.fill: parent
                            anchors.margins: 12
                            text: "⚠️ " + page.error
                            color: Theme.red
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            verticalAlignment: Text.AlignVCenter
                        }
                    }

                    GlassButton {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 48
                        text: page.loading ? "در حال ورود…" : "🚀 ورود به سیستم"
                        loading: page.loading
                        onClicked: page.submit()
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        height: 36; radius: 8
                        color: Theme.card
                        border.color: Theme.border; border.width: 1
                        Row {
                            anchors.centerIn: parent
                            spacing: 8
                            Text { text: "پیش‌فرض"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            Text { text: "admin / admin123"; color: Theme.text;  font.family: Theme.fontFamilyEn; font.pixelSize: 12; font.weight: Font.Bold }
                        }
                    }
                }
            }
        }
    }

    // ── Submit handler ────────────────────────────────────────────────
    function submit() {
        if (loading) return;
        if (!usernameField.text || !passwordField.text) {
            error = "نام کاربری و رمز عبور الزامی است";
            return;
        }
        error = "";
        loading = true;
        Api.adminLogin(usernameField.text, passwordField.text);
    }

    Connections {
        target: Api
        function onLoginDone(ok, msg) {
            page.loading = false;
            if (ok) page.loggedIn();
            else page.error = msg;
        }
    }
}
