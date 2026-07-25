#include "Jalali.h"

#include <QString>
#include <QStringList>

// Gregorian → Jalali (Borkowski). gy ∈ [1900, 2100]; jy is 4-digit Shamsi.
void Jalali::g2j(int gy, int gm, int gd, int &jy, int &jm, int &jd)
{
    static const int gDaysInMonth[12] = { 31,28,31,30,31,30,31,31,30,31,30,31 };
    static const int jDaysInMonth[12] = { 31,31,31,31,31,31,30,30,30,30,30,29 };

    int gy2 = (gm > 2) ? (gy + 1) : gy;
    int days = 355666 + (365 * gy)
             + ((gy2 + 3) / 4) - ((gy2 + 99) / 100) + ((gy2 + 399) / 400)
             + gd;
    for (int i = 0; i < gm - 1; ++i) days += gDaysInMonth[i];
    if (gm > 2 && ((gy % 4 == 0 && gy % 100 != 0) || (gy % 400 == 0))) days += 1;

    jy = -1595 + (33 * (days / 12053));
    days %= 12053;
    jy += 4 * (days / 1461);
    days %= 1461;
    if (days > 365) {
        jy += (days - 1) / 365;
        days = (days - 1) % 365;
    }

    int i;
    for (i = 0; i < 11 && days >= jDaysInMonth[i]; ++i) days -= jDaysInMonth[i];
    jm = i + 1;
    jd = days + 1;
}

const char *Jalali::weekdayFa(int dow)
{
    // Qt's Date::dayOfWeek(): 1 = Monday … 7 = Sunday
    static const char *names[7] = {
        "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"
    };
    if (dow < 1 || dow > 7) return "";
    return names[dow - 1];
}

const char *Jalali::monthFa(int m)
{
    static const char *names[12] = {
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
        "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
    };
    if (m < 1 || m > 12) return "";
    return names[m - 1];
}

QVariantMap Jalali::toShamsi(const QDateTime &dt) const
{
    if (!dt.isValid()) return {};
    int jy, jm, jd;
    const QDate g = dt.date();
    g2j(g.year(), g.month(), g.day(), jy, jm, jd);
    const QTime t = dt.time();
    return QVariantMap{
        {"y", jy}, {"m", jm}, {"d", jd},
        {"h", t.hour()}, {"mm", t.minute()}, {"s", t.second()}
    };
}

QVariantMap Jalali::toShamsiFromIso(const QString &iso) const
{
    return toShamsi(QDateTime::fromString(iso, Qt::ISODate));
}

QString Jalali::date(const QDateTime &dt) const
{
    if (!dt.isValid()) return "—";
    int jy, jm, jd;
    g2j(dt.date().year(), dt.date().month(), dt.date().day(), jy, jm, jd);
    return QString::asprintf("%04d/%02d/%02d", jy, jm, jd);
}
QString Jalali::dateFromIso(const QString &iso) const
{
    return date(QDateTime::fromString(iso, Qt::ISODate));
}

QString Jalali::dateTime(const QDateTime &dt) const
{
    if (!dt.isValid()) return "—";
    int jy, jm, jd;
    g2j(dt.date().year(), dt.date().month(), dt.date().day(), jy, jm, jd);
    return QString::asprintf("%04d/%02d/%02d  %02d:%02d",
                             jy, jm, jd, dt.time().hour(), dt.time().minute());
}
QString Jalali::dateTimeFromIso(const QString &iso) const
{
    // Server returns "YYYY-MM-DD HH:MM:SS" sometimes (SQLite default), parse both
    QDateTime dt = QDateTime::fromString(iso, Qt::ISODate);
    if (!dt.isValid()) dt = QDateTime::fromString(iso, "yyyy-MM-dd HH:mm:ss");
    return dateTime(dt);
}

QString Jalali::dateTimeFull(const QDateTime &dt) const
{
    if (!dt.isValid()) return "—";
    int jy, jm, jd;
    g2j(dt.date().year(), dt.date().month(), dt.date().day(), jy, jm, jd);
    return QString::asprintf("%04d/%02d/%02d  %02d:%02d:%02d",
                             jy, jm, jd,
                             dt.time().hour(), dt.time().minute(), dt.time().second());
}

QString Jalali::humanDate(const QDateTime &dt) const
{
    if (!dt.isValid()) return "—";
    int jy, jm, jd;
    g2j(dt.date().year(), dt.date().month(), dt.date().day(), jy, jm, jd);
    // "شنبه 12 مرداد 1403"
    return QString("%1 %2 %3 %4")
        .arg(weekdayFa(dt.date().dayOfWeek()))
        .arg(jd)
        .arg(monthFa(jm))
        .arg(jy);
}

QString Jalali::todayIso() const
{
    int jy, jm, jd;
    const QDate g = QDate::currentDate();
    g2j(g.year(), g.month(), g.day(), jy, jm, jd);
    return QString::asprintf("%04d-%02d-%02d", jy, jm, jd);
}

QString Jalali::daysAgoIso(int n) const
{
    int jy, jm, jd;
    const QDate g = QDate::currentDate().addDays(-n);
    g2j(g.year(), g.month(), g.day(), jy, jm, jd);
    return QString::asprintf("%04d-%02d-%02d", jy, jm, jd);
}

bool Jalali::isLeapYear(int jy) const
{
    // Borkowski leap rule (sufficient for 1300–1500 Shamsi).
    const int rem = ((jy % 33) + 33) % 33;
    return rem == 1 || rem == 5 || rem == 9 || rem == 13
        || rem == 17 || rem == 22 || rem == 26 || rem == 30;
}

int Jalali::monthLength(int jy, int jm) const
{
    if (jm < 1 || jm > 12) return 0;
    if (jm <= 6)  return 31;
    if (jm <= 11) return 30;
    return isLeapYear(jy) ? 30 : 29;   // Esfand
}

// Reverse Borkowski — Jalali → Gregorian by walking days from a known anchor.
// Anchor: 1 Farvardin 1404 ≡ 21 March 2025 (Friday).
void Jalali::j2g(int jy, int jm, int jd, int &gy, int &gm, int &gd)
{
    static const int jy0 = 1404;
    QDate g0(2025, 3, 21);

    // Days from start of jy back to start of jy0 (positive when jy > jy0)
    int delta = 0;
    Jalali tmp;   // for isLeapYear access
    if (jy >= jy0) {
        for (int y = jy0; y < jy; ++y) delta += tmp.isLeapYear(y) ? 366 : 365;
    } else {
        for (int y = jy; y < jy0; ++y) delta -= tmp.isLeapYear(y) ? 366 : 365;
    }
    // Days from start of jy to (jm, jd)
    for (int m = 1; m < jm; ++m) delta += tmp.monthLength(jy, m);
    delta += jd - 1;

    const QDate g = g0.addDays(delta);
    gy = g.year(); gm = g.month(); gd = g.day();
}

int Jalali::weekdayOfFirst(int jy, int jm) const
{
    int gy, gm, gd;
    j2g(jy, jm, 1, gy, gm, gd);
    // QDate::dayOfWeek(): 1 = Mon … 7 = Sun
    // We want: 0 = Sat (شنبه) … 6 = Fri (جمعه)
    const int dow = QDate(gy, gm, gd).dayOfWeek();           // 1..7 Mon..Sun
    // Map: Sat(6)=0, Sun(7)=1, Mon(1)=2, Tue(2)=3, Wed(3)=4, Thu(4)=5, Fri(5)=6
    static const int map[8] = { 0, 2, 3, 4, 5, 6, 0, 1 };
    return map[dow];
}

QString Jalali::shamsiToGregorianIso(int jy, int jm, int jd) const
{
    int gy, gm, gd;
    j2g(jy, jm, jd, gy, gm, gd);
    return QString::asprintf("%04d-%02d-%02d", gy, gm, gd);
}

QString Jalali::shortDate(const QString &iso) const
{
    QDateTime dt = QDateTime::fromString(iso, Qt::ISODate);
    if (!dt.isValid()) dt = QDateTime::fromString(iso, "yyyy-MM-dd");
    if (!dt.isValid()) return iso.right(5);   // fallback to "MM-DD"
    int jy, jm, jd;
    g2j(dt.date().year(), dt.date().month(), dt.date().day(), jy, jm, jd);
    return QString::asprintf("%02d/%02d", jm, jd);
}

QString Jalali::prettyShamsi(const QString &shamsiIso) const
{
    // Parse "YYYY-MM-DD" Shamsi
    const QStringList parts = shamsiIso.split('-');
    if (parts.size() != 3) return shamsiIso;
    bool ok1, ok2, ok3;
    const int jy = parts[0].toInt(&ok1);
    const int jm = parts[1].toInt(&ok2);
    const int jd = parts[2].toInt(&ok3);
    if (!ok1 || !ok2 || !ok3) return shamsiIso;
    return QString("%1 %2").arg(jd).arg(QString::fromUtf8(monthFa(jm)));
}
