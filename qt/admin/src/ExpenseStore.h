// ExpenseStore — QSettings-backed store for legacy (pre-server) expenses.
//
// New expenses are written directly to /api/expenses on the server.
// This store is migration-only: it holds QSettings items from the React/legacy
// era and exposes them via migrationItems() so AccountingPage.qml can POST
// them once to /api/expenses/import.  After migration the store is idle; the
// server is the sole source of truth.
//
// Each legacy item is a QJsonObject: { id, date: "YYYY-MM-DD", category, desc, amount }.
// migrationItems() injects idempotency_key = "local_" + id so the server can
// deduplicate re-imports safely.
#pragma once

#include <QObject>
#include <QJsonArray>
#include <QJsonObject>
#include <QSettings>

class ExpenseStore : public QObject {
    Q_OBJECT
    Q_PROPERTY(QJsonArray items READ items NOTIFY itemsChanged)
public:
    explicit ExpenseStore(QObject *parent = nullptr);

    QJsonArray items() const { return m_items; }

    Q_INVOKABLE void addExpense(const QJsonObject &exp);
    Q_INVOKABLE void updateExpense(int index, const QJsonObject &exp);
    Q_INVOKABLE void removeExpense(int index);

    // Server-migration helpers — orchestrated by AccountingPage.qml.
    // ExpenseStore does not know about ApiClient; it only guards the flag.
    Q_INVOKABLE bool       needsServerMigration() const;
    Q_INVOKABLE QJsonArray migrationItems() const;
    Q_INVOKABLE void       markServerMigrationComplete();

signals:
    void itemsChanged();

private:
    void load();
    void save();

    QJsonArray m_items;
    QSettings  m_settings;
};
