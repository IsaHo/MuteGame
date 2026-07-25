// Currency formatter — exposed to QML as the global `Currency` singleton.
//
// All amounts are stored on the server in RIAL (the canonical unit) but the
// new Qt admin shows everything in TOMAN per the user's spec. Conversion is
// 1 toman = 10 rial (so we just divide on display).
//
// Also provides helpers for the "3-digit grouped" input formatting used
// across the new UI: format("12345") → "12,345".
#pragma once

#include <QObject>
#include <QString>

class Currency : public QObject {
    Q_OBJECT
public:
    explicit Currency(QObject *parent = nullptr) : QObject(parent) {}

    // Convert a Rial amount to a display Toman string (e.g. 250000 → "25,000 تومان").
    Q_INVOKABLE QString format(double rialAmount) const;

    // Bare number with thousand separators (no unit). Used inside text inputs.
    Q_INVOKABLE QString grouped(const QString &raw) const;

    // Strip every non-digit and return the canonical raw integer string.
    Q_INVOKABLE QString unGrouped(const QString &display) const;

    // Convert a user-entered Toman string back to Rial integer for the server.
    Q_INVOKABLE qint64 tomanInputToRial(const QString &display) const;

    // Display unit label
    Q_INVOKABLE QString label() const { return QStringLiteral("تومان"); }
};
