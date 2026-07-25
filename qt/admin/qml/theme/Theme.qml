// Theme.qml — design tokens used across every page.
//
// Mirrors the dark-glassmorphism palette from the React admin (mute-game-admin
// mockup): deep indigo background, violet/pink accents, glassy surfaces with
// 1px borders. Centralising it here means one edit changes every page.
pragma Singleton
import QtQuick

QtObject {
    // ── Backgrounds
    readonly property color bg:        "#05060f"
    readonly property color bg2:       "#0a0b1a"
    readonly property color card:      Qt.rgba(1, 1, 1, 0.03)
    readonly property color cardHover: Qt.rgba(1, 1, 1, 0.05)

    // ── Borders & strokes
    readonly property color border:    Qt.rgba(1, 1, 1, 0.06)
    readonly property color border2:   Qt.rgba(0.55, 0.36, 0.96, 0.30) // violet glow

    // ── Text
    readonly property color text:      "#ffffff"
    readonly property color text2:     "#b4b8d0"
    readonly property color text3:     "#6b7090"

    // ── Accents
    readonly property color violet:    "#8b5cf6"
    readonly property color violetSoft:"#a78bfa"
    readonly property color indigo:    "#6366f1"
    readonly property color pink:      "#ec4899"
    readonly property color cyan:      "#06b6d4"
    readonly property color cyanSoft:  "#22d3ee"
    readonly property color orange:    "#fb923c"
    readonly property color green:     "#10b981"
    readonly property color amber:     "#f59e0b"
    readonly property color red:       "#ef4444"

    // ── Typography
    readonly property string fontFamily:    "Vazirmatn"
    readonly property string fontFamilyEn:  "Inter"
    readonly property int   fontSm:         12
    readonly property int   fontMd:         14
    readonly property int   fontLg:         18
    readonly property int   fontXl:         24
    readonly property int   font2xl:        32

    // ── Sizing
    readonly property int   radiusSm: 10
    readonly property int   radiusMd: 14
    readonly property int   radiusLg: 18
    readonly property int   radiusFull: 999

    // ── Spacing scale
    readonly property int   space1: 4
    readonly property int   space2: 8
    readonly property int   space3: 12
    readonly property int   space4: 16
    readonly property int   space6: 24
    readonly property int   space8: 32

    // ── Responsive breakpoints (window width). Pages should bind their
    //    grid `columns` to one of these helpers so the layout collapses on
    //    smaller screens without each page reimplementing the logic.
    readonly property int   bpSm:  640    // phones / small windows
    readonly property int   bpMd:  860    // tablets / half-screen
    readonly property int   bpLg:  1100   // typical laptop (lowered from 1280 so 13" Mac shows 4-col)
    readonly property int   bpXl:  1500   // wide desktop

    // Returns the number of columns for the stat-grid given a window width.
    function gridColumns(w) {
        if (w >= bpLg) return 4;          // 4 cols starting at 1100px
        if (w >= bpMd) return 2;
        return 1;
    }
    // 2-pane vs 1-pane layout (e.g. "chart + sidebar" → "stacked")
    function isCompact(w) { return w < bpLg; }
    function isMobile(w)  { return w < bpMd;  }
}

