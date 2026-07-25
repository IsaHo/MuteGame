// Sparkline — tiny inline chart for the revenue cards. No axes, no labels,
// just a glowing curve over a faint gradient fill. Same visual idiom as
// the React `Sparkline` in the old admin.
import QtQuick
import "../theme"

Canvas {
    id: cv
    property var   series: []     // renamed from `data` (Canvas.data shadowing)
    property color accent: Theme.violetSoft

    implicitWidth: 140
    implicitHeight: 56
    antialiasing: true

    onSeriesChanged:  requestPaint()
    onAccentChanged:  requestPaint()
    onWidthChanged:   requestPaint()
    onHeightChanged:  requestPaint()
    Component.onCompleted: requestPaint()    // ensure first render fires

    onPaint: {
        const ctx = getContext("2d");
        ctx.reset();
        if (!series || series.length < 2) return;

        const a = accent;
        const css = "rgba(" + Math.round(a.r * 255) + "," + Math.round(a.g * 255) + "," + Math.round(a.b * 255);

        let mx = 1, mn = 0;
        for (const v of series) { const n = Number(v) || 0; if (n > mx) mx = n; if (n < mn) mn = n; }
        const range = Math.max(mx - mn, 1);
        const step = (width - 4) / (series.length - 1);
        const yOf = (v) => height - 4 - ((Number(v) - mn) / range) * (height - 8);

        // Fill
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, css + ",0.45)");
        grad.addColorStop(1, css + ",0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(2, height);
        for (let i = 0; i < series.length; i++) ctx.lineTo(2 + i * step, yOf(series[i]));
        ctx.lineTo(width - 2, height);
        ctx.closePath();
        ctx.fill();

        // Line
        ctx.strokeStyle = css + ",1)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < series.length; i++) {
            if (i === 0) ctx.moveTo(2 + i * step, yOf(series[i]));
            else         ctx.lineTo(2 + i * step, yOf(series[i]));
        }
        ctx.stroke();

        // Last-point dot
        ctx.fillStyle = css + ",1)";
        ctx.beginPath();
        ctx.arc(2 + (series.length - 1) * step, yOf(series[series.length - 1]), 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}
