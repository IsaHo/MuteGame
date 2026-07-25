// LineChart — Canvas-drawn area chart for the 7-day revenue report.
//
// Inputs:
//   series  — JS array of { date: "YYYY-MM-DD", value: number }
//   accent  — line + glow colour
//
// Renders: gradient-filled area under the line, glowing line on top, dots
// at each point, faint horizontal gridlines, labelled X axis. Designed to
// match the React/recharts version visually.
import QtQuick
import "../theme"

Item {
    id: root
    property var   series: []
    property color accent: Theme.violetSoft
    property string yPrefix: ""

    implicitHeight: 280

    Canvas {
        id: cv
        anchors.fill: parent
        antialiasing: true
        renderTarget: Canvas.FramebufferObject

        property int  pad: 36

        Connections {
            target: root
            function onSeriesChanged() { cv.requestPaint() }
            function onAccentChanged() { cv.requestPaint() }
        }
        onWidthChanged:  requestPaint()
        onHeightChanged: requestPaint()
        Component.onCompleted: requestPaint()    // trigger first render

        // Convert a Qt color to "rgba(R,G,B,A)" CSS string. Qt's color.r/g/b are
        // floats 0–1; multiply by 255 and round.
        function rgba(c, alpha) {
            return "rgba(" +
                Math.round(c.r * 255) + "," +
                Math.round(c.g * 255) + "," +
                Math.round(c.b * 255) + "," + alpha + ")";
        }

        onPaint: {
            const ctx = getContext("2d");
            ctx.reset();
            const w = width, h = height, p = pad;

            // Always draw a faint background panel so the area is visible
            // even while data is loading.
            ctx.fillStyle = "rgba(255,255,255,0.01)";
            ctx.fillRect(0, 0, w, h);

            const data = root.series || [];
            const n = data.length;
            if (n === 0) {
                ctx.fillStyle = "rgba(180,184,208,0.5)";
                ctx.font = "14px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("داده‌ای برای نمایش نیست", w / 2, h / 2);
                return;
            }

            const xs = w - 2 * p;
            const ys = h - 2 * p;
            let maxV = 0;
            for (let i = 0; i < n; i++) {
                const v = Number(data[i].value) || 0;
                if (v > maxV) maxV = v;
            }
            if (maxV === 0) maxV = 1;

            // Horizontal gridlines (4 of them)
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = p + (ys / 4) * i;
                ctx.beginPath(); ctx.moveTo(p, y); ctx.lineTo(w - p, y); ctx.stroke();
            }

            // Y-axis labels
            ctx.fillStyle = "rgba(180,184,208,0.7)";
            ctx.font = "10px monospace";
            ctx.textAlign = "right";
            ctx.textBaseline = "alphabetic";
            for (let i = 0; i <= 4; i++) {
                const v = maxV * (1 - i / 4);
                const y = p + (ys / 4) * i;
                ctx.fillText(Math.round(v).toLocaleString("en-US"), p - 6, y + 3);
            }

            const xAt = (i) => p + (n === 1 ? xs / 2 : (xs * i) / (n - 1));
            const yAt = (v) => p + ys - (ys * (Number(v) || 0)) / maxV;

            // Filled area (gradient)
            const grad = ctx.createLinearGradient(0, p, 0, p + ys);
            grad.addColorStop(0,   rgba(accent, 0.45));
            grad.addColorStop(0.6, rgba(accent, 0.10));
            grad.addColorStop(1,   rgba(accent, 0.00));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(xAt(0), p + ys);
            for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yAt(data[i].value));
            ctx.lineTo(xAt(n - 1), p + ys);
            ctx.closePath();
            ctx.fill();

            // Glow under the line
            ctx.strokeStyle = rgba(accent, 0.35);
            ctx.lineWidth = 6;
            ctx.shadowColor = rgba(accent, 0.6);
            ctx.shadowBlur = 12;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                if (i === 0) ctx.moveTo(xAt(i), yAt(data[i].value));
                else         ctx.lineTo(xAt(i), yAt(data[i].value));
            }
            ctx.stroke();

            // Sharp top line
            ctx.shadowBlur = 0;
            ctx.strokeStyle = rgba(accent, 1);
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                if (i === 0) ctx.moveTo(xAt(i), yAt(data[i].value));
                else         ctx.lineTo(xAt(i), yAt(data[i].value));
            }
            ctx.stroke();

            // Dots on each point
            for (let i = 0; i < n; i++) {
                const x = xAt(i), y = yAt(data[i].value);
                ctx.fillStyle = "#0a0b1a";
                ctx.strokeStyle = rgba(accent, 1);
                ctx.lineWidth = 2.5;
                ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }

            // X-axis labels — Shamsi MM/DD when the date looks Gregorian ISO,
            // otherwise the raw last 5 chars (used in test/demo series).
            ctx.fillStyle = "rgba(180,184,208,0.7)";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            for (let i = 0; i < n; i++) {
                const x = xAt(i);
                const iso = String(data[i].date || "");
                const lbl = (iso.length === 10 && typeof Jalali !== 'undefined')
                    ? Jalali.shortDate(iso)
                    : iso.slice(5);
                ctx.fillText(lbl, x, h - p / 2);
            }
        }
    }
}
