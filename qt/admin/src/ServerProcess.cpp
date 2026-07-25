#include "ServerProcess.h"

#include <QProcess>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QStandardPaths>
#include <QDebug>

ServerProcess::ServerProcess(QObject *parent) : QObject(parent) {}
ServerProcess::~ServerProcess() { stop(); }

QString ServerProcess::resolveNodeExe() const
{
    // 1) Explicit override — useful when the operator has a custom node
    //    install (nvm, asdf, …) we can't auto-detect.
    const QString fromEnv = qEnvironmentVariable("MUTEGAME_NODE");
    if (!fromEnv.isEmpty() && QFileInfo::exists(fromEnv)) return fromEnv;

    // 2) bundled portable node next to the admin exe (preferred — zero install)
    const QString appDir = QCoreApplication::applicationDirPath();
#ifdef Q_OS_WIN
    const QString bundled = appDir + "/node.exe";
#else
    const QString bundled = appDir + "/node";
#endif
    if (QFileInfo::exists(bundled)) return bundled;

    // 3) on macOS the bundled binary lives one extra layer deep when shipped
    //    inside an .app — try ../Resources/node
    const QString resources = appDir + "/../Resources/node";
    if (QFileInfo::exists(resources)) return resources;

    // 4) Probe common system locations. GUI apps launched via `open` on macOS
    //    inherit a stripped-down PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that
    //    DOESN'T include Homebrew (/opt/homebrew, /usr/local/bin), Anaconda
    //    (~/anaconda3), or nvm (~/.nvm). So a literal `node` lookup will fail
    //    on most dev machines unless we hand it the absolute path.
#ifndef Q_OS_WIN
    const QString home = QDir::homePath();
    QStringList systemCandidates = {
        "/opt/homebrew/bin/node",      // Apple Silicon Homebrew
        "/usr/local/bin/node",         // Intel Homebrew + manual installs
        "/usr/bin/node",               // some Linux distros
        home + "/anaconda3/bin/node",  // Anaconda
        home + "/miniconda3/bin/node", // Miniconda
        home + "/.local/bin/node",     // pip user installs / asdf shim copies
    };
    // nvm doesn't pin a single path — scan ~/.nvm/versions/node/*/bin/node
    QDir nvmDir(home + "/.nvm/versions/node");
    if (nvmDir.exists()) {
        const auto versions = nvmDir.entryList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name | QDir::Reversed);
        for (const QString &v : versions) {
            systemCandidates << nvmDir.absoluteFilePath(v + "/bin/node");
        }
    }
    for (const QString &p : systemCandidates) {
        if (QFileInfo::exists(p)) return p;
    }
#endif

    // 5) Last-ditch — let QProcess resolve via the (likely stripped) PATH.
    //    If this fails, the start() call will log the spawn error so the
    //    operator can see exactly what went wrong.
    return "node";
}

QString ServerProcess::resolveServerScript() const
{
    // 1) Explicit override (useful for staging deployments).
    const QString fromEnv = qEnvironmentVariable("MUTEGAME_SERVER_SCRIPT");
    if (!fromEnv.isEmpty() && QFileInfo::exists(fromEnv))
        return QFileInfo(fromEnv).absoluteFilePath();

    // 2) Fixed candidates — the deployed-build sidecar layouts. Cheap to test.
    const QString appDir = QCoreApplication::applicationDirPath();
    const QStringList candidates = {
        appDir + "/server/index.js",                        // exe sibling
        appDir + "/../server/index.js",
        appDir + "/../../server/index.js",
        appDir + "/../../../server/index.js",
        appDir + "/../Resources/server/index.js",           // packaged .app
    };
    for (const QString &c : candidates) {
        if (QFileInfo::exists(c)) return QFileInfo(c).absoluteFilePath();
    }

    // 3) Walk up parents until we find a sibling `server/index.js`. The dev
    //    .app on macOS is FIVE levels deep below the project root:
    //        <root>/qt/admin/build/MuteGameAdmin.app/Contents/MacOS/MuteGameAdmin
    //    so the fixed candidates above (max 3 levels up) miss it. We cap the
    //    walk at 8 levels to avoid running off the filesystem on weird paths.
    QDir d(appDir);
    for (int i = 0; i < 8; ++i) {
        if (!d.cdUp()) break;
        const QString p = d.absoluteFilePath("server/index.js");
        if (QFileInfo::exists(p)) return p;
    }

    return QString();
}

void ServerProcess::start()
{
    if (m_running) return;

    const QString script = resolveServerScript();
    if (script.isEmpty()) {
        emit log(QStringLiteral("[server] index.js پیدا نشد — مطمئن شو پوشه server کنار MuteGameAdmin.exe هست"));
        qWarning() << "[ServerProcess] could not locate server/index.js relative to" << QCoreApplication::applicationDirPath();
        return;
    }

    const QString node = resolveNodeExe();
    qInfo() << "[ServerProcess] starting" << node << script;

    m_proc = new QProcess(this);
    m_proc->setProgram(node);
    m_proc->setArguments({ script });
    m_proc->setWorkingDirectory(QFileInfo(script).absolutePath());
    m_proc->setProcessChannelMode(QProcess::MergedChannels);

    // Persist DB next to the user's data folder (writable on Win without UAC).
    auto env = QProcessEnvironment::systemEnvironment();
    if (!env.contains("DB_PATH")) {
        const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
        QDir().mkpath(dataDir);
        env.insert("DB_PATH", dataDir + "/mutegame.db");
    }
    m_proc->setProcessEnvironment(env);

    connect(m_proc, &QProcess::readyRead, this, &ServerProcess::onReadyRead);
    connect(m_proc, &QProcess::finished, this,
            [this](int code, QProcess::ExitStatus) { onProcessFinished(code); });

    m_proc->start();
    if (!m_proc->waitForStarted(4000)) {
        emit log(QStringLiteral("[server] راه‌اندازی Node ناموفق — مطمئن شو node.exe کنار MuteGameAdmin.exe هست"));
        qWarning() << "[ServerProcess] failed to start node:" << m_proc->errorString();
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }
    m_running = true;
    emit runningChanged();
}

void ServerProcess::stop()
{
    if (!m_proc) return;
    if (m_proc->state() != QProcess::NotRunning) {
        m_proc->terminate();
        if (!m_proc->waitForFinished(2000)) {
            m_proc->kill();
            m_proc->waitForFinished(1000);
        }
    }
    m_proc->deleteLater();
    m_proc = nullptr;
    if (m_running) { m_running = false; emit runningChanged(); }
}

void ServerProcess::onReadyRead()
{
    if (!m_proc) return;
    const QString out = QString::fromLocal8Bit(m_proc->readAll());
    const QStringList lines = out.split('\n', Qt::SkipEmptyParts);
    for (const QString &l : lines) {
        qInfo().noquote() << "[server]" << l;
        emit log(l);
    }
}

void ServerProcess::onProcessFinished(int exitCode)
{
    qInfo() << "[ServerProcess] node exited with code" << exitCode;
    if (m_running) { m_running = false; emit runningChanged(); }
}
