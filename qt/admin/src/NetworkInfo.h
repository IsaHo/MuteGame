// NetworkInfo — exposes the host's LAN IPv4 address to QML so the admin
// login page can show "your clients should connect to <X>:3001".
#pragma once

#include <QObject>
#include <QString>

class NetworkInfo : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString localIp READ localIp CONSTANT)
    Q_PROPERTY(QString localUrl READ localUrl CONSTANT)
    Q_PROPERTY(int     port    READ port    CONSTANT)

public:
    explicit NetworkInfo(QObject *parent = nullptr);

    static constexpr int kPort = 3001;
    QString localIp() const  { return m_localIp; }
    QString localUrl() const { return "http://" + m_localIp + ":" + QString::number(kPort); }
    int     port()    const  { return kPort; }

private:
    QString m_localIp;
};
