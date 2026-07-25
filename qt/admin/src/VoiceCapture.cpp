#include "VoiceCapture.h"

#include <QAudioSource>
#include <QAudioFormat>
#include <QMediaDevices>
#include <QAudioDevice>
#include <QIODevice>
#include <QTimer>
#include <QtMath>

VoiceCapture::VoiceCapture(QObject *parent) : QObject(parent)
{
    m_chunk = new QTimer(this);
    m_chunk->setInterval(250);
    connect(m_chunk, &QTimer::timeout, this, &VoiceCapture::flushChunk);
}

VoiceCapture::~VoiceCapture() { stop(); }

void VoiceCapture::start()
{
    if (m_recording) return;

    QAudioFormat fmt;
    fmt.setSampleRate(kSampleRate);
    fmt.setChannelCount(kChannels);
    fmt.setSampleFormat(QAudioFormat::Int16);

    const QAudioDevice dev = QMediaDevices::defaultAudioInput();
    if (dev.isNull()) {
        emit error(QStringLiteral("هیچ میکروفونی پیدا نشد"));
        return;
    }
    if (!dev.isFormatSupported(fmt)) {
        emit error(QStringLiteral("میکروفون فرمت 16kHz/16-bit/mono رو پشتیبانی نمی‌کنه"));
        return;
    }

    m_src = new QAudioSource(dev, fmt, this);
    m_io  = m_src->start();
    if (!m_io) {
        emit error(QStringLiteral("شروع ضبط ناموفق بود — مجوز میکروفون رو چک کن"));
        m_src->deleteLater();
        m_src = nullptr;
        return;
    }
    connect(m_io, &QIODevice::readyRead, this, &VoiceCapture::onAudioReady);

    m_buffer.clear();
    m_chunk->start();
    setRecording(true);
}

void VoiceCapture::stop()
{
    if (!m_recording && !m_src) return;
    m_chunk->stop();
    if (m_io) {
        disconnect(m_io, &QIODevice::readyRead, this, &VoiceCapture::onAudioReady);
        m_io = nullptr;
    }
    if (m_src) {
        m_src->stop();
        m_src->deleteLater();
        m_src = nullptr;
    }
    // Final flush so trailing audio doesn't get dropped.
    if (!m_buffer.isEmpty()) flushChunk();
    m_buffer.clear();
    setLevel(0.0);
    setRecording(false);
}

void VoiceCapture::onAudioReady()
{
    if (!m_io) return;
    const QByteArray bytes = m_io->readAll();
    if (bytes.isEmpty()) return;
    m_buffer.append(bytes);

    // RMS level for the VU meter — read up to last 1024 samples for cheap UI.
    const int sampleCount = bytes.size() / 2;
    if (sampleCount > 0) {
        const auto *samples = reinterpret_cast<const qint16 *>(bytes.constData());
        double acc = 0.0;
        const int take = qMin(sampleCount, 1024);
        const int start = sampleCount - take;
        for (int i = 0; i < take; ++i) {
            const double v = static_cast<double>(samples[start + i]) / 32767.0;
            acc += v * v;
        }
        const double rms = qSqrt(acc / take);
        setLevel(qBound(0.0, rms * 1.6, 1.0));   // bias up so quiet talk is visible
    }
}

void VoiceCapture::flushChunk()
{
    if (m_buffer.isEmpty()) return;
    const QString b64 = QString::fromLatin1(m_buffer.toBase64());
    m_buffer.clear();
    const QString mime = QString("audio/pcm;rate=%1;ch=%2;bits=%3")
                             .arg(kSampleRate).arg(kChannels).arg(kBits);
    emit chunkReady(mime, b64);
}

void VoiceCapture::setRecording(bool on)
{
    if (m_recording == on) return;
    m_recording = on;
    emit recordingChanged();
}
void VoiceCapture::setLevel(double v)
{
    if (qFuzzyCompare(m_level + 1.0, v + 1.0)) return;
    m_level = v;
    emit levelChanged();
}
