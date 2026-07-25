// VoiceCapture — QAudioSource-backed mic recorder for the admin push-to-talk.
//
// Captures 16 kHz / 16-bit / mono PCM, accumulates samples in a buffer, and
// flushes a `chunkReady(mime, base64)` signal every 250 ms while recording.
// QML wraps this in VoiceCallModal: each chunk is forwarded to the target
// kiosk via `Socket.emitEvent("voice:chunk", ...)`.
//
// We send raw PCM (mime "audio/pcm;rate=16000;ch=1;bits=16") rather than
// webm/opus because Qt 6 doesn't expose chunked Opus encoding cheaply — the
// receiver decodes PCM directly. The server is a dumb relay so it doesn't
// care what the bytes are.
#pragma once

#include <QObject>
#include <QByteArray>
#include <QString>

class QAudioSource;
class QIODevice;
class QTimer;

class VoiceCapture : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool   recording READ recording NOTIFY recordingChanged)
    Q_PROPERTY(double level     READ level     NOTIFY levelChanged)

public:
    explicit VoiceCapture(QObject *parent = nullptr);
    ~VoiceCapture() override;

    bool   recording() const { return m_recording; }
    double level()     const { return m_level; }

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();

signals:
    void recordingChanged();
    void levelChanged();
    // Emitted every ~250 ms while recording.
    void chunkReady(const QString &mime, const QString &base64);
    void error(const QString &message);

private slots:
    void onAudioReady();
    void flushChunk();

private:
    void setRecording(bool on);
    void setLevel(double v);

    QAudioSource *m_src    = nullptr;
    QIODevice    *m_io     = nullptr;   // owned by m_src
    QTimer       *m_chunk  = nullptr;
    QByteArray    m_buffer;
    bool          m_recording = false;
    double        m_level     = 0.0;

    static constexpr int kSampleRate = 16000;
    static constexpr int kBits       = 16;
    static constexpr int kChannels   = 1;
};
