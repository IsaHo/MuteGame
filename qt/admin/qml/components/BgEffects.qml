// BgEffects — three slowly-floating coloured "glow" blobs + a faint grid.
// Drop into the root of any page; non-interactive (z below the content).
import QtQuick
import QtQuick.Effects
import "../theme"

Item {
    id: root
    anchors.fill: parent
    z: -1

    // Solid background colour underneath everything
    Rectangle { anchors.fill: parent; color: Theme.bg }

    // Faint dotted grid drawn on a Canvas — Qt 6 dropped inline ShaderEffect
    // GLSL strings, but a one-shot Canvas paint is cheap and looks the same.
    Canvas {
        id: grid
        anchors.fill: parent
        opacity: 0.05
        onPaint: {
            const ctx = grid.getContext("2d");
            ctx.reset();
            ctx.strokeStyle = Theme.violetSoft;
            ctx.lineWidth = 1;
            const step = 50;
            for (let x = 0; x < width;  x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
            for (let y = 0; y < height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y);  ctx.stroke(); }
        }
        onWidthChanged:  requestPaint()
        onHeightChanged: requestPaint()
    }

    // Three large soft blobs — ride a slow random drift loop
    Repeater {
        model: [
            { color: Theme.indigo, sx:  0.15, sy: -0.15, w: 600, h: 600, delay: 0 },
            { color: Theme.pink,   sx: -0.20, sy:  0.25, w: 500, h: 500, delay: 4500 },
            { color: Theme.cyan,   sx:  0.30, sy:  0.10, w: 400, h: 400, delay: 9000 }
        ]
        delegate: Rectangle {
            x: root.width  * (0.35 + modelData.sx) - width / 2
            y: root.height * (0.50 + modelData.sy) - height / 2
            width: modelData.w
            height: modelData.h
            radius: width / 2
            color: modelData.color
            opacity: 0.30

            // Heavy blur via MultiEffect (Qt 6.5+) — falls back gracefully
            // if MultiEffect is unavailable (older Qt: still looks like a soft
            // disc, just less diffuse).
            layer.enabled: true
            layer.effect: MultiEffect { blurEnabled: true; blurMax: 64; blur: 1.0 }

            SequentialAnimation on x {
                loops: Animation.Infinite
                PauseAnimation { duration: modelData.delay }
                NumberAnimation { to: parent ? parent.width  * (0.55 + modelData.sx) - width  / 2 : 0; duration: 9000; easing.type: Easing.InOutSine }
                NumberAnimation { to: parent ? parent.width  * (0.20 + modelData.sx) - width  / 2 : 0; duration: 9000; easing.type: Easing.InOutSine }
            }
            SequentialAnimation on y {
                loops: Animation.Infinite
                PauseAnimation { duration: modelData.delay }
                NumberAnimation { to: parent ? parent.height * (0.65 + modelData.sy) - height / 2 : 0; duration: 11000; easing.type: Easing.InOutSine }
                NumberAnimation { to: parent ? parent.height * (0.35 + modelData.sy) - height / 2 : 0; duration: 11000; easing.type: Easing.InOutSine }
            }
        }
    }
}
