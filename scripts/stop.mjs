// pnpm stop [--infra] — stops this checkout's running `pnpm dev` (api, worker, media,
// web) from another terminal. --infra also stops the Postgres and S3 containers (their
// data is kept; `pnpm infra:down -v` deletes it).
import process from 'node:process';
import { alive, clearRunState, dim, ok, run, runState, say, warn } from './lib.mjs';

const args = new Set(process.argv.slice(2));
const state = runState();
if (!state) {
  warn('no pnpm dev is running in this checkout');
  clearRunState();
} else {
  process.kill(state.pid, 'SIGTERM');
  const until = Date.now() + 10_000;
  while (alive(state.pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  if (alive(state.pid)) {
    process.kill(state.pid, 'SIGKILL');
    warn(`pnpm dev (pid ${String(state.pid)}) did not stop in 10 s; killed`);
  } else ok(`stopped pnpm dev (pid ${String(state.pid)})`);
  clearRunState();
}
if (args.has('--infra')) {
  const r = run('docker', ['compose', 'stop']);
  if (r.status === 0) ok('stopped the Postgres and S3 containers (data kept)');
  else warn(r.stderr.trim() || 'docker compose stop failed');
} else say(dim('  Postgres and S3 keep running: pnpm stop -- --infra stops them too.'));
