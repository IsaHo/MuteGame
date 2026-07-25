#include "ExpenseStore.h"

#include <QDateTime>
#include <QJsonDocument>

ExpenseStore::ExpenseStore(QObject *parent)
    : QObject(parent),
      m_settings("MuteGame", "MuteGameAdmin")
{
    load();
}

void ExpenseStore::load()
{
    const QString blob = m_settings.value("expenses", "[]").toString();
    const QJsonDocument doc = QJsonDocument::fromJson(blob.toUtf8());
    m_items = doc.isArray() ? doc.array() : QJsonArray{};
}

void ExpenseStore::save()
{
    const QJsonDocument doc(m_items);
    m_settings.setValue("expenses", QString::fromUtf8(doc.toJson(QJsonDocument::Compact)));
    emit itemsChanged();
}

void ExpenseStore::addExpense(const QJsonObject &exp)
{
    QJsonObject record = exp;
    record["id"] = QString::number(QDateTime::currentMSecsSinceEpoch());

    // Prepend so newest sits at the top of the list (matches the React build).
    QJsonArray next;
    next.append(record);
    for (const QJsonValue &v : m_items) next.append(v);
    m_items = next;
    save();
}

void ExpenseStore::updateExpense(int index, const QJsonObject &exp)
{
    if (index < 0 || index >= m_items.size()) return;
    const QJsonObject existing = m_items.at(index).toObject();
    QJsonObject updated = exp;
    if (existing.contains("id")) updated["id"] = existing.value("id");
    m_items.replace(index, updated);
    save();
}

void ExpenseStore::removeExpense(int index)
{
    if (index < 0 || index >= m_items.size()) return;
    m_items.removeAt(index);
    save();
}

bool ExpenseStore::needsServerMigration() const
{
    return !m_settings.value("expenses_migrated_to_server").toBool();
}

QJsonArray ExpenseStore::migrationItems() const
{
    QJsonArray result;
    for (const QJsonValue &v : m_items) {
        QJsonObject obj = v.toObject();
        // Inject idempotency_key from the local id so the server can deduplicate
        // re-imports.  Legacy items have id but no idempotency_key.
        if (!obj.contains(QStringLiteral("idempotency_key")) && obj.contains(QStringLiteral("id"))) {
            obj[QStringLiteral("idempotency_key")] =
                QStringLiteral("local_") + obj.value(QStringLiteral("id")).toString();
        }
        result.append(obj);
    }
    return result;
}

void ExpenseStore::markServerMigrationComplete()
{
    m_settings.setValue("expenses_migrated_to_server", true);
}
