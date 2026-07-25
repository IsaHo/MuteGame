// MuteGame Admin — Qt/QML entry point
//
// Bootstraps QQuickStyle, registers our C++ singletons (ApiClient, Currency,
// Jalali, Socket), loads the root QML, and hands the event loop to Qt.
//
// Locale rules:
//   • All NUMBERS use English digits (QLocale::English) — this is enforced
//     by setting the *default* locale before any QML loads, so every
//     toLocaleString() and Qt.formatTime() in QML inherits it.
//   • CALENDAR text uses Persian Shamsi (Jalali) — exposed via the Jalali
//     C++ singleton; QML calls Jalali.date(...) / Jalali.dateTime(...).
//   • LAYOUT is RTL globally for proper Persian text flow.
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QFontDatabase>
#include <QLocale>
#include <QDir>

#include "ApiClient.h"
#include "Currency.h"
#include "ExpenseStore.h"
#include "Jalali.h"
#include "SocketClient.h"
#include "VoiceCapture.h"
#include "ServerProcess.h"
#include "NetworkInfo.h"

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName("MuteGame Admin");
    app.setOrganizationName("MuteGame");

    // Force English digits everywhere. QLocale::c() uses ASCII 0-9 numerals
    // regardless of system locale, so toLocaleString in QML always emits
    // "12,345" (never Persian "۱۲٬۳۴۵").
    QLocale enLocale(QLocale::English, QLocale::UnitedStates);
    QLocale::setDefault(enLocale);

    app.setLayoutDirection(Qt::RightToLeft);   // Persian RTL globally

    QQuickStyle::setStyle("Basic");

    const QStringList families = QFontDatabase::families();
    QFont base("Vazirmatn", 10);
    if (!families.contains("Vazirmatn", Qt::CaseInsensitive))
        base = QFont("Tahoma", 10);
    app.setFont(base);

    ApiClient apiClient;
    Currency currency;
    Jalali jalali;
    SocketClient socketClient;
    ExpenseStore expenseStore;
    VoiceCapture voiceCapture;
    ServerProcess serverProcess;
    NetworkInfo networkInfo;

    // Spin up the embedded Node.js server before the UI loads. The admin
    // points Api at http://localhost:3001 by default — the same address.
    serverProcess.start();

    QQmlApplicationEngine engine;
    auto *ctx = engine.rootContext();
    ctx->setContextProperty("Api",      &apiClient);
    ctx->setContextProperty("Currency", &currency);
    ctx->setContextProperty("Jalali",   &jalali);
    ctx->setContextProperty("Socket",   &socketClient);
    ctx->setContextProperty("Expenses", &expenseStore);
    ctx->setContextProperty("Voice",    &voiceCapture);
    ctx->setContextProperty("Server",   &serverProcess);
    ctx->setContextProperty("Network",  &networkInfo);

    // Stop the embedded server cleanly when the admin quits.
    QObject::connect(&app, &QGuiApplication::aboutToQuit,
                     &serverProcess, &ServerProcess::stop);
    // MUTEGAME_PAGE=users → start directly on Users page (debug shortcut)
    const QString startPage = QString::fromUtf8(qgetenv("MUTEGAME_PAGE"));
    ctx->setContextProperty("__startPage", startPage);

    engine.load(QUrl(QStringLiteral("qrc:/qt/qml/Main.qml")));
    if (engine.rootObjects().isEmpty()) return -1;

    return app.exec();
}
