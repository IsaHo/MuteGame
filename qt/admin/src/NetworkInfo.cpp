#include "NetworkInfo.h"

#include <QNetworkInterface>
#include <QHostAddress>

NetworkInfo::NetworkInfo(QObject *parent) : QObject(parent)
{
    // Pick the first non-loopback IPv4 address we can find. Skip virtual
    // adapters and IPv6 — clients are on the same LAN and want a friendly
    // dotted-quad to type into ConfigPage.
    const auto ifs = QNetworkInterface::allInterfaces();
    for (const auto &iface : ifs) {
        if (!(iface.flags() & QNetworkInterface::IsUp)) continue;
        if (iface.flags() & QNetworkInterface::IsLoopBack) continue;
        if (iface.type() == QNetworkInterface::Loopback) continue;
        for (const auto &entry : iface.addressEntries()) {
            const QHostAddress ip = entry.ip();
            if (ip.protocol() != QAbstractSocket::IPv4Protocol) continue;
            if (ip.isLoopback()) continue;
            const QString s = ip.toString();
            // Prefer real LAN ranges over link-local 169.254.x.x.
            if (s.startsWith("169.254.")) continue;
            m_localIp = s;
            return;
        }
    }
    // Last-resort fallback so the UI always has something to show.
    if (m_localIp.isEmpty()) m_localIp = "127.0.0.1";
}
