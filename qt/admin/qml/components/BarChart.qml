// BarChart — Canvas-drawn vertical bar chart for daily aggregates
// (e.g. shop sales per day). Same visual language as LineChart: dark panel,
// faint gridlines, glowing bars. Inputs:
//   series  — JS array of { date: "YYYY-MM-DD", value: number }
//   accent  — bar fill+glow colour
import QtQuick
import "../theme"

Item {
    id: root
    property var   series: []
    property color accent: Theme.cyanSoft

    implicitHeight: 220

    Canvas {
        id: cv
        anchors.fill: parent
        antialiasing: true
        renderTarget: Canvas.FramebufferObject

        property int pad: 36

        Connections {
            target: root
            function onSeriesChanged() { cv.requestPaint() }
            function onAccentChanged() { cv.requestPaint() }
        }
        onWidthChanged:  requestPaint()
        onHeightChanged: requestPaint()
        Component.onCompleted: requestPaint()

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

            // Gridlines
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = p + (ys / 4) * i;
                ctx.beginPath(); ctx.moveTo(p, y); ctx.lineTo(w - p, y); ctx.stroke();
            }

            // Y labels
            ctx.fillStyle = "rgba(180,184,208,0.7)";
            ctx.font = "10px monospace";
            ctx.textAlign = "right";
            ctx.textBaseline = "alphabetic";
            for (let i = 0; i <= 4; i++) {
                const v = maxV * (1 - i / 4);
                const y = p + (ys / 4) * i;
                ctx.fillText(Math.round(v).toLocaleString("en-US"), p - 6, y + 3);
            }

            // Bars
            const slot   = xs / n;
            const barW   = Math.max(4, Math.min(36, slot * 0.6));
            const barOff = (slot - barW) / 2;

            for (let i = 0; i < n; i++) {
                const v   = Number(data[i].value) || 0;
                const bh  = (ys * v) / maxV;
                const x   = p + slot * i + barOff;
                const y   = p + ys - bh;

                // Glow
                ctx.shadowColor = rgba(accent, 0.55);
                ctx.shadowBlur  = 12;

                // Gradient fill
                const grad = ctx.createLinearGradient(0, y, 0, y + bh);
                grad.addColorStop(0,   rgba(accent, 0.95));
                grad.addColorStop(1,   rgba(accent, 0.35));
                ctx.fillStyle = grad;
                // Rounded-top rectangle
                const r = Math.min(6, barW / 2, bh / 2);
                ctx.beginPath();
                ctx.moveTo(x, y + bh);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.lineTo(x + barW - r, y);
                ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
                ctx.lineTo(x + barW, y + bh);
                ctx.closePath();
                ctx.fill();
            }
            ctx.shadowBlur = 0;

            // X labels — Shamsi MM/DD when ISO date present
            ctx.fillStyle = "rgba(180,184,208,0.7)";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            for (let i = 0; i < n; i++) {
                const x = p + slot * i + slot / 2;
                const iso = String(data[i].date || "");
                const lbl = (iso.length === 10 && typeof Jalali !== 'undefined')
                    ? Jalali.shortDate(iso)
                    : iso.slice(5);
                ctx.fillText(lbl, x, h - p / 2);
            }
        }
    }
}
