// JalaliDatePicker — small popup calendar for Shamsi date selection.
//
// API:
//   open       — set true to show, false to hide. Tap outside or 🗙 closes.
//   isoDate    — Gregorian "YYYY-MM-DD". Set BEFORE open=true to pre-select;
//                read on `selected(iso)` to receive the chosen Gregorian ISO.
//   selected(iso) — fires when a day cell is tapped.
//
// All internal navigation (prev/next month, year display) is in Shamsi.
// The conversion to Gregorian on click happens via Jalali.shamsiToGregorianIso
// so the rest of the app keeps storing dates in canonical Gregorian ISO.
import QtQuick
import "../theme"

Rectangle {
    id: root
    anchors.fill: parent
    color: Qt.rgba(0.02, 0.02, 0.06, 0.78)
    visible: open
    z: 2500

    property bool   open: false
    property string isoDate: ""        // Gregorian ISO in/out
    signal selected(string isoDate)

    // Currently displayed Shamsi month/year (drives the grid)
    property int viewYear:  1405
    property int viewMonth: 1
    property int selDay:    0          // 0 = none selected in current view

    // Recompute view whenever we open
    onOpenChanged: if (open) syncFromIso()

    function syncFromIso() {
        // Pre-select the input date if provided, else today.
        let y, m, d;
        if (isoDate && isoDate.length === 10) {
            const sh = Jalali.toShamsiFromIso(isoDate);
            y = sh.y; m = sh.m; d = sh.d;
        } else {
            const today = Jalali.todayIso().split("-");
            y = parseInt(today[0]); m = parseInt(today[1]); d = parseInt(today[2]);
        }
        viewYear = y; viewMonth = m; selDay = d;
    }

    function shiftMonth(delta) {
        let m = viewMonth + delta;
        let y = viewYear;
        if (m < 1)  { m = 12; y -= 1; }
        if (m > 12) { m = 1;  y += 1; }
        viewYear = y; viewMonth = m;
    }

    function pick(day) {
        const iso = Jalali.shamsiToGregorianIso(viewYear, viewMonth, day);
        root.selected(iso);
        root.open = false;
    }

    // Tap outside dismisses
    MouseArea { anchors.fill: parent; onClicked: root.open = false }

    Rectangle {
        id: card
        width: 320
        height: 380
        anchors.centerIn: parent
        radius: 16
        color: Theme.card
        border.color: Theme.border2
        border.width: 1
        // Block click-through
        MouseArea { anchors.fill: parent }

        Column {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 12

            // ── Header: prev / Month Year / next ─────────────────
            Row {
                width: parent.width
                spacing: 8
                layoutDirection: Qt.RightToLeft

                Rectangle {
                    width: 32; height: 32; radius: 8
                    color: prevMA.containsMouse ? Theme.cardHover : "transparent"
                    border.color: Theme.border; border.width: 1
                    anchors.verticalCenter: parent.verticalCenter
                    Text { anchors.centerIn: parent; text: "›"; color: Theme.text; font.pixelSize: 18; font.weight: Font.Bold }
                    MouseArea { id: prevMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.shiftMonth(-1) }
                }

                Item {
                    height: 32
                    width: card.width - 32 - 32 - 8 - 8 - 32   // header w minus 2 buttons + spacing + margins
                    anchors.verticalCenter: parent.verticalCenter
                    Text {
                        anchors.centerIn: parent
                        text: Jalali.monthName(root.viewMonth) + "  " + root.viewYear
                        color: Theme.text
                        font.family: Theme.fontFamily
                        font.pixelSize: 15
                        font.weight: Font.Bold
                    }
                }

                Rectangle {
                    width: 32; height: 32; radius: 8
                    color: nextMA.containsMouse ? Theme.cardHover : "transparent"
                    border.color: Theme.border; border.width: 1
                    anchors.verticalCenter: parent.verticalCenter
                    Text { anchors.centerIn: parent; text: "‹"; color: Theme.text; font.pixelSize: 18; font.weight: Font.Bold }
                    MouseArea { id: nextMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.shiftMonth(1) }
                }
            }

            // ── Weekday header ────────────────────────────────────
            Grid {
                columns: 7
                width: parent.width
                rowSpacing: 4
                columnSpacing: 4
                horizontalItemAlignment: Grid.AlignHCenter

                Repeater {
                    model: ["ش", "ی", "د", "س", "چ", "پ", "ج"]
                    delegate: Item {
                        width: (card.width - 32 - 6 * 4) / 7
                        height: 22
                        Text {
                            anchors.centerIn: parent
                            text: modelData
                            color: Theme.text3
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                            font.weight: Font.Bold
                        }
                    }
                }
            }

            // ── Day grid ──────────────────────────────────────────
            Grid {
                id: dayGrid
                columns: 7
                width: parent.width
                rowSpacing: 4
                columnSpacing: 4
                horizontalItemAlignment: Grid.AlignHCenter

                readonly property int leading: Jalali.weekdayOfFirst(root.viewYear, root.viewMonth)
                readonly property int mlen:    Jalali.monthLength(root.viewYear, root.viewMonth)
                readonly property int cellW:   (card.width - 32 - 6 * 4) / 7

                Repeater {
                    model: 42                      // 6 rows × 7 cols
                    delegate: Item {
                        width: dayGrid.cellW
                        height: 32

                        readonly property int dayNum: index - dayGrid.leading + 1
                        readonly property bool valid: dayNum >= 1 && dayNum <= dayGrid.mlen
                        readonly property bool sel:   valid && dayNum === root.selDay

                        Rectangle {
                            visible: parent.valid
                            anchors.fill: parent
                            radius: 8
                            color: parent.sel
                                   ? Qt.rgba(0.55, 0.36, 0.96, 0.30)
                                   : (cellMA.containsMouse ? Theme.cardHover : "transparent")
                            border.color: parent.sel ? Qt.rgba(0.55, 0.36, 0.96, 0.55) : "transparent"
                            border.width: 1
                            Behavior on color { ColorAnimation { duration: 130 } }
                            Text {
                                anchors.centerIn: parent
                                text: parent.parent.dayNum
                                color: parent.parent.sel ? Theme.text : Theme.text2
                                font.family: Theme.fontFamilyEn
                                font.pixelSize: 12
                                font.weight: parent.parent.sel ? Font.Black : Font.Medium
                            }
                            MouseArea {
                                id: cellMA
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.pick(parent.parent.dayNum)
                            }
                        }
                    }
                }
            }

            Item { width: 1; height: 4 }    // spacer

            // ── Footer: today + close ─────────────────────────────
            Row {
                width: parent.width
                spacing: 8

                Rectangle {
                    width: (parent.width - parent.spacing) / 2; height: 32; radius: 8
                    color: todayMA.containsMouse ? Qt.rgba(0.06, 0.71, 0.83, 0.20) : Qt.rgba(0.06, 0.71, 0.83, 0.10)
                    border.color: Qt.rgba(0.06, 0.71, 0.83, 0.35); border.width: 1
                    Behavior on color { ColorAnimation { duration: 130 } }
                    Text { anchors.centerIn: parent; text: "📅 امروز"; color: Theme.cyanSoft; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                    MouseArea {
                        id: todayMA
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            const today = Jalali.todayIso().split("-");
                            const jy = parseInt(today[0]);
                            const jm = parseInt(today[1]);
                            const jd = parseInt(today[2]);
                            root.viewYear = jy;
                            root.viewMonth = jm;
                            root.pick(jd);
                        }
                    }
                }

                Rectangle {
                    width: (parent.width - parent.spacing) / 2; height: 32; radius: 8
                    color: closeMA.containsMouse ? Theme.cardHover : "transparent"
                    border.color: Theme.border; border.width: 1
                    Behavior on color { ColorAnimation { duration: 130 } }
                    Text { anchors.centerIn: parent; text: "بستن"; color: Theme.text2; font.family: Theme.fontFamily; font.pixelSize: 11; font.weight: Font.Bold }
                    MouseArea { id: closeMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.open = false }
                }
            }
        }
    }
}
