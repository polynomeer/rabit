import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

/**
 * Microphone recording for Audio Log (LOG-004): permission → record → stop →
 * preview → hand the file to the normal upload. Recorded as MP4/AAC or Ogg/Opus,
 * formats the server already accepts (audio-pipeline §2); WebM is not accepted,
 * so a browser that can record only WebM is told so. The recording stays in the
 * page until it is uploaded or discarded.
 */
const FORMATS = [
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
];

function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null;
}

export function Recorder({ onRecorded }: { onRecorded: (file: File | null) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: number } | null>(null);

  useEffect(
    () => () => {
      rec.current?.stream.getTracks().forEach((tr) => {
        tr.stop();
      });
      if (rec.current) window.clearInterval(rec.current.timer);
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function start() {
    setError(null);
    const format = pickFormat();
    if (!format) {
      setError(t('recorder.unsupported'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('recorder.denied'));
      return;
    }
    const startedAt = Date.now();
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: format.mime });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((tr) => {
        tr.stop();
      });
      const type = format.mime.split(';')[0] ?? format.mime;
      const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      // lastModified carries the start time: the Audio Log's recorded_at (LOG-005).
      const file = new File(chunks, `recording-${stamp}.${format.ext}`, {
        type,
        lastModified: startedAt,
      });
      setPreview(URL.createObjectURL(file));
      setState('done');
      onRecorded(file);
    };
    recorder.start(1000);
    setSeconds(0);
    const timer = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 500);
    rec.current = { recorder, stream, timer };
    setState('recording');
  }

  function stop() {
    if (!rec.current) return;
    window.clearInterval(rec.current.timer);
    rec.current.recorder.stop();
    rec.current = null;
  }

  function discard() {
    setPreview(null);
    setState('idle');
    onRecorded(null);
  }

  const mmss = `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="recorder" role="group" aria-label={t('recorder.group')}>
      {state === 'idle' ? (
        <button type="button" onClick={() => void start()}>
          {t('recorder.start')}
        </button>
      ) : null}
      {state === 'recording' ? (
        <>
          <span role="status" aria-live="polite">
            {t('recorder.recording', { time: mmss })}
          </span>{' '}
          <button type="button" onClick={stop}>
            {t('recorder.stop')}
          </button>
        </>
      ) : null}
      {state === 'done' && preview ? (
        <>
          <audio controls src={preview} aria-label={t('recorder.preview')} />{' '}
          <button type="button" onClick={discard}>
            {t('recorder.discard')}
          </button>
        </>
      ) : null}
      {error ? <p className="warn">{error}</p> : null}
    </div>
  );
}
