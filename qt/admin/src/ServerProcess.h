// ServerProcess — embeds the Node.js MuteGame server inside the admin app.
//
// On launch we spawn `node ./server/index.js` (or the bundled `node.exe`
// next to the admin executable) as a QProcess child. The admin UI then
// connects to it on http://localhost:3001 like before, but the operator
// never has to install Node.js or run a separate "start server" step.
//
// On admin shutdown we kill the child cleanly so the port doesn't hang.
//
// Layout we expect at runtime (next to the admin .exe):
//   MuteGameAdmin.exe
//   node.exe              ← portable Node.js (Win) — optional on Mac/Linux
//   server\
//     index.js
//     database.js
//     node_modules\       ← pre-installed, includes better-sqlite3 native
//     ...
#pragma once

#include <QObject>
#include <QString>

class QProcess;

class ServerProcess : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool running READ running NOTIFY runningChanged)
    Q_PROPERTY(int port READ port CONSTANT)

public:
    explicit ServerProcess(QObject *parent = nullptr);
    ~ServerProcess() override;

    bool running() const { return m_running; }
    int  port()    const { return 3001; }

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();

signals:
    void runningChanged();
    void log(const QString &line);   // for QML diagnostic panel if ever wanted

private slots:
    void onReadyRead();
    void onProcessFinished(int exitCode);

private:
    QString resolveNodeExe() const;
    QString resolveServerScript() const;

    QProcess *m_proc = nullptr;
    bool      m_running = false;
};
