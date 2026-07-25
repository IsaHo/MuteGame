// GamesPage — manage the game catalogue (what the client kiosk shows on its
// "Games" home screen). Mirrors the React build: image upload, fixed
// category list, real-time refresh via Socket.io games:update event.
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import "../components"
import "../theme"

Item {
    id: page

    // Fixed taxonomy — must match server's expected category values and
    // the kiosk client's category filter pills.
    readonly property var categories: [
        { k: "all",      label: "همه",          icon: "🎮" },
        { k: "action",   label: "اکشن",         icon: "⚔️" },
        { k: "sport",    label: "ورزشی",        icon: "⚽" },
        { k: "racing",   label: "ماشینی",       icon: "🏎" },
        { k: "fps",      label: "تیراندازی",    icon: "🔫" },
        { k: "rpg",      label: "نقش‌آفرینی",   icon: "🐉" },
        { k: "strategy", label: "استراتژی",     icon: "♟" },
        { k: "sandbox",  label: "ساندباکس",     icon: "🧱" },
        { k: "other",    label: "سایر",         icon: "🎲" },
        { k: "launcher", label: "لانچر",        icon: "🚀" }
    ]

    function categoryLabel(k) {
        for (let i = 0; i < categories.length; ++i)
            if (categories[i].k === k) return categories[i].label;
        return k || "—";
    }
    function categoryIcon(k) {
        for (let i = 0; i < categories.length; ++i)
            if (categories[i].k === k) return categories[i].icon;
        return "🎮";
    }

    property var    games: []
    property string search: ""
    property string filter: "all"   // all | action | sport | … | launcher

    // Preset catalogue + image library — pulled lazily on first form open.
    property var    presets:        ({ items: [], categories: [] })
    property var    libraryFiles:   []

    readonly property int activeCount:   games.filter(g => g.active !== 0).length
    readonly property int inactiveCount: games.filter(g => g.active === 0).length
    readonly property int launcherCount: games.filter(g => g.is_launcher === 1).length

    readonly property var filteredGames: {
        const s = page.search.trim().toLowerCase();
        return games.filter(g => {
            // Category filter — launcher chip ignores g.category and matches is_launcher;
            // every other chip filters by g.category and excludes launchers.
            if (page.filter !== "all") {
                if (page.filter === "launcher") {
                    if (g.is_launcher !== 1) return false;
                } else {
                    if (g.is_launcher === 1) return false;
                    if ((g.category || "other") !== page.filter) return false;
                }
            }
            if (!s) return true;
            return (g.name || "").toLowerCase().includes(s)
                || (g.exe_name || "").toLowerCase().includes(s);
        });
    }

    Component.onCompleted: {
        Api.getGames(false);
        // Pre-warm the preset + library data so opening the form is snappy.
        Api.getGamePresets();
        Api.getGameLibrary();
        if (!Socket.connected) Socket.connectTo(Api.baseUrl);
    }

    Connections {
        target: Api
        function onGamesDone(rows)         { page.games = rows }
        function onGameMutationDone(ok, err) {
            if (!ok) { toast.show("خطا: " + err, "error"); return }
            Api.getGames(false);
            toast.show("ذخیره شد ✅", "success");
        }
        function onGameImageUploaded(ok, err) {
            if (!ok) { toast.show("آپلود تصویر ناموفق: " + err, "error"); return }
            Api.getGames(false);
            toast.show("تصویر آپلود شد ✅", "success");
        }
        function onGamePresetsDone(p)      { page.presets = p }
        function onGameLibraryDone(arr)    { page.libraryFiles = arr }
        function onGameAutoMatchDone(ok, matched, unmatched, err) {
            if (!ok) { toast.show("خطا در auto-match: " + (err || "نامشخص"), "error"); return }
            // Refresh so the new image_path values land in the grid immediately.
            Api.getGames(false);
            const total = matched + unmatched;
            if (total === 0) {
                // No eligible games — every active game already has an image.
                // This is a SUCCESS state, not an error. Tell the operator the
                // option to re-match everything via "force" if they want fresh
                // covers.
                toast.show("✅ همه بازی‌ها قبلاً تصویر دارن — برای جایگزینی، دوباره با گزینه‌ی force بزن", "success");
            } else if (matched === 0) {
                toast.show("⚠ هیچ تطبیقی پیدا نشد — library/ خالیه یا اسم فایل‌ها با اسم بازی نمی‌خونه", "error");
            } else if (unmatched === 0) {
                toast.show("✅ همه‌ی " + matched + " بازی تصویر گرفتند", "success");
            } else {
                toast.show("✅ " + matched + " از " + total + " بازی تطبیق گرفت · " + unmatched + " بدون تطبیق موند", "success");
            }
        }
    }

    // Real-time: server pushes games:update on every mutation. The payload
    // only contains *active* games (server filters WHERE active=1), but admin
    // view shows everything — refetch through the admin endpoint instead.
    Connections {
        target: Socket
        function onMessageReceived(name, _payload) {
            if (name === "games:update") Api.getGames(false);
        }
    }

    BgEffects {}

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 14

        // Topbar ──────────────────────────────────────────────────
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Text { text: "بازی‌ها"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 24; font.weight: Font.Bold }
            Text { text: "  ·  کاتالوگ"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 13 }

            Item { Layout.fillWidth: true }

            // Live indicator pill
            Rectangle {
                visible: Socket.connected
                height: 26; radius: 13
                width: liveT.implicitWidth + 24
                color: Qt.rgba(0.06, 0.73, 0.51, 0.12)
                border.color: Qt.rgba(0.06, 0.73, 0.51, 0.35); border.width: 1
                Row {
                    anchors.centerIn: parent; spacing: 6
                    Rectangle { width: 6; height: 6; radius: 3; color: Theme.green; anchors.verticalCenter: parent.verticalCenter
                        SequentialAnimation on opacity { loops: Animation.Infinite
                            NumberAnimation { from: 0.3; to: 1.0; duration: 800 }
                            NumberAnimation { from: 1.0; to: 0.3; duration: 800 }
                        }
                    }
                    Text { id: liveT; text: "live"; color: Theme.green; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Black; anchors.verticalCenter: parent.verticalCenter }
                }
            }

            GlassInput {
                Layout.preferredWidth: 240
                placeholder: "🔍 نام یا exe…"
                text: page.search
                onTextChanged: page.search = text
            }
            // One-click bulk apply: server matches each game without an image
            // to the closest library file by name (token-overlap fuzzy). Saves
            // the operator from picking from the gallery for each seed game.
            GlassButton {
                text: "🎨 تصویر خودکار"
                variant: "ghost"
                onClicked: confirmAutoMatch.open = true
            }
            GlassButton {
                text: "➕ بازی جدید"
                variant: "primary"
                onClicked: { gameForm.beginCreate(); gameForm.open = true }
            }
        }

        // Stat row ────────────────────────────────────────────────
        Row {
            Layout.fillWidth: true
            spacing: 8

            Repeater {
                model: [
                    { l: "همه",     n: page.games.length,        c: Theme.cyan },
                    { l: "فعال",    n: page.activeCount,         c: Theme.green },
                    { l: "غیرفعال", n: page.inactiveCount,       c: Theme.text3 },
                    { l: "لانچرها", n: page.launcherCount,       c: Theme.violet }
                ]
                delegate: Rectangle {
                    height: 32; radius: 16
                    width: psl.implicitWidth + cnT.implicitWidth + 50
                    color: Theme.card
                    border.color: Theme.border; border.width: 1
                    Row {
                        anchors.centerIn: parent; spacing: 8; layoutDirection: Qt.RightToLeft
                        Text { id: psl; text: modelData.l; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                        Rectangle {
                            width: cnT.implicitWidth + 14; height: 20; radius: 10
                            color: Qt.rgba(modelData.c.r, modelData.c.g, modelData.c.b, 0.20)
                            anchors.verticalCenter: parent.verticalCenter
                            Text { id: cnT; anchors.centerIn: parent; text: modelData.n; color: modelData.c; font.family: Theme.fontFamilyEn; font.pixelSize: 10; font.weight: Font.Black }
                        }
                    }
                }
            }
        }

        // Category filter chips ──────────────────────────────────
        Flickable {
            Layout.fillWidth: true
            Layout.preferredHeight: 38
            contentWidth: chipsRow.width
            contentHeight: 38
            clip: true
            flickableDirection: Flickable.HorizontalFlick

            Row {
                id: chipsRow
                spacing: 6
                layoutDirection: Qt.RightToLeft
                Repeater {
                    model: page.categories
                    delegate: Rectangle {
                        height: 34; radius: 17
                        width: chipText.implicitWidth + 28
                        property bool active: page.filter === modelData.k
                        color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.20) : Theme.card
                        border.color: active ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                        border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text {
                            id: chipText
                            anchors.centerIn: parent
                            text: modelData.icon + " " + modelData.label
                            color: parent.active ? Theme.violetSoft : Theme.text2
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: parent.active ? Font.Bold : Font.Medium
                        }
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: page.filter = modelData.k
                        }
                    }
                }
            }
        }

        // Empty state ────────────────────────────────────────────
        Column {
            visible: page.filteredGames.length === 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.alignment: Qt.AlignHCenter
            spacing: 14
            topPadding: 80
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                width: 96; height: 96; radius: 24
                color: Qt.rgba(0.55, 0.36, 0.96, 0.10)
                border.color: Qt.rgba(0.55, 0.36, 0.96, 0.25); border.width: 1
                Text { anchors.centerIn: parent; text: "🎮"; font.pixelSize: 48 }
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.games.length === 0 ? "هیچ بازی‌ای ثبت نشده" : "هیچ بازی‌ای پیدا نشد"
                color: Theme.text2
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.games.length === 0 ? "از دکمه «بازی جدید» شروع کن" : "فیلتر یا جستجو رو عوض کن"
                color: Theme.text3
                font.family: Theme.fontFamily
                font.pixelSize: 11
            }
        }

        // Grid ───────────────────────────────────────────────────
        // Use Flickable + GridLayout instead of ScrollView so vertical
        // scrolling works reliably when many games are listed. ScrollView's
        // contentHeight detection was failing for the GridLayout child.
        Flickable {
            id: gamesScroll
            visible: page.filteredGames.length > 0
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: width
            contentHeight: grid.implicitHeight + 12
            boundsBehavior: Flickable.StopAtBounds

            ScrollBar.vertical: ScrollBar {
                policy: ScrollBar.AsNeeded
                active: true
            }

            GridLayout {
                id: grid
                width: parent.width
                columns: Math.max(1, Math.floor(width / 220))
                columnSpacing: 14
                rowSpacing: 14

                Repeater {
                    model: page.filteredGames
                    delegate: GameCard {
                        Layout.fillWidth: true
                        Layout.preferredWidth: 100
                        Layout.preferredHeight: 280
                        game: modelData
                        onEdit: { gameForm.beginEdit(modelData); gameForm.open = true }
                        onRemove: { confirmRemove.target = modelData; confirmRemove.open = true }
                        onToggleActive: Api.updateGame(modelData.id,
                            { active: modelData.active === 0 ? 1 : 0 })
                        onPickImage: {
                            cardImageDialog.targetId = modelData.id;
                            cardImageDialog.open();
                        }
                    }
                }
            }
        }
    }

    // ── File dialog for inline card click (upload immediately) ────────
    FileDialog {
        id: cardImageDialog
        property int targetId: -1
        title: "انتخاب تصویر بازی"
        // First entry is the curated extension list (operator usually wants
        // to see only image files in the picker). Second entry is a wildcard
        // escape hatch for unusual formats — the server still validates by
        // extension + MIME so dropping an .exe here gets rejected upstream.
        nameFilters: [
            "تصاویر (*.png *.jpg *.jpeg *.jfif *.webp *.gif *.bmp *.tiff *.tif *.svg *.ico *.avif *.heic *.heif *.apng)",
            "همه فایل‌ها (*)"
        ]
        fileMode: FileDialog.OpenFile
        onAccepted: {
            if (cardImageDialog.targetId > 0)
                Api.uploadGameImage(cardImageDialog.targetId, selectedFile.toString());
        }
    }

    // ── File dialog for the form modal (defer upload until save) ──────
    FileDialog {
        id: modalImageDialog
        title: "انتخاب تصویر بازی"
        // First entry is the curated extension list (operator usually wants
        // to see only image files in the picker). Second entry is a wildcard
        // escape hatch for unusual formats — the server still validates by
        // extension + MIME so dropping an .exe here gets rejected upstream.
        nameFilters: [
            "تصاویر (*.png *.jpg *.jpeg *.jfif *.webp *.gif *.bmp *.tiff *.tif *.svg *.ico *.avif *.heic *.heif *.apng)",
            "همه فایل‌ها (*)"
        ]
        fileMode: FileDialog.OpenFile
        onAccepted: {
            gameForm.pendingImagePath = selectedFile.toString();
            // For edit: upload immediately so other clients see it right away.
            if (gameForm.editId >= 0) {
                Api.uploadGameImage(gameForm.editId, selectedFile.toString());
            }
        }
    }

    // ── Game form modal ──────────────────────────────────────────────
    Rectangle {
        id: gameForm
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        visible: open
        z: 1500
        property bool open: false
        property int  editId: -1
        property string title: ""
        property string pendingImagePath: ""
        property string existingImage: ""

        function beginCreate() {
            editId = -1;
            title = "➕ بازی جدید";
            nameI.text = ""; exeI.text = ""; sortI.text = "0"; hintI.text = "";
            categoryKey = "other";
            launcherChip = false;
            pendingImagePath = "";
            existingImage = "";
            activeChip = true;
        }
        function beginEdit(g) {
            editId = g.id;
            title = "✏️ ویرایش بازی";
            nameI.text = g.name || "";
            exeI.text  = g.exe_name || "";
            sortI.text = String(g.sort_order || 0);
            hintI.text = g.hint_path || "";
            categoryKey  = g.category || "other";
            launcherChip = (g.is_launcher === 1);
            pendingImagePath = "";
            existingImage = g.image_path || "";
            activeChip = (g.active !== 0);
        }
        property bool launcherChip: false
        property bool activeChip:   true
        property string categoryKey: "other"

        readonly property string previewSrc:
            pendingImagePath ? pendingImagePath
                             : (existingImage ? Api.gameImageUrl(existingImage) : "")

        MouseArea { anchors.fill: parent; onClicked: gameForm.open = false }

        Rectangle {
            width: 520
            height: Math.min(parent.height - 40, contentColumn.implicitHeight + 32)
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }

            ScrollView {
                anchors.fill: parent
                anchors.margins: 20
                clip: true
                contentWidth: availableWidth

                ColumnLayout {
                    id: contentColumn
                    width: parent.width
                    spacing: 12

                    Text { text: gameForm.title; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold; Layout.fillWidth: true }

                    // Quick-fill from preset library — pops a searchable list
                    // of well-known games & launchers. One click fills name +
                    // exe + category + emoji + is_launcher into the form.
                    Row {
                        Layout.fillWidth: true
                        spacing: 8
                        layoutDirection: Qt.RightToLeft

                        Rectangle {
                            height: 40; radius: 12
                            width: Math.min(220, parent.width / 2 - 4)
                            color: presetMA.containsMouse
                                ? Qt.rgba(0.55, 0.36, 0.96, 0.32)
                                : Qt.rgba(0.55, 0.36, 0.96, 0.18)
                            border.color: Qt.rgba(0.55, 0.36, 0.96, 0.45)
                            border.width: 1
                            Behavior on color { ColorAnimation { duration: 130 } }
                            Text {
                                anchors.centerIn: parent
                                text: "📚 از لیست بازی‌ها"
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: 12
                                font.weight: Font.Bold
                            }
                            MouseArea {
                                id: presetMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (page.presets && page.presets.items && page.presets.items.length === 0)
                                        Api.getGamePresets();
                                    presetPicker.open = true;
                                }
                            }
                        }
                        Rectangle {
                            height: 40; radius: 12
                            width: Math.min(220, parent.width / 2 - 4)
                            color: galleryMA.containsMouse
                                ? Qt.rgba(0.06, 0.73, 0.51, 0.32)
                                : Qt.rgba(0.06, 0.73, 0.51, 0.18)
                            border.color: Qt.rgba(0.06, 0.73, 0.51, 0.45)
                            border.width: 1
                            Behavior on color { ColorAnimation { duration: 130 } }
                            Text {
                                anchors.centerIn: parent
                                text: "🖼 از مجموعه تصاویر"
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: 12
                                font.weight: Font.Bold
                            }
                            MouseArea {
                                id: galleryMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (gameForm.editId < 0) {
                                        toast.show("⚠ اول بازی را ذخیره کن، بعد عکس از کتابخانه انتخاب کن", "warning");
                                        return;
                                    }
                                    Api.getGameLibrary();   // refresh in case operator just added files
                                    gallery.open = true;
                                }
                            }
                        }
                    }

                    // Image picker tile ──────────────────────────────
                    Column {
                        Layout.fillWidth: true; spacing: 4
                        Text { text: "تصویر بازی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        Rectangle {
                            width: parent.width; height: 160; radius: 14
                            color: Theme.card
                            border.color: Theme.border2; border.width: 1
                            // Background image
                            Image {
                                id: previewImg
                                anchors.fill: parent
                                source: gameForm.previewSrc
                                fillMode: Image.PreserveAspectCrop
                                visible: source != ""
                                cache: false
                                asynchronous: true
                            }
                            Rectangle {
                                anchors.fill: parent
                                color: "transparent"
                                radius: 14
                                border.color: Theme.border2; border.width: 1
                            }
                            // Empty state overlay
                            Column {
                                visible: !previewImg.visible
                                anchors.centerIn: parent
                                spacing: 4
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "🖼"; font.pixelSize: 36; opacity: 0.85 }
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "کلیک کن تا تصویر انتخاب کنی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 12 }
                                Text { anchors.horizontalCenter: parent.horizontalCenter; text: "PNG / JPG / WEBP — حداکثر ۴ مگابایت"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 10; opacity: 0.7 }
                            }
                            // Hover hint when image is set
                            Rectangle {
                                visible: previewImg.visible
                                anchors.bottom: parent.bottom; anchors.left: parent.left; anchors.right: parent.right
                                height: 32
                                gradient: Gradient {
                                    GradientStop { position: 0.0; color: Qt.rgba(0, 0, 0, 0) }
                                    GradientStop { position: 1.0; color: Qt.rgba(0, 0, 0, 0.65) }
                                }
                                radius: 14
                                Text {
                                    anchors.centerIn: parent
                                    text: "🔁 کلیک برای تعویض"
                                    color: Theme.text
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 11
                                    font.weight: Font.Bold
                                }
                            }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: modalImageDialog.open() }
                        }
                        Text {
                            visible: gameForm.pendingImagePath !== "" && gameForm.editId < 0
                            text: "📎 بعد از ذخیره ارسال می‌شود"
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                            topPadding: 4
                        }
                    }

                    // Name + exe ───────────────────────────────────
                    Column { Layout.fillWidth: true; spacing: 4
                        Text { text: "نام بازی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: nameI; width: parent.width; placeholder: "Counter-Strike 2" }
                    }
                    Column { Layout.fillWidth: true; spacing: 4
                        Text { text: "نام فایل اجرایی (.exe) — کلاینت با این اسم سرچ می‌کند"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: exeI; width: parent.width; placeholder: "cs2.exe" }
                    }

                    // Category dropdown + sort order ───────────────
                    Row { Layout.fillWidth: true; spacing: 10
                        Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                            Text { text: "دسته‌بندی"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            ComboBox {
                                id: catCombo
                                width: parent.width
                                height: 38
                                model: page.categories.filter(c => c.k !== "all" && c.k !== "launcher")
                                textRole: "label"
                                valueRole: "k"
                                currentIndex: {
                                    const m = catCombo.model;
                                    for (let i = 0; i < m.length; ++i)
                                        if (m[i].k === gameForm.categoryKey) return i;
                                    return 0;
                                }
                                onActivated: gameForm.categoryKey = catCombo.model[currentIndex].k
                                background: Rectangle {
                                    radius: 10
                                    color: Theme.card
                                    border.color: Theme.border; border.width: 1
                                }
                                contentItem: Text {
                                    leftPadding: 12; rightPadding: 28
                                    verticalAlignment: Text.AlignVCenter
                                    horizontalAlignment: Text.AlignRight
                                    text: {
                                        const m = catCombo.model;
                                        for (let i = 0; i < m.length; ++i)
                                            if (m[i].k === gameForm.categoryKey)
                                                return m[i].icon + " " + m[i].label;
                                        return "";
                                    }
                                    color: Theme.text
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 13
                                }
                                delegate: ItemDelegate {
                                    width: catCombo.width
                                    height: 36
                                    contentItem: Text {
                                        text: modelData.icon + " " + modelData.label
                                        color: Theme.text
                                        font.family: Theme.fontFamily
                                        font.pixelSize: 13
                                        horizontalAlignment: Text.AlignRight
                                        verticalAlignment: Text.AlignVCenter
                                        rightPadding: 12
                                    }
                                    background: Rectangle { color: hovered ? Theme.cardHover : "transparent" }
                                }
                                popup.background: Rectangle { color: Theme.bg2; border.color: Theme.border; border.width: 1; radius: 10 }
                            }
                        }
                        Column { width: (parent.width - parent.spacing) / 2; spacing: 4
                            Text { text: "ترتیب نمایش"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                            GlassInput { id: sortI; width: parent.width; placeholder: "0"; numeric: true }
                        }
                    }

                    // Hint path ────────────────────────────────────
                    Column { Layout.fillWidth: true; spacing: 4
                        Text { text: "مسیر کمکی (hint_path) — اگر اسم exe پیدا نشد"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                        GlassInput { id: hintI; width: parent.width; placeholder: "C:\\Program Files\\Steam\\..." }
                    }

                    // Launcher + Active chips ──────────────────────
                    Row { Layout.fillWidth: true; spacing: 10
                        Rectangle {
                            height: 38; radius: 19
                            width: lcT.implicitWidth + 28
                            property bool on: gameForm.launcherChip
                            color: on ? Qt.rgba(0.55, 0.36, 0.96, 0.20) : Theme.card
                            border.color: on ? Qt.rgba(0.55, 0.36, 0.96, 0.40) : Theme.border
                            border.width: 1
                            Text { id: lcT; anchors.centerIn: parent; text: (gameForm.launcherChip ? "✓ " : "○ ") + "🚀 لانچر"; color: parent.on ? Theme.violetSoft : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: gameForm.launcherChip = !gameForm.launcherChip }
                        }
                        Rectangle {
                            height: 38; radius: 19
                            width: acT.implicitWidth + 28
                            property bool on: gameForm.activeChip
                            color: on ? Qt.rgba(0.06, 0.73, 0.51, 0.20) : Qt.rgba(0.94, 0.27, 0.27, 0.15)
                            border.color: on ? Qt.rgba(0.06, 0.73, 0.51, 0.40) : Qt.rgba(0.94, 0.27, 0.27, 0.40)
                            border.width: 1
                            Text { id: acT; anchors.centerIn: parent; text: (gameForm.activeChip ? "● فعال" : "○ غیرفعال"); color: parent.on ? Theme.green : Theme.red; font.family: Theme.fontFamily; font.pixelSize: 12; font.weight: Font.Bold }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: gameForm.activeChip = !gameForm.activeChip }
                        }
                        Item { Layout.fillWidth: true; height: 1 }
                    }

                    // Buttons ──────────────────────────────────────
                    RowLayout { Layout.fillWidth: true; spacing: 10
                        GlassButton { text: "انصراف"; variant: "ghost"; onClicked: gameForm.open = false }
                        GlassButton {
                            Layout.fillWidth: true
                            text: gameForm.editId >= 0 ? "✅ ذخیره" : "✅ ثبت"
                            variant: "primary"
                            onClicked: {
                                if (!nameI.text || !exeI.text) { toast.show("نام و exe_name الزامی است", "error"); return }
                                const data = {
                                    name:        nameI.text,
                                    exe_name:    exeI.text,
                                    category:    gameForm.categoryKey,
                                    sort_order:  Number(String(sortI.text).replace(/,/g, "")) || 0,
                                    hint_path:   hintI.text,
                                    is_launcher: gameForm.launcherChip ? 1 : 0,
                                    active:      gameForm.activeChip ? 1 : 0
                                };
                                if (gameForm.editId >= 0) {
                                    Api.updateGame(gameForm.editId, data);
                                } else {
                                    // For create: only arm the deferred uploader if user picked an image.
                                    if (gameForm.pendingImagePath) {
                                        pendingCreate.image = gameForm.pendingImagePath;
                                        pendingCreate.armed = true;
                                    }
                                    Api.createGame(data);
                                }
                                gameForm.open = false;
                            }
                        }
                    }
                }
            }
        }
    }

    // After create finishes, the latest record (highest id) is ours — upload
    // the deferred image to it. We snapshot the prior highest id, then
    // refetch and post to whatever is new.
    QtObject {
        id: pendingCreate
        property bool   armed: false
        property string image: ""
        property int    priorMaxId: 0
    }
    Connections {
        target: Api
        function onGamesDone(rows) {
            if (pendingCreate.armed && pendingCreate.image) {
                // Find the new game (max id), upload to it.
                let newId = 0;
                for (let i = 0; i < rows.length; ++i)
                    if (rows[i].id > newId) newId = rows[i].id;
                if (newId > pendingCreate.priorMaxId) {
                    Api.uploadGameImage(newId, pendingCreate.image);
                    pendingCreate.armed = false;
                    pendingCreate.image = "";
                }
                pendingCreate.priorMaxId = newId;
            } else {
                let m = 0;
                for (let i = 0; i < rows.length; ++i) if (rows[i].id > m) m = rows[i].id;
                pendingCreate.priorMaxId = m;
            }
        }
    }

    ConfirmDialog {
        id: confirmRemove
        property var target: ({})
        title: "حذف بازی"
        body: "بازی «" + (target.name || "") + "» حذف بشه؟"
        confirmText: "🗑 حذف"
        confirmVariant: "danger"
        onConfirmed: Api.deleteGame(target.id)
    }

    // Bulk auto-match: pop a clear confirmation so the operator knows what's
    // about to happen — server only touches games that already lack an image
    // (default), but force=true overrides everything (we expose that as a
    // secondary "force" follow-up if the first run leaves gaps).
    ConfirmDialog {
        id: confirmAutoMatch
        title: "اعمال خودکار تصویر برای بازی‌ها"
        body: "برای هر بازی که تصویر نداره، نزدیک‌ترین فایل از پوشه library/ بر اساس اسم اعمال میشه. ادامه؟"
        confirmText: "🎨 اعمال کن"
        confirmVariant: "primary"
        onConfirmed: Api.autoMatchGameImages(false)
    }

    Toast { id: toast }

    // ── GameCard ─────────────────────────────────────────────────────
    component GameCard: Rectangle {
        property var game: ({})
        signal edit()
        signal remove()
        signal toggleActive()
        signal pickImage()

        readonly property bool isActive: game.active !== 0
        readonly property string imgUrl: game.image_path ? Api.gameImageUrl(game.image_path) : ""
        radius: 14
        color: Theme.card
        border.color: Theme.border; border.width: 1
        opacity: isActive ? 1 : 0.55
        clip: true

        ColumnLayout {
            anchors.fill: parent
            spacing: 0

            // Image area (top) ─ 140px ────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 140
                color: "transparent"
                clip: true

                // Gradient placeholder (shown when no image)
                Rectangle {
                    anchors.fill: parent
                    visible: cardImg.status !== Image.Ready
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0.0; color: Qt.rgba(0.55, 0.36, 0.96, 0.20) }
                        GradientStop { position: 1.0; color: Qt.rgba(0.06, 0.71, 0.83, 0.10) }
                    }
                    Column {
                        anchors.centerIn: parent
                        spacing: 4
                        Text { anchors.horizontalCenter: parent.horizontalCenter; text: "📷"; font.pixelSize: 32; opacity: 0.7 }
                        Text { anchors.horizontalCenter: parent.horizontalCenter; text: "کلیک برای تصویر"; color: Theme.text3; font.family: Theme.fontFamily; font.pixelSize: 11 }
                    }
                }
                Image {
                    id: cardImg
                    anchors.fill: parent
                    source: imgUrl
                    fillMode: Image.PreserveAspectCrop
                    cache: false
                    asynchronous: true
                }
                // Top badges (launcher + inactive)
                Row {
                    anchors.top: parent.top; anchors.right: parent.right
                    anchors.margins: 8
                    spacing: 6
                    layoutDirection: Qt.RightToLeft
                    Rectangle {
                        visible: game.is_launcher === 1
                        height: 22; radius: 11
                        width: lT.implicitWidth + 18
                        color: Qt.rgba(0.06, 0.71, 0.83, 0.85)
                        Text { id: lT; anchors.centerIn: parent; text: "🚀 لانچر"; color: "#fff"; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                    }
                    Rectangle {
                        visible: !isActive
                        height: 22; radius: 11
                        width: iaT.implicitWidth + 18
                        color: Qt.rgba(0.94, 0.27, 0.27, 0.85)
                        Text { id: iaT; anchors.centerIn: parent; text: "غیرفعال"; color: "#fff"; font.family: Theme.fontFamily; font.pixelSize: 10; font.weight: Font.Bold }
                    }
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: pickImage()
                    hoverEnabled: true
                    Rectangle {
                        anchors.fill: parent
                        color: parent.containsMouse ? Qt.rgba(0, 0, 0, 0.25) : "transparent"
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text {
                            visible: parent.parent.containsMouse
                            anchors.centerIn: parent
                            text: "🖼  تعویض تصویر"
                            color: "#fff"
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            font.weight: Font.Bold
                        }
                    }
                }
            }

            // Body ────────────────────────────────────────────────
            Column {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 6
                padding: 12

                // Name
                Text {
                    width: parent.width - 24
                    text: game.name || "—"
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: 14
                    font.weight: Font.Bold
                    elide: Text.ElideRight
                }
                // exe_name (mono font, dir LTR)
                Text {
                    width: parent.width - 24
                    text: game.exe_name || "—"
                    color: Theme.cyanSoft
                    font.family: Theme.fontFamilyEn
                    font.pixelSize: 11
                    elide: Text.ElideMiddle
                }
                // Category + sort badge
                Row {
                    spacing: 6
                    Rectangle {
                        height: 20; radius: 10
                        width: catT.implicitWidth + 14
                        color: Qt.rgba(0.96, 0.62, 0.04, 0.10)
                        border.color: Qt.rgba(0.96, 0.62, 0.04, 0.30); border.width: 1
                        Text { id: catT; anchors.centerIn: parent; text: page.categoryIcon(game.category) + " " + page.categoryLabel(game.category); color: Theme.amber; font.family: Theme.fontFamily; font.pixelSize: 9; font.weight: Font.Bold }
                    }
                    Rectangle {
                        height: 20; radius: 10
                        width: srT.implicitWidth + 14
                        color: Theme.bg2
                        border.color: Theme.border; border.width: 1
                        Text { id: srT; anchors.centerIn: parent; text: "#" + (game.sort_order || 0); color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 9 }
                    }
                }

                // Action buttons (anchored bottom)
                Item { width: parent.width - 24; height: 8 }
                Row {
                    width: parent.width - 24
                    spacing: 5
                    Rectangle {
                        width: 36; height: 30; radius: 8
                        color: tglMA.containsMouse
                            ? (isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.20) : Qt.rgba(0.06, 0.73, 0.51, 0.20))
                            : (isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.10) : Qt.rgba(0.06, 0.73, 0.51, 0.10))
                        border.color: isActive ? Qt.rgba(0.96, 0.62, 0.04, 0.30) : Qt.rgba(0.06, 0.73, 0.51, 0.30); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: isActive ? "🚫" : "👁"; font.pixelSize: 13 }
                        MouseArea { id: tglMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: toggleActive() }
                    }
                    Rectangle {
                        width: (parent.width - 36 - parent.spacing * 2) / 2; height: 30; radius: 8
                        color: edMA.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : Qt.rgba(0.06, 0.71, 0.83, 0.10)
                        border.color: Qt.rgba(0.06, 0.71, 0.83, 0.30); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: "✏️ ویرایش"; color: Theme.cyanSoft; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                        MouseArea { id: edMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: edit() }
                    }
                    Rectangle {
                        width: (parent.width - 36 - parent.spacing * 2) / 2; height: 30; radius: 8
                        color: rmMA.containsMouse ? Qt.rgba(0.94, 0.27, 0.27, 0.20) : Qt.rgba(0.94, 0.27, 0.27, 0.10)
                        border.color: Qt.rgba(0.94, 0.27, 0.27, 0.30); border.width: 1
                        Behavior on color { ColorAnimation { duration: 130 } }
                        Text { anchors.centerIn: parent; text: "🗑 حذف"; color: Theme.red; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                        MouseArea { id: rmMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: remove() }
                    }
                }
            }
        }
    }

    // ── Preset picker dialog — searchable, category-filtered list ────────
    // Pulled from /api/games/presets (data/game-presets.json on disk). Click
    // an item → autofill the form fields. Doesn't submit; operator confirms.
    Rectangle {
        id: presetPicker
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        z: 2000
        visible: open
        property bool   open: false
        property string search: ""
        property string catFilter: ""    // empty = all

        function applyPreset(p) {
            nameI.text     = p.name || "";
            exeI.text      = p.exe_name || "";
            sortI.text     = "0";
            hintI.text     = "";
            // Map preset category → admin category. Both share most keys
            // (action / sport→sports / racing / fps→shooter), but the
            // preset list is richer; fall back to "other" for anything we
            // don't have a chip for.
            const map = { "shooter":"fps", "battle-royale":"fps", "moba":"strategy",
                          "popular":"action", "indie":"other", "browser":"other",
                          "chat":"other", "media":"other", "tool":"other",
                          "rpg":"rpg", "racing":"racing", "sports":"sport",
                          "sandbox":"sandbox", "survival":"sandbox", "strategy":"strategy",
                          "action":"action", "launcher":"launcher" };
            gameForm.categoryKey = map[p.category] || "other";
            gameForm.launcherChip = p.is_launcher === 1;
            presetPicker.open = false;
        }

        readonly property var filtered: {
            const s = search.trim().toLowerCase();
            const list = (page.presets && page.presets.items) || [];
            return list.filter(function (p) {
                if (catFilter && p.category !== catFilter) return false;
                if (!s) return true;
                return (p.name || "").toLowerCase().includes(s)
                    || (p.exe_name || "").toLowerCase().includes(s);
            });
        }

        MouseArea { anchors.fill: parent; onClicked: presetPicker.open = false }
        Rectangle {
            width: Math.min(parent.width - 80, 720)
            height: Math.min(parent.height - 80, 620)
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 12

                Row {
                    Layout.fillWidth: true; spacing: 10
                    layoutDirection: Qt.RightToLeft
                    Text { text: "📚"; font.pixelSize: 22; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "انتخاب از لیست بازی‌ها و برنامه‌ها"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Item { width: 8; height: 1 }
                    Text { text: presetPicker.filtered.length + " مورد"; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                }
                GlassInput {
                    Layout.fillWidth: true
                    placeholder: "🔍 جستجوی بازی، برنامه یا exe…"
                    text: presetPicker.search
                    onTextChanged: presetPicker.search = text
                }
                // Category chips — horizontal scroll
                Flickable {
                    Layout.fillWidth: true
                    contentWidth: chipRow.implicitWidth
                    height: 36
                    flickableDirection: Flickable.HorizontalFlick
                    clip: true
                    Row {
                        id: chipRow
                        spacing: 6
                        layoutDirection: Qt.RightToLeft
                        Repeater {
                            model: {
                                const arr = [{ k: "", l: "همه" }];
                                const cats = (page.presets && page.presets.categories) || [];
                                for (let i = 0; i < cats.length; ++i) arr.push(cats[i]);
                                return arr;
                            }
                            delegate: Rectangle {
                                height: 30; radius: 15
                                width: chipT.implicitWidth + 18
                                property bool sel: presetPicker.catFilter === modelData.k
                                color: sel ? Qt.rgba(0.55, 0.36, 0.96, 0.30) : Theme.card
                                border.color: sel ? Qt.rgba(0.55, 0.36, 0.96, 0.50) : Theme.border
                                border.width: 1
                                Behavior on color { ColorAnimation { duration: 120 } }
                                Text { id: chipT; anchors.centerIn: parent; text: modelData.l; color: parent.sel ? Theme.text : Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: presetPicker.catFilter = modelData.k }
                            }
                        }
                    }
                }
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 4
                    clip: true
                    model: presetPicker.filtered
                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 50; radius: 10
                        color: presMA.containsMouse ? Theme.cardHover : Theme.card
                        border.color: Theme.border; border.width: 1
                        Behavior on color { ColorAnimation { duration: 100 } }
                        Row {
                            anchors.fill: parent
                            anchors.margins: 10
                            spacing: 12
                            layoutDirection: Qt.RightToLeft
                            Text { text: modelData.emoji || "🎮"; font.pixelSize: 24; anchors.verticalCenter: parent.verticalCenter }
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text { text: modelData.name; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 13; font.weight: Font.Bold }
                                Text { text: modelData.exe_name; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 10 }
                            }
                            Item { width: 1; Layout.fillWidth: true }
                            Rectangle {
                                anchors.verticalCenter: parent.verticalCenter
                                height: 22; radius: 11
                                width: catT.implicitWidth + 14
                                color: Qt.rgba(0.55, 0.36, 0.96, 0.18)
                                border.color: Qt.rgba(0.55, 0.36, 0.96, 0.30); border.width: 1
                                Text { id: catT; anchors.centerIn: parent; text: modelData.category; color: Theme.violetSoft; font.family: Theme.fontFamilyEn; font.pixelSize: 9; font.weight: Font.Bold }
                            }
                        }
                        MouseArea {
                            id: presMA
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: presetPicker.applyPreset(modelData)
                        }
                    }
                }
                GlassButton { Layout.alignment: Qt.AlignHCenter; text: "بستن"; variant: "ghost"; onClicked: presetPicker.open = false }
            }
        }
    }

    // ── Image-library gallery — visual grid of pre-stocked images ────────
    Rectangle {
        id: gallery
        anchors.fill: parent
        color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
        z: 2000
        visible: open
        property bool open: false

        MouseArea { anchors.fill: parent; onClicked: gallery.open = false }
        Rectangle {
            width: Math.min(parent.width - 80, 760)
            height: Math.min(parent.height - 80, 600)
            anchors.centerIn: parent
            radius: 16
            color: Theme.bg2
            border.color: Theme.border2; border.width: 1
            MouseArea { anchors.fill: parent }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 18
                spacing: 12
                Row {
                    Layout.fillWidth: true; spacing: 10
                    layoutDirection: Qt.RightToLeft
                    Text { text: "🖼"; font.pixelSize: 22; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: "مجموعه تصاویر"; color: Theme.text; font.family: Theme.fontFamily; font.pixelSize: 16; font.weight: Font.Bold; anchors.verticalCenter: parent.verticalCenter }
                    Item { width: 8; height: 1 }
                    Text { text: page.libraryFiles.length + " تصویر"; color: Theme.text3; font.family: Theme.fontFamilyEn; font.pixelSize: 11; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    Layout.fillWidth: true
                    text: "تصاویر در فولدر server/images/library/ قرار می‌گیرن. می‌تونی فایل‌های دلخواه رو همونجا کپی کنی و دکمه «از مجموعه» رو بزنی."
                    color: Theme.text3
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    wrapMode: Text.Wrap
                }
                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    contentWidth: availableWidth
                    GridLayout {
                        width: parent.width
                        columns: Math.max(2, Math.floor(width / 160))
                        columnSpacing: 10
                        rowSpacing: 10
                        Repeater {
                            model: page.libraryFiles
                            delegate: Rectangle {
                                Layout.preferredWidth: 150
                                Layout.preferredHeight: 150
                                radius: 12
                                color: galMA.containsMouse ? Theme.cardHover : Theme.card
                                border.color: galMA.containsMouse ? Qt.rgba(0.06,0.73,0.51,0.55) : Theme.border
                                border.width: 1
                                clip: true
                                Behavior on color { ColorAnimation { duration: 100 } }
                                Image {
                                    anchors.fill: parent
                                    anchors.margins: 4
                                    source: Api.gameLibraryUrl(modelData)
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                    cache: true
                                }
                                Rectangle {
                                    anchors.bottom: parent.bottom; anchors.left: parent.left; anchors.right: parent.right
                                    height: 24
                                    color: Qt.rgba(0, 0, 0, 0.65)
                                    Text {
                                        anchors.centerIn: parent
                                        text: modelData
                                        color: "white"
                                        font.family: Theme.fontFamilyEn
                                        font.pixelSize: 10
                                        elide: Text.ElideMiddle
                                        width: parent.width - 8
                                        horizontalAlignment: Text.AlignHCenter
                                    }
                                }
                                MouseArea {
                                    id: galMA
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (gameForm.editId < 0) {
                                            toast.show("⚠ اول بازی را ذخیره کن", "warning");
                                            return;
                                        }
                                        Api.setGameImageFromLibrary(gameForm.editId, modelData);
                                        gallery.open = false;
                                    }
                                }
                            }
                        }
                    }
                }
                Row {
                    Layout.alignment: Qt.AlignHCenter; spacing: 10
                    GlassButton { text: "🔄 تازه‌سازی"; variant: "ghost"; onClicked: Api.getGameLibrary() }
                    GlassButton { text: "بستن"; variant: "ghost"; onClicked: gallery.open = false }
                }
            }
        }
    }
}
