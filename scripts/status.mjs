// pnpm status — what is running locally and whether it answers.
import { dockerRunning, fail, infraState, ok, ports, say, warn } from './lib.mjs';

async function probe(name, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (res.ok) ok(`${name}  ${url}`);
    else
      warn(
        `${name}  ${url} answered ${String(res.status)} — probably not Rabit (another program on this port?)`,
      );
  } catch {
    fail(`${name}  ${url} not reachable`);
  }
}

if (!dockerRunning()) fail('Docker is not running');
else
  for (const [svc, st] of Object.entries(infraState()))
    if (st === 'healthy') ok(`${svc} container healthy`);
    else warn(`${svc} container ${st}  (pnpm infra:up)`);

const p = ports();
await probe('api      ', `http://localhost:${String(p.api)}/readyz`);
await probe('media    ', `http://localhost:${String(p.media)}/healthz`);
await probe('worker   ', `http://localhost:${String(p.metricsWorker)}/metrics`);
await probe('web      ', `http://localhost:${String(p.web)}/`);
say();
