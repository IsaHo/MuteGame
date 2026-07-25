#include "ApiClient.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHttpMultiPart>
#include <QHttpPart>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QNetworkReply>
#include <QSettings>
#include <QStandardPaths>
#include <QUrl>
#include <QDebug>

ApiClient::ApiClient(QObject *parent) : QObject(parent)
{
    // Persist token + base URL across runs
    QSettings s;
    m_baseUrl = s.value("api/baseUrl", m_baseUrl).toString();
    m_token   = s.value("api/token").toString();
}

void ApiClient::setBaseUrl(const QString &url)
{
    if (url == m_baseUrl) return;
    m_baseUrl = url;
    QSettings().setValue("api/baseUrl", url);
    emit baseUrlChanged();
}

QNetworkRequest ApiClient::buildRequest(const QString &path) const
{
    QNetworkRequest req(QUrl(m_baseUrl + path));
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    return req;
}

// Centralised reply log — triggered for every JSON request so failures (401,
// 403, 5xx) leave a breadcrumb. Without this, "اضافه نشد" looks like a UI
// bug when the underlying HTTP error is the real story.
static void logReply(const char *verb, const QString &path, QNetworkReply *reply)
{
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() != QNetworkReply::NoError || status >= 400) {
        qWarning() << "[Api]" << verb << path << "→" << status
                   << reply->errorString();
    } else {
        qDebug() << "[Api]" << verb << path << "→" << status;
    }
}

// Pull the human-readable error out of an HTTP response. Server consistently
// returns `{"error": "<persian message>"}` on 4xx — surface that to the user
// instead of Qt's "Network access denied" verbiage. Falls back to status
// code if no JSON body. Also: a non-2xx status is a *failure* even when
// reply->error() returned NoError (Qt only flags transport-level errors,
// not application-level 4xx/5xx).
static bool replyOk(QNetworkReply *reply, QString &errOut, QJsonObject &bodyOut)
{
    const QByteArray raw = reply->readAll();
    const auto doc = QJsonDocument::fromJson(raw);
    if (doc.isObject()) bodyOut = doc.object();

    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() == QNetworkReply::NoError && status >= 200 && status < 300) {
        return true;
    }
    if (bodyOut.contains("error")) {
        errOut = bodyOut.value("error").toString();
    } else if (status > 0) {
        errOut = QString("HTTP %1: %2").arg(status).arg(reply->errorString());
    } else {
        errOut = reply->errorString();
    }
    return false;
}

void ApiClient::postJson(const QString &path, const QJsonObject &body,
                         std::function<void(QNetworkReply *)> onReply)
{
    auto *reply = m_nam.post(buildRequest(path),
                             QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [reply, onReply, path]() {
        logReply("POST", path, reply);
        onReply(reply);
        reply->deleteLater();
    });
}

void ApiClient::getJson(const QString &path,
                        std::function<void(QNetworkReply *)> onReply)
{
    auto *reply = m_nam.get(buildRequest(path));
    connect(reply, &QNetworkReply::finished, this, [reply, onReply, path]() {
        logReply("GET", path, reply);
        onReply(reply);
        reply->deleteLater();
    });
}

// ────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────
void ApiClient::adminLogin(const QString &username, const QString &password)
{
    QJsonObject body{{"username", username}, {"password", password}};
    postJson("/api/auth/admin/login", body, [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit loginDone(false, reply->errorString());
            return;
        }
        const auto doc = QJsonDocument::fromJson(reply->readAll());
        const auto obj = doc.object();
        if (obj.contains("token")) {
            const auto wasAuth = authenticated();
            m_token = obj["token"].toString();
            QSettings().setValue("api/token", m_token);
            emit loginDone(true, m_token);
            if (!wasAuth) emit authenticatedChanged();
        } else {
            emit loginDone(false, obj.value("error").toString("خطای نامشخص"));
        }
    });
}

void ApiClient::logout()
{
    if (m_token.isEmpty()) return;
    m_token.clear();
    QSettings().remove("api/token");
    emit authenticatedChanged();
}

// ────────────────────────────────────────────────────────────────────────
// Reports / dashboard
// ────────────────────────────────────────────────────────────────────────
void ApiClient::getStats()
{
    getJson("/api/reports/stats", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit statsDone(QJsonDocument::fromJson(reply->readAll()).object());
    });
}

void ApiClient::getRevenueReport(int days)
{
    getJson(QString("/api/reports/revenue?days=%1").arg(days), [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit revenueDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::getShopReport(int days)
{
    getJson(QString("/api/reports/shop?days=%1").arg(days), [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit shopReportDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::getShopProfit(int days)
{
    getJson(QString("/api/reports/shop-profit?days=%1").arg(days), [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit shopProfitDone(QJsonDocument::fromJson(reply->readAll()).object());
    });
}

void ApiClient::getSessions()
{
    getJson("/api/sessions", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit sessionsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::getClients()
{
    getJson("/api/clients", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit clientsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::kickClient(const QString &socketId)
{
    postJson(QString("/api/clients/%1/kick").arg(socketId), {}, [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

void ApiClient::messageClient(const QString &socketId, const QString &text)
{
    postJson(QString("/api/clients/%1/message").arg(socketId),
             {{ "text", text }}, [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

void ApiClient::extendClient(const QString &socketId, int minutes)
{
    postJson(QString("/api/clients/%1/extend").arg(socketId),
             {{ "minutes", minutes }}, [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

void ApiClient::setClientVoiceMute(const QString &socketId, bool muted)
{
    postJson(QString("/api/clients/%1/voice-mute").arg(socketId),
             {{ "muted", muted }}, [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

void ApiClient::powerClient(const QString &socketId, const QString &action)
{
    postJson(QString("/api/clients/%1/power").arg(socketId),
             {{ "action", action }}, [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

void ApiClient::forceLoginClient(const QString &socketId,
                                 int userId, const QString &username,
                                 qint64 credits)
{
    postJson(QString("/api/clients/%1/force-login").arg(socketId),
             { { "userId", userId },
               { "username", username },
               { "credits", static_cast<double>(credits) } },
             [this](QNetworkReply *reply) {
        emit clientActionDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

// ────────────────────────────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────────────────────────────
void ApiClient::getUsers()
{
    getJson("/api/users", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit usersDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::getBadPayers()
{
    getJson("/api/users/bad-payers", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit badPayersDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createUser(const QJsonObject &data)
{
    postJson("/api/users", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
void ApiClient::updateUser(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/users/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
        reply->deleteLater();
    });
}
void ApiClient::toggleUser(int id)
{
    postJson(QString("/api/users/%1/toggle").arg(id), {}, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
void ApiClient::deleteUser(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/users/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit userMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString(), {});
        reply->deleteLater();
    });
}
void ApiClient::chargeUser(int id, qint64 amount, const QString &description, bool free)
{
    postJson(QString("/api/users/%1/charge").arg(id),
             { { "amount", static_cast<double>(amount) },
               { "description", description },
               { "free", free } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
void ApiClient::dechargeUser(int id, qint64 amount, const QString &description)
{
    postJson(QString("/api/users/%1/decharge").arg(id),
             { { "amount", static_cast<double>(amount) }, { "description", description } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
void ApiClient::addDebt(int id, qint64 amount, const QString &description)
{
    postJson(QString("/api/users/%1/debt/add").arg(id),
             { { "amount", static_cast<double>(amount) }, { "description", description } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
void ApiClient::payDebt(int id, qint64 amount, const QString &description)
{
    postJson(QString("/api/users/%1/debt/pay").arg(id),
             { { "amount", static_cast<double>(amount) }, { "description", description } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}
// Quick post-pay flip. value=-1 toggles the current state; 0/1 sets explicitly.
void ApiClient::togglePostPay(int id, int value)
{
    QJsonObject body;
    if (value == 0 || value == 1) body.insert("post_pay", value);
    postJson(QString("/api/users/%1/post-pay").arg(id), body, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit userMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString(), obj);
    });
}

void ApiClient::getDebtors()
{
    getJson("/api/users/debts", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit debtorsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::getDebtTransactions(int days)
{
    getJson(QString("/api/users/debt-transactions?days=%1").arg(days), [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit debtTransactionsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

void ApiClient::getUserTransactions(int id)
{
    getJson(QString("/api/users/%1/transactions").arg(id), [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit transactionsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

// ────────────────────────────────────────────────────────────────────────
// Shop
// ────────────────────────────────────────────────────────────────────────
void ApiClient::getShopItems(bool includeInactive)
{
    const QString path = includeInactive ? "/api/shop/items?all=1" : "/api/shop/items";
    getJson(path, [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit shopItemsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createShopItem(const QJsonObject &data)
{
    postJson("/api/shop/items", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit shopMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString());
    });
}
void ApiClient::updateShopItem(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/shop/items/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit shopMutationDone(reply->error() == QNetworkReply::NoError,
                              obj.value("error").toString());
        reply->deleteLater();
    });
}
void ApiClient::deleteShopItem(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/shop/items/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit shopMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
        reply->deleteLater();
    });
}
void ApiClient::getOrders(const QString &status)
{
    const QString path = status.isEmpty()
        ? "/api/shop/orders"
        : QString("/api/shop/orders?status=%1").arg(status);
    getJson(path, [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit ordersDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::approveOrder(int id)
{
    postJson(QString("/api/shop/orders/%1/approve").arg(id), {}, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit orderActionDone(reply->error() == QNetworkReply::NoError,
                             obj.value("error").toString());
    });
}
void ApiClient::cancelOrder(int id)
{
    postJson(QString("/api/shop/orders/%1/cancel").arg(id), {}, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit orderActionDone(reply->error() == QNetworkReply::NoError,
                             obj.value("error").toString());
    });
}

// ────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────
void ApiClient::getSettings()
{
    getJson("/api/settings", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit networkError(reply->errorString()); return;
        }
        emit settingsLoaded(QJsonDocument::fromJson(reply->readAll()).object());
    });
}

void ApiClient::saveSettings(const QJsonObject &settings)
{
    postJson("/api/settings", settings, [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) {
            emit settingsSaved(false, reply->errorString()); return;
        }
        emit settingsSaved(true, QString());
    });
}

// ── Games ─────────────────────────────────────────────────────────────
void ApiClient::getGames(bool onlyActive)
{
    getJson(onlyActive ? "/api/games?active=1" : "/api/games", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit gamesDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createGame(const QJsonObject &data)
{
    postJson("/api/games", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit gameMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
    });
}
void ApiClient::updateGame(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/games/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit gameMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
        reply->deleteLater();
    });
}
void ApiClient::deleteGame(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/games/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit gameMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
        reply->deleteLater();
    });
}

void ApiClient::uploadGameImage(int id, const QString &filePath)
{
    // Normalize the path. QML's FileDialog yields a QUrl-style "file:///..."
    // string. On Windows that surfaces as "file:///C:/Users/..."; the leading
    // triple-slash plus drive letter trip up QFile if you slice the prefix
    // by length. Always go through QUrl::toLocalFile() so it handles that
    // (and percent-decodes spaces / Persian characters in the filename).
    QString path;
    if (filePath.startsWith("file://")) {
        path = QUrl(filePath).toLocalFile();
    } else {
        path = filePath;
    }
    qDebug() << "[Api] uploadGameImage gameId=" << id
             << "input=" << filePath << "resolved=" << path;

    auto *file = new QFile(path);
    if (!file->open(QIODevice::ReadOnly)) {
        const QString msg = QString("نمی‌توانم فایل را باز کنم: %1 (%2)")
                                .arg(path, file->errorString());
        qWarning() << "[Api] uploadGameImage open-failed:" << msg;
        emit gameImageUploaded(false, msg);
        file->deleteLater();
        return;
    }

    auto *multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    file->setParent(multi);

    QHttpPart imagePart;
    const QString mime = QMimeDatabase().mimeTypeForFile(path).name();
    imagePart.setHeader(QNetworkRequest::ContentTypeHeader, QVariant(mime));
    imagePart.setHeader(QNetworkRequest::ContentDispositionHeader,
                        QVariant(QString("form-data; name=\"image\"; filename=\"%1\"")
                                 .arg(QFileInfo(path).fileName())));
    imagePart.setBodyDevice(file);
    multi->append(imagePart);

    QNetworkRequest req(QUrl(m_baseUrl + QString("/api/games/%1/image").arg(id)));
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    // No Content-Type — QHttpMultiPart sets multipart/form-data with boundary.

    auto *reply = m_nam.post(req, multi);
    multi->setParent(reply);
    connect(reply, &QNetworkReply::finished, this, [this, reply, id]() {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QByteArray raw = reply->readAll();
        const auto obj = QJsonDocument::fromJson(raw).object();
        const bool ok = (reply->error() == QNetworkReply::NoError) && status >= 200 && status < 300;
        if (!ok) {
            qWarning() << "[Api] uploadGameImage gameId=" << id << "→" << status
                       << reply->errorString() << raw.left(200);
        } else {
            qDebug() << "[Api] uploadGameImage gameId=" << id << "→" << status
                     << "stored as" << obj.value("image_path").toString();
        }
        const QString detail = ok
            ? obj.value("image_path").toString()
            : (obj.contains("error") ? obj.value("error").toString()
                                     : QString("HTTP %1").arg(status));
        emit gameImageUploaded(ok, detail);
        reply->deleteLater();
    });
}

QString ApiClient::gameImageUrl(const QString &filename) const
{
    if (filename.isEmpty()) return QString();
    return m_baseUrl + "/api/games/image/" + filename;
}

void ApiClient::getGamePresets()
{
    getJson("/api/games/presets", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit gamePresetsDone(QJsonDocument::fromJson(reply->readAll()).object());
    });
}

void ApiClient::getGameLibrary()
{
    getJson("/api/games/library-list", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit gameLibraryDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}

QString ApiClient::gameLibraryUrl(const QString &filename) const
{
    if (filename.isEmpty()) return QString();
    return m_baseUrl + "/api/games/library/" + filename;
}

void ApiClient::setGameImageFromLibrary(int id, const QString &filename)
{
    postJson(QString("/api/games/%1/image-from-library").arg(id),
             { { "filename", filename } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError);
        emit gameImageUploaded(ok,
                               ok ? obj.value("image_path").toString()
                                  : obj.value("error").toString());
    });
}

// Bulk apply: server scans every game without image_path, finds the closest
// library file by name, copies it in. Intended as a one-click "fill in the
// blanks" action so the operator doesn't need to pick from the gallery for
// every newly seeded game. `force=true` re-matches even games that already
// had an image (useful after dropping new files into the library/).
void ApiClient::autoMatchGameImages(bool force)
{
    const QString path = force
        ? "/api/games/auto-match-images?force=1"
        : "/api/games/auto-match-images";
    postJson(path, {}, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError);
        emit gameAutoMatchDone(ok,
                               obj.value("matched").toInt(0),
                               obj.value("unmatched").toInt(0),
                               ok ? QString() : obj.value("error").toString(reply->errorString()));
    });
}

// ── Network: DNS ──────────────────────────────────────────────────────
void ApiClient::getDnsServers()
{
    getJson("/api/network/dns", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit dnsServersDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createDns(const QJsonObject &data)
{
    postJson("/api/network/dns", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit dnsMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
    });
}
void ApiClient::updateDns(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/network/dns/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit dnsMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
        reply->deleteLater();
    });
}
void ApiClient::deleteDns(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/network/dns/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit dnsMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
        reply->deleteLater();
    });
}
void ApiClient::setDefaultDns(int id)
{
    postJson(QString("/api/network/dns/%1/default").arg(id), {}, [this](QNetworkReply *reply) {
        emit dnsMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
    });
}

// ── Network: Modems ───────────────────────────────────────────────────
void ApiClient::getModems()
{
    getJson("/api/network/modems", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit modemsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createModem(const QJsonObject &data)
{
    postJson("/api/network/modems", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit modemMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
    });
}
void ApiClient::updateModem(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/network/modems/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit modemMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
        reply->deleteLater();
    });
}
void ApiClient::deleteModem(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/network/modems/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit modemMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
        reply->deleteLater();
    });
}

void ApiClient::getNetworkAssignments()
{
    getJson("/api/network/assignments", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit networkAssignmentsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::setNetworkAssignment(const QString &computerName,
                                     const QVariant &modemId,
                                     const QVariant &dnsId)
{
    QJsonObject body{ { "computer_name", computerName } };
    body["modem_id"] = modemId.isValid() && !modemId.isNull() ? QJsonValue(modemId.toInt()) : QJsonValue();
    body["dns_id"]   = dnsId.isValid()   && !dnsId.isNull()   ? QJsonValue(dnsId.toInt())   : QJsonValue();
    postJson("/api/network/assignments", body, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit networkAssignmentDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
    });
}

// ── Audit log ─────────────────────────────────────────────────────────
void ApiClient::getAuditLog(int limit, int offset)
{
    getJson(QString("/api/audit?limit=%1&offset=%2").arg(limit).arg(offset),
            [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit auditLogDone(obj.value("rows").toArray(), obj.value("total").toInt());
    });
}

void ApiClient::getAuditLogFiltered(int limit, int offset,
                                    const QString &admin,
                                    const QString &entity,
                                    const QString &action)
{
    QString path = QString("/api/audit?limit=%1&offset=%2").arg(limit).arg(offset);
    if (!admin.isEmpty())  path += "&admin="  + QUrl::toPercentEncoding(admin);
    if (!entity.isEmpty()) path += "&entity=" + QUrl::toPercentEncoding(entity);
    if (!action.isEmpty()) path += "&action=" + QUrl::toPercentEncoding(action);
    getJson(path, [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit auditLogDone(obj.value("rows").toArray(), obj.value("total").toInt());
    });
}

void ApiClient::changeMyPassword(const QString &currentPassword,
                                 const QString &newPassword)
{
    postJson("/api/admins/me/password",
             { { "currentPassword", currentPassword },
               { "newPassword",     newPassword } },
             [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit passwordChangeDone(reply->error() == QNetworkReply::NoError,
                                obj.value("error").toString());
    });
}

// ── File helper ───────────────────────────────────────────────────────
QString ApiClient::saveToDownloads(const QString &filename, const QString &content) const
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (dir.isEmpty()) return QString();
    QDir().mkpath(dir);
    const QString path = dir + "/" + filename;
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) return QString();
    // BOM for Excel-compatible UTF-8 (so Persian text isn't garbled when opened in Excel).
    f.write("\xEF\xBB\xBF");
    f.write(content.toUtf8());
    f.close();
    return path;
}

// ── Expenses ──────────────────────────────────────────────────────────
void ApiClient::getExpenses(const QString &dateFrom, const QString &dateTo)
{
    QString path = "/api/expenses";
    QStringList params;
    if (!dateFrom.isEmpty()) params << "date_from=" + dateFrom;
    if (!dateTo.isEmpty())   params << "date_to=" + dateTo;
    if (!params.isEmpty())   path += "?" + params.join("&");
    getJson(path, [this](QNetworkReply *reply) {
        QString err; QJsonObject body;
        emit getExpensesDone(replyOk(reply, err, body), body);
    });
}

void ApiClient::createExpense(const QJsonObject &data)
{
    QJsonObject body = data;
    if (!body.contains("idempotency_key"))
        body["idempotency_key"] = QUuid::createUuid().toString(QUuid::WithoutBraces);
    postJson("/api/expenses", body, [this](QNetworkReply *reply) {
        QString err; QJsonObject b;
        emit createExpenseDone(replyOk(reply, err, b), b);
    });
}

void ApiClient::updateExpense(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(
        buildRequest(QString("/api/expenses/%1").arg(id)), "PUT",
        QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, id]() {
        logReply("PUT", QString("/api/expenses/%1").arg(id), reply);
        QString err; QJsonObject body;
        emit updateExpenseDone(replyOk(reply, err, body), body);
        reply->deleteLater();
    });
}

void ApiClient::voidExpense(int id, const QString &reason)
{
    QJsonObject bodyJson{{"reason", reason}};
    auto *reply = m_nam.sendCustomRequest(
        buildRequest(QString("/api/expenses/%1").arg(id)), "DELETE",
        QJsonDocument(bodyJson).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, id]() {
        logReply("DELETE", QString("/api/expenses/%1").arg(id), reply);
        QString err; QJsonObject body;
        emit voidExpenseDone(replyOk(reply, err, body), body);
        reply->deleteLater();
    });
}

void ApiClient::importExpenses(const QJsonArray &items)
{
    QJsonObject body{{"expenses", items}};
    postJson("/api/expenses/import", body, [this](QNetworkReply *reply) {
        QString err; QJsonObject b;
        emit importExpensesDone(replyOk(reply, err, b), b);
    });
}

// ── Admins ────────────────────────────────────────────────────────────
void ApiClient::getAdmins()
{
    getJson("/api/admins", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit adminsDone(QJsonDocument::fromJson(reply->readAll()).array());
    });
}
void ApiClient::createAdmin(const QJsonObject &data)
{
    postJson("/api/admins", data, [this](QNetworkReply *reply) {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit adminMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
    });
}
void ApiClient::updateAdmin(int id, const QJsonObject &data)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/admins/%1").arg(id)),
                                          "PUT",
                                          QJsonDocument(data).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        const auto obj = QJsonDocument::fromJson(reply->readAll()).object();
        emit adminMutationDone(reply->error() == QNetworkReply::NoError, obj.value("error").toString());
        reply->deleteLater();
    });
}
void ApiClient::deleteAdmin(int id)
{
    auto *reply = m_nam.sendCustomRequest(buildRequest(QString("/api/admins/%1").arg(id)), "DELETE");
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        emit adminMutationDone(reply->error() == QNetworkReply::NoError, reply->errorString());
        reply->deleteLater();
    });
}
void ApiClient::getMe()
{
    getJson("/api/admins/me", [this](QNetworkReply *reply) {
        if (reply->error() != QNetworkReply::NoError) { emit networkError(reply->errorString()); return; }
        emit meDone(QJsonDocument::fromJson(reply->readAll()).object());
    });
}
