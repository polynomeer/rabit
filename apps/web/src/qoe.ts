import { api } from './api';

/** What the server takes as a session's quality report (QoE, slo.md). */
export interface QualityReport {
  platform: 'web';
  startup_ms: number | null;
  played_ms: number;
  stall_count: number;
  stall_ms: number;
  error: 'network' | 'media' | 'other' | null;
}

/**
 * Measures one playback session from the media element's events: time from
 * choosing the track to the first audible frame, time playing, and stalls after
 * playback started. Pauses, seeks and the stall at the very end of a track (see
 * `stalledAtEnd` in player.tsx) are not stalls.
 */
export class QualityTracker {
  private firstAudible: number | null = null;
  private playingSince: number | null = null;
  private stallSince: number | null = null;
  private seeking = false;
  private playedMs = 0;
  private stalls = 0;
  private stallMs = 0;
  private error: QualityReport['error'] = null;
  private sent = false;

  constructor(
    readonly sessionId: string,
    private readonly requestedAt: number,
  ) {}

  private stopPlaying(now: number) {
    if (this.playingSince !== null) this.playedMs += now - this.playingSince;
    this.playingSince = null;
  }

  private stopStall(now: number) {
    if (this.stallSince !== null) this.stallMs += now - this.stallSince;
    this.stallSince = null;
  }

  playing(now = performance.now()) {
    this.firstAudible ??= now;
    this.stopStall(now);
    this.seeking = false;
    this.playingSince ??= now;
  }

  paused(now = performance.now()) {
    this.stopPlaying(now);
    this.stopStall(now);
  }

  seekStarted(now = performance.now()) {
    this.stopPlaying(now);
    this.seeking = true;
  }

  waiting(atEnd: boolean, now = performance.now()) {
    this.stopPlaying(now);
    if (this.firstAudible === null || this.seeking || atEnd || this.stallSince !== null) return;
    this.stalls++;
    this.stallSince = now;
  }

  failed(error: NonNullable<QualityReport['error']>) {
    this.error ??= error;
  }

  /** The report, once; null afterwards. */
  report(now = performance.now()): QualityReport | null {
    if (this.sent) return null;
    this.sent = true;
    this.stopPlaying(now);
    this.stopStall(now);
    return {
      platform: 'web',
      startup_ms:
        this.firstAudible === null ? null : Math.round(this.firstAudible - this.requestedAt),
      played_ms: Math.round(this.playedMs),
      stall_count: this.stalls,
      stall_ms: Math.round(this.stallMs),
      error: this.error,
    };
  }

  /** Sends the report; quality reporting never disturbs playback. */
  send(): void {
    const r = this.report();
    if (!r) return;
    void api('POST', `/v1/playback-sessions/${this.sessionId}/quality`, r).catch(() => undefined);
  }
}
