import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  /** Max bytes of stdout kept in memory (beyond that the process is killed). */
  maxStdoutBytes?: number;
  /** Streaming consumer; when given, stdout is not buffered. */
  onStdout?: (chunk: Buffer) => void;
  signal?: AbortSignal;
  cwd?: string;
}

/**
 * Runs a binary without a shell (no injection), with a wall-clock timeout that
 * kills the whole process group, and bounded output buffering (ADR-0007).
 */
export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', LANG: 'C' },
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    let timedOut = false;
    let finished = false;

    const kill = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const onAbort = () => {
      kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (opts.onStdout) {
        opts.onStdout(chunk);
        return;
      }
      outBytes += chunk.length;
      if (opts.maxStdoutBytes !== undefined && outBytes > opts.maxStdoutBytes) {
        kill();
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Keep only the tail; ffmpeg can be verbose.
      stderr = (stderr + chunk.toString('utf8')).slice(-16_384);
    });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, signal, stdout: Buffer.concat(out), stderr, timedOut });
    });
  });
}
