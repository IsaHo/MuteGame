// SocketClient — Socket.IO v4 (Engine.IO v4) realtime client over QWebSocket,
// exposed to QML as the global `Socket` singleton.
//
// Handshake flow we implement:
//   1. WS open → ws://host/socket.io/?EIO=4&transport=websocket
//   2. server sends `0{"sid":"...","pingInterval":25000,"pingTimeout":20000,…}`
//   3. we send `40` (Socket.IO CONNECT to default namespace)
//   4. server replies `40{"sid":"..."}` — namespace established → connected=true
//   5. server sends `2` (ping) every pingInterval → we reply `3` (pong)
//   6. server sends `42["event-name", data]` → we parse + emit event(name,payload)
//   7. on disconnect we auto-reconnect after 3s
//
// Compiles in two flavours:
//   • HAVE_WEBSOCKETS=1  → real QWebSocket connection
//   • otherwise          → no-op stub (kept so QML Socket.connectTo / .connected
//     bindings still build on machines without QtWebSockets)
#pragma once

#include <QObject>
#include <QString>
#include <QTimer>

#ifdef HAVE_WEBSOCKETS
#include <QWebSocket>
#endif

class SocketClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)

public:
    explicit SocketClient(QObject *parent = nullptr);

    bool connected() const { return m_connected; }

    Q_INVOKABLE void connectTo(const QString &serverUrl);
    Q_INVOKABLE void disconnect();

    // Send a Socket.IO EVENT to the server. `payloadJson` is the raw JSON of
    // the args array tail — usually a single object like `{"computerName":"PC-1"}`.
    // We wrap it in `42["name", <payloadJson>]` and put it on the wire.
    // Used by the kiosk client to emit `client:register`, `client:login`,
    // `client:logout`, and voice chunks.
    Q_INVOKABLE void emitEvent(const QString &name, const QString &payloadJson = QString());

signals:
    void connectedChanged();
    // name = Socket.IO event name (e.g. "clients:update", "games:update")
    // payload = JSON-stringified arguments. Usually a single arg, so QML can
    //   JSON.parse(payload) directly to get the data.
    //
    // NOTE: this used to be called `event(...)` which shadowed QObject's
    // virtual `bool event(QEvent*)` method — Qt's metaobject treated it as a
    // method override rather than a signal, so QML `onEvent` handlers were
    // never invoked. Renaming to `messageReceived` fixed the silent breakage.
    void messageReceived(const QString &name, const QString &payload);

private slots:
    void onTextMessage(const QString &msg);
    void onWsConnected();
    void onWsDisconnected();
    void scheduleReconnect();

private:
    void setConnected(bool c);
    void sendPong();
    void handleEnginePacket(const QString &frame);

#ifdef HAVE_WEBSOCKETS
    QWebSocket m_socket;
    QTimer m_reconnectTimer;
    QString m_url;       // saved so reconnect knows where to dial back
#endif
    bool m_connected = false;   // Socket.IO namespace established (after `40`)
    bool m_wsOpen    = false;   // raw WebSocket transport up
};
