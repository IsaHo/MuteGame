#include "Currency.h"

#include <QLocale>

QString Currency::format(double rialAmount) const
{
    // Rial → Toman (display only)
    const qint64 toman = qRound64(rialAmount / 10.0);
    QLocale en(QLocale::English, QLocale::UnitedStates);
    return en.toString(toman) + QStringLiteral(" تومان");
}

QString Currency::grouped(const QString &raw) const
{
    QString digits;
    for (QChar c : raw) if (c.isDigit()) digits.append(c);
    if (digits.isEmpty()) return QString();
    QLocale en(QLocale::English);
    return en.toString(digits.toLongLong());
}

QString Currency::unGrouped(const QString &display) const
{
    QString digits;
    for (QChar c : display) if (c.isDigit()) digits.append(c);
    return digits;
}

qint64 Currency::tomanInputToRial(const QString &display) const
{
    const QString digits = unGrouped(display);
    if (digits.isEmpty()) return 0;
    return digits.toLongLong() * 10; // toman → rial
}
