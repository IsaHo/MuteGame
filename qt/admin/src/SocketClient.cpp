#include "SocketClient.h"

#include <QUrl>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QDebug>

SocketClient::SocketClient(QObject *parent) : QObject(parent)
{
#ifdef HAVE_WEBSOCKETS
    connect(&m_socket, &QWebSocket::connected,           this, &SocketClient::onWsConnected);
    connect(&m_socket, &QWebSocket::disconnected,        this, &SocketClient::onWsDisconnected);
    connect(&m_socket, &QWebSocket::textMessageReceived, this, &SocketClient::onTextMessage);
    // errorOccurred fires for refused connections / DNS failures / etc.
    // Without this, the very first attempt failing would just leave the
    // socket idle forever — disconnected() does not always fire on first-
    // time-error, so we have to schedule a retry from here too.
    connect(&m_socket, &QWebSocket::errorOccurred, this,
            [this](QAbstractSocket::SocketError err) {
        qWarning() << "[Socket] error:" << err << m_socket.errorString();
        m_wsOpen = false;
        setConnected(false);
        scheduleReconnect();
    });

    // Reconnect timer — fires every 2s while disconnected so the kiosk catches
    // the moment the admin server comes online (e.g. operator started admin
    // after the kiosks). Stops naturally once we're connected.
    m_reconnectTimer.setSingleShot(false);
    m_reconnectTimer.setInterval(2000);
    connect(&m_reconnectTimer, &QTimer::timeout, this, [this]() {
        if (m_url.isEmpty()) { m_reconnectTimer.stop(); return; }
        if (m_connected || m_wsOpen) { m_reconnectTimer.stop(); return; }
        qDebug() << "[Socket] reconnecting to" << m_url;
        m_socket.open(QUrl(m_url));
    });
#endif
}

void SocketClient::connectTo(const QString &serverUrl)
{
#ifdef HAVE_WEBSOCKETS
    QString url = serverUrl;
    url.replace("https://", "wss://").replace("http://", "ws://");
    if (!url.endsWith('/')) url += '/';
    url += "socket.io/?EIO=4&transport=websocket";
    m_url = url;
    qDebug() << "[Socket] connecting to" << url;
    m_socket.open(QUrl(url));
#else
    Q_UNUSED(serverUrl);
#endif
}

void SocketClient::disconnect()
{
#ifdef HAVE_WEBSOCKETS
    m_url.clear();              // suppress auto-reconnect
    m_reconnectTimer.stop();
    m_socket.close();
#endif
}

void SocketClient::setConnected(bool c)
{
    if (m_connected == c) return;
    m_connected = c;
    emit connectedChanged();
}

void SocketClient::onWsConnected()
{
#ifdef HAVE_WEBSOCKETS
    qDebug() << "[Socket] WebSocket transport up — waiting for Engine.IO OPEN";
    m_wsOpen = true;
    // We don't set connected=true yet — that happens after the Socket.IO
    // CONNECT (`40`) handshake completes. QML pages that bind to Socket.connected
    // expect a *fully usable* socket, not just a half-handshaken transport.
#endif
}

void SocketClient::onWsDisconnected()
{
#ifdef HAVE_WEBSOCKETS
    qDebug() << "[Socket] disconnected (code"
             << m_socket.closeCode() << "reason" << m_socket.closeReason() << ")";
    m_wsOpen = false;
    setConnected(false);
    scheduleReconnect();
#endif
}

void SocketClient::scheduleReconnect()
{
#ifdef HAVE_WEBSOCKETS
    if (m_url.isEmpty()) return;
    if (m_reconnectTimer.isActive()) return;
    m_reconnectTimer.start();
#endif
}

void SocketClient::sendPong()
{
#ifdef HAVE_WEBSOCKETS
    m_socket.sendTextMessage("3");
#endif
}

void SocketClient::emitEvent(const QString &name, const QString &payloadJson)
{
#ifdef HAVE_WEBSOCKETS
    if (!m_connected) {
        qWarning() << "[Socket] emitEvent dropped — not connected:" << name;
        return;
    }
    // Build `42["name", <payload>]`. If payloadJson is empty we send just
    // `42["name"]` (Socket.IO is happy with no args).
    QString frame = "42[\"" + name + "\"";
    if (!payloadJson.isEmpty()) frame += "," + payloadJson;
    frame += "]";
    qDebug() << "[Socket] >>" << (frame.size() > 200 ? frame.left(200) + "..." : frame);
    m_socket.sendTextMessage(frame);
#else
    Q_UNUSED(name); Q_UNUSED(payloadJson);
#endif
}

// Engine.IO packet types prefix the payload as a single ASCII digit:
//   0 OPEN   1 CLOSE   2 PING   3 PONG   4 MESSAGE   5 UPGRADE   6 NOOP
// MESSAGE (4) is what carries Socket.IO frames, themselves prefixed by:
//   0 CONNECT  1 DISCONNECT  2 EVENT  3 ACK  4 CONNECT_ERROR
// So a Socket.IO event from the server looks like: "42[\"name\", data...]".
void SocketClient::handleEnginePacket(const QString &frame)
{
    if (frame.isEmpty()) return;
    const QChar enginePacketType = frame.at(0);

    if (enginePacketType == '0') {
        // Engine.IO OPEN — server-side handshake done at the transport layer.
        // Body is JSON with sid/pingInterval/pingTimeout. We don't need any of
        // those values right now (QWebSocket handles the actual ping/pong at
        // a layer above us when we reply to `2` frames), but parse for logs.
        const QJsonDocument doc = QJsonDocument::fromJson(frame.mid(1).toUtf8());
        qDebug() << "[Socket] Engine.IO OPEN, sid=" << doc.object().value("sid").toString();
#ifdef HAVE_WEBSOCKETS
        // Send Socket.IO CONNECT to default namespace ("/").
        m_socket.sendTextMessage("40");
#endif
        return;
    }

    if (enginePacketType == '2') {       // PING from server
        sendPong();
        return;
    }
    if (enginePacketType == '3') return; // server-side PONG (won't normally happen)
    if (enginePacketType == '1') return; // CLOSE (handled by ws disconnected signal)

    if (enginePacketType != '4') {
        // Unknown / UPGRADE / NOOP — ignore silently.
        return;
    }

    // Engine.IO MESSAGE — second char is Socket.IO packet type.
    if (frame.size() < 2) return;
    const QChar sioPacketType = frame.at(1);

    if (sioPacketType == '0') {
        // Socket.IO CONNECT confirmation — namespace is live, expose as connected.
        const QJsonDocument doc = QJsonDocument::fromJson(frame.mid(2).toUtf8());
        qDebug() << "[Socket] CONNECT confirmed, sid=" << doc.object().value("sid").toString();
        setConnected(true);
        return;
    }
    if (sioPacketType == '1') {  // DISCONNECT
        setConnected(false);
        return;
    }
    if (sioPacketType == '4') {  // CONNECT_ERROR
        qWarning() << "[Socket] CONNECT_ERROR:" << frame.mid(2);
        setConnected(false);
        return;
    }

    if (sioPacketType != '2') return;   // we only care about EVENT (3=ACK ignored)

    // EVENT body is a JSON array: ["event-name", arg1, arg2, ...]. Slice off
    // the "42" prefix (and any optional namespace like "/admin," — we use the
    // default namespace so there's no comma here in practice).
    int jsonStart = 2;
    if (frame.size() > 2 && frame.at(2) == '/') {
        // Namespaced frame: 42/foo,["event",data] — skip past the comma.
        const int comma = frame.indexOf(',', 3);
        if (comma < 0) return;
        jsonStart = comma + 1;
    }
    const QByteArray body = frame.mid(jsonStart).toUtf8();
    const QJsonDocument doc = QJsonDocument::fromJson(body);
    if (!doc.isArray()) return;
    const QJsonArray arr = doc.array();
    if (arr.isEmpty()) return;

    const QString name = arr.at(0).toString();
    qDebug() << "[Socket] EVENT" << name << "(" << arr.size() - 1 << "args)";

    // Re-serialize the *args* (everything after the event name) so QML can
    // JSON.parse it. For a single-arg event, payload is the JSON of that one
    // arg; for multi-arg, an array.
    QJsonValue payloadVal;
    if (arr.size() == 2)         payloadVal = arr.at(1);
    else if (arr.size() > 2) {
        QJsonArray rest;
        for (int i = 1; i < arr.size(); ++i) rest.append(arr.at(i));
        payloadVal = rest;
    }
    QString payload;
    if (payloadVal.isObject())      payload = QString::fromUtf8(QJsonDocument(payloadVal.toObject()).toJson(QJsonDocument::Compact));
    else if (payloadVal.isArray())  payload = QString::fromUtf8(QJsonDocument(payloadVal.toArray()).toJson(QJsonDocument::Compact));
    else if (payloadVal.isString()) payload = payloadVal.toString();
    else if (!payloadVal.isUndefined() && !payloadVal.isNull())
        payload = payloadVal.toVariant().toString();

    emit messageReceived(name, payload);
}

void SocketClient::onTextMessage(const QString &msg)
{
    qDebug() << "[Socket] <<" << (msg.size() > 200 ? msg.left(200) + "..." : msg);
    handleEnginePacket(msg);
}
