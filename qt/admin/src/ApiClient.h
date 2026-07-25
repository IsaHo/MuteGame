// ApiClient — thin async REST wrapper exposed to QML as the `Api` singleton.
//
// Every call returns immediately and emits one of the corresponding *Done()
// signals when the response arrives. The token from a successful login is
// kept in `m_token` and attached as a Bearer header to subsequent requests.
//
// We could later swap this for a richer Promise-style API, but the
// signal-per-call pattern maps cleanly to QML and avoids extra dependencies.
#pragma once

#include <QObject>
#include <QString>
#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QUuid>

class ApiClient : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString baseUrl READ baseUrl WRITE setBaseUrl NOTIFY baseUrlChanged)
    Q_PROPERTY(bool authenticated READ authenticated NOTIFY authenticatedChanged)

public:
    explicit ApiClient(QObject *parent = nullptr);

    QString baseUrl() const { return m_baseUrl; }
    void setBaseUrl(const QString &url);
    bool authenticated() const { return !m_token.isEmpty(); }

    // ── Auth ──────────────────────────────────────────────────────────
    Q_INVOKABLE void adminLogin(const QString &username, const QString &password);

    // ── Stats / dashboard ────────────────────────────────────────────
    Q_INVOKABLE void getStats();
    Q_INVOKABLE void getRevenueReport(int days);
    Q_INVOKABLE void getShopReport(int days);
    Q_INVOKABLE void getShopProfit(int days);
    Q_INVOKABLE void getSessions();
    Q_INVOKABLE void getClients();

    // ── Live actions on a connected client ───────────────────────────
    Q_INVOKABLE void kickClient(const QString &socketId);
    Q_INVOKABLE void messageClient(const QString &socketId, const QString &text);
    Q_INVOKABLE void extendClient(const QString &socketId, int minutes);
    Q_INVOKABLE void setClientVoiceMute(const QString &socketId, bool muted);
    Q_INVOKABLE void powerClient(const QString &socketId, const QString &action);
    Q_INVOKABLE void forceLoginClient(const QString &socketId,
                                      int userId, const QString &username,
                                      qint64 credits);

    // ── Users ─────────────────────────────────────────────────────────
    Q_INVOKABLE void getUsers();
    Q_INVOKABLE void getBadPayers();
    Q_INVOKABLE void getDebtors();
    Q_INVOKABLE void getDebtTransactions(int days);
    Q_INVOKABLE void createUser(const QJsonObject &data);
    Q_INVOKABLE void updateUser(int id, const QJsonObject &data);
    Q_INVOKABLE void toggleUser(int id);
    Q_INVOKABLE void deleteUser(int id);
    Q_INVOKABLE void chargeUser(int id, qint64 amount, const QString &description, bool free = false);
    Q_INVOKABLE void dechargeUser(int id, qint64 amount, const QString &description);
    Q_INVOKABLE void addDebt(int id, qint64 amount, const QString &description);
    Q_INVOKABLE void payDebt(int id, qint64 amount, const QString &description);
    Q_INVOKABLE void togglePostPay(int id, int value = -1);
    Q_INVOKABLE void getUserTransactions(int id);

    // ── Shop ──────────────────────────────────────────────────────────
    Q_INVOKABLE void getShopItems(bool includeInactive = false);
    Q_INVOKABLE void createShopItem(const QJsonObject &data);
    Q_INVOKABLE void updateShopItem(int id, const QJsonObject &data);
    Q_INVOKABLE void deleteShopItem(int id);
    Q_INVOKABLE void getOrders(const QString &status = QString());
    Q_INVOKABLE void approveOrder(int id);
    Q_INVOKABLE void cancelOrder(int id);

    // ── Settings ──────────────────────────────────────────────────────
    Q_INVOKABLE void getSettings();
    Q_INVOKABLE void saveSettings(const QJsonObject &settings);

    // ── Games ─────────────────────────────────────────────────────────
    Q_INVOKABLE void getGames(bool onlyActive = false);
    Q_INVOKABLE void createGame(const QJsonObject &data);
    Q_INVOKABLE void updateGame(int id, const QJsonObject &data);
    Q_INVOKABLE void deleteGame(int id);
    Q_INVOKABLE void uploadGameImage(int id, const QString &filePath);
    Q_INVOKABLE QString gameImageUrl(const QString &filename) const;
    // Pre-stocked content the operator picks from instead of typing every
    // game by hand: presets (name+exe+category catalogue) and the local
    // images/library/ folder served as a gallery.
    Q_INVOKABLE void getGamePresets();
    Q_INVOKABLE void getGameLibrary();
    Q_INVOKABLE QString gameLibraryUrl(const QString &filename) const;
    Q_INVOKABLE void setGameImageFromLibrary(int id, const QString &filename);
    // Bulk-applies the closest library image to every game without one.
    // `force=true` re-matches even games that already have an image.
    Q_INVOKABLE void autoMatchGameImages(bool force = false);

    // ── Network: DNS ──────────────────────────────────────────────────
    Q_INVOKABLE void getDnsServers();
    Q_INVOKABLE void createDns(const QJsonObject &data);
    Q_INVOKABLE void updateDns(int id, const QJsonObject &data);
    Q_INVOKABLE void deleteDns(int id);
    Q_INVOKABLE void setDefaultDns(int id);

    // ── Network: Modems ───────────────────────────────────────────────
    Q_INVOKABLE void getModems();
    Q_INVOKABLE void createModem(const QJsonObject &data);
    Q_INVOKABLE void updateModem(int id, const QJsonObject &data);
    Q_INVOKABLE void deleteModem(int id);

    // ── Network: Per-PC assignments (modem + DNS) ────────────────────
    Q_INVOKABLE void getNetworkAssignments();
    Q_INVOKABLE void setNetworkAssignment(const QString &computerName,
                                          const QVariant &modemId,
                                          const QVariant &dnsId);

    // ── Audit log ────────────────────────────────────────────────────
    Q_INVOKABLE void getAuditLog(int limit = 200, int offset = 0);
    // Filtered variant — pass empty strings to skip a filter
    Q_INVOKABLE void getAuditLogFiltered(int limit, int offset,
                                         const QString &admin,
                                         const QString &entity,
                                         const QString &action);

    // ── Self password change ─────────────────────────────────────────
    Q_INVOKABLE void changeMyPassword(const QString &currentPassword,
                                      const QString &newPassword);

    // ── Misc helpers ─────────────────────────────────────────────────
    // Writes `content` as UTF-8 text to ~/Downloads/<filename>. Returns the
    // absolute path on success, empty string on failure. Used by ReportsPage
    // for CSV export.
    Q_INVOKABLE QString saveToDownloads(const QString &filename, const QString &content) const;

    // ── Expenses ──────────────────────────────────────────────────────
    Q_INVOKABLE void getExpenses(const QString &dateFrom = {}, const QString &dateTo = {});
    Q_INVOKABLE void createExpense(const QJsonObject &data);
    Q_INVOKABLE void updateExpense(int id, const QJsonObject &data);
    Q_INVOKABLE void voidExpense(int id, const QString &reason);
    Q_INVOKABLE void importExpenses(const QJsonArray &items);

    // ── Admins ────────────────────────────────────────────────────────
    Q_INVOKABLE void getAdmins();
    Q_INVOKABLE void createAdmin(const QJsonObject &data);
    Q_INVOKABLE void updateAdmin(int id, const QJsonObject &data);
    Q_INVOKABLE void deleteAdmin(int id);
    Q_INVOKABLE void getMe();

    Q_INVOKABLE void logout();

signals:
    void baseUrlChanged();
    void authenticatedChanged();

    void loginDone(bool ok, const QString &errorOrToken);
    void statsDone(const QJsonObject &stats);
    void revenueDone(const QJsonArray &rows);
    void shopReportDone(const QJsonArray &rows);
    void shopProfitDone(const QJsonObject &profit);
    void sessionsDone(const QJsonArray &rows);
    void clientsDone(const QJsonArray &clients);
    void clientActionDone(bool ok, const QString &error);
    void usersDone(const QJsonArray &users);
    void badPayersDone(const QJsonArray &users);
    void debtorsDone(const QJsonArray &users);
    void debtTransactionsDone(const QJsonArray &rows);
    void userMutationDone(bool ok, const QString &error, const QJsonObject &result);
    void transactionsDone(const QJsonArray &rows);
    void shopItemsDone(const QJsonArray &items);
    void shopMutationDone(bool ok, const QString &error);
    void ordersDone(const QJsonArray &orders);
    void orderActionDone(bool ok, const QString &error);
    void settingsLoaded(const QJsonObject &settings);
    void settingsSaved(bool ok, const QString &error);
    void gamesDone(const QJsonArray &games);
    void gameMutationDone(bool ok, const QString &error);
    void gameImageUploaded(bool ok, const QString &error);
    void gamePresetsDone(const QJsonObject &presets);
    void gameLibraryDone(const QJsonArray &filenames);
    // Bulk auto-match result. `matched` and `unmatched` add up to the count
    // of games considered (active games without an image, or all if forced).
    void gameAutoMatchDone(bool ok, int matched, int unmatched, const QString &error);
    void dnsServersDone(const QJsonArray &servers);
    void dnsMutationDone(bool ok, const QString &error);
    void modemsDone(const QJsonArray &modems);
    void modemMutationDone(bool ok, const QString &error);
    void networkAssignmentsDone(const QJsonArray &rows);
    void networkAssignmentDone(bool ok, const QString &error);
    void auditLogDone(const QJsonArray &rows, int total);
    void passwordChangeDone(bool ok, const QString &error);
    void getExpensesDone(bool ok, QJsonObject body);
    void createExpenseDone(bool ok, QJsonObject body);
    void updateExpenseDone(bool ok, QJsonObject body);
    void voidExpenseDone(bool ok, QJsonObject body);
    void importExpensesDone(bool ok, QJsonObject body);
    void adminsDone(const QJsonArray &admins);
    void adminMutationDone(bool ok, const QString &error);
    void meDone(const QJsonObject &me);
    void networkError(const QString &message);

private:
    QNetworkRequest buildRequest(const QString &path) const;
    void postJson(const QString &path, const QJsonObject &body,
                  std::function<void(QNetworkReply *)> onReply);
    void getJson(const QString &path,
                 std::function<void(QNetworkReply *)> onReply);

    QNetworkAccessManager m_nam;
    QString m_baseUrl = "http://localhost:3001";
    QString m_token;
};
