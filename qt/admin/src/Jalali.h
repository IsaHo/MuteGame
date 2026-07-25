// Jalali — Gregorian ⇄ Shamsi (Persian) calendar converter exposed to QML
// as the global `Jalali` singleton. All date displays in the admin go
// through this so the user always sees Shamsi dates with English digits.
//
// Algorithm: the standard Borkowski conversion — accurate from 1900 to 2100
// which is more than enough for the cafe's lifetime.
#pragma once

#include <QObject>
#include <QString>
#include <QDateTime>

class Jalali : public QObject {
    Q_OBJECT
public:
    explicit Jalali(QObject *parent = nullptr) : QObject(parent) {}

    // ── Conversion primitives ────────────────────────────────────────
    Q_INVOKABLE QVariantMap toShamsi(const QDateTime &dt) const;          // → { y, m, d, h, mm, s }
    Q_INVOKABLE QVariantMap toShamsiFromIso(const QString &iso) const;

    // ── Pre-formatted display helpers ─────────────────────────────────
    // "1403/05/12"  — yyyy/mm/dd
    Q_INVOKABLE QString date(const QDateTime &dt) const;
    Q_INVOKABLE QString dateFromIso(const QString &iso) const;
    // "1403/05/12  14:23"
    Q_INVOKABLE QString dateTime(const QDateTime &dt) const;
    Q_INVOKABLE QString dateTimeFromIso(const QString &iso) const;
    // "1403/05/12  14:23:45"
    Q_INVOKABLE QString dateTimeFull(const QDateTime &dt) const;
    // Persian weekday + month name: "شنبه ۱۲ مرداد ۱۴۰۳" (digits are still
    // English by request — names in Persian).
    Q_INVOKABLE QString humanDate(const QDateTime &dt) const;
    Q_INVOKABLE QString humanDateNow() const { return humanDate(QDateTime::currentDateTime()); }

    // Today as YYYY-MM-DD (Shamsi) for date-input value defaults
    Q_INVOKABLE QString todayIso() const;
    // Shamsi YYYY-MM-DD for `today - n days` (used by period filters)
    Q_INVOKABLE QString daysAgoIso(int n) const;

    // ── Calendar helpers (used by the Jalali date picker) ────────────
    Q_INVOKABLE int  monthLength(int jy, int jm) const;
    Q_INVOKABLE bool isLeapYear(int jy) const;
    Q_INVOKABLE QString monthName(int jm) const { return QString::fromUtf8(monthFa(jm)); }
    // 0 = شنبه (Saturday) … 6 = جمعه (Friday) — column index in a Jalali grid
    Q_INVOKABLE int  weekdayOfFirst(int jy, int jm) const;
    // Convert a Jalali Y/M/D to Gregorian "YYYY-MM-DD" (used to bridge data)
    Q_INVOKABLE QString shamsiToGregorianIso(int jy, int jm, int jd) const;

    // ── Compact display helpers ───────────────────────────────────────
    // From a Gregorian ISO ("2026-05-02"), return Shamsi "MM/DD" for axis labels.
    Q_INVOKABLE QString shortDate(const QString &iso) const;
    // From a Shamsi ISO ("1405-02-12") return "12 اردیبهشت" — short pretty form
    Q_INVOKABLE QString prettyShamsi(const QString &shamsiIso) const;

private:
    static void g2j(int gy, int gm, int gd, int &jy, int &jm, int &jd);
    static void j2g(int jy, int jm, int jd, int &gy, int &gm, int &gd);
    static const char *weekdayFa(int dayOfWeek);   // 1..7 Mon..Sun
    static const char *monthFa(int m);              // 1..12
};
