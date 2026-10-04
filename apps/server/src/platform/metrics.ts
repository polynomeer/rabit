import { createServer, type Server } from 'node:http';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Low-cardinality labels only (ADR-0013): route templates, status classes, kinds, outcomes. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const metrics = {
  httpRequestDuration: new Histogram({
    name: 'rabit_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['service', 'method', 'route', 'status_class'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),
  jobsTotal: new Counter({
    name: 'rabit_jobs_total',
    help: 'Job executions by outcome',
    labelNames: ['kind', 'outcome'] as const,
    registers: [registry],
  }),
  playbackDecisions: new Counter({
    name: 'rabit_playback_decisions_total',
    help: 'Playback policy decisions',
    labelNames: ['origin', 'decision'] as const,
    registers: [registry],
  }),
  mediaRequests: new Counter({
    name: 'rabit_media_requests_total',
    help: 'Media gateway requests by outcome',
    labelNames: ['kind', 'outcome'] as const,
    registers: [registry],
  }),
  uploads: new Counter({
    name: 'rabit_upload_events_total',
    help: 'Upload lifecycle events',
    labelNames: ['event'] as const,
    registers: [registry],
  }),
  listeningEvents: new Counter({
    name: 'rabit_listening_events_total',
    help: 'Listening events by outcome',
    labelNames: ['outcome'] as const,
    registers: [registry],
  }),
  sessionsRevoked: new Counter({
    name: 'rabit_playback_sessions_revoked_total',
    help: 'Playback sessions revoked',
    labelNames: ['reason'] as const,
    registers: [registry],
  }),
};

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** Internal metrics endpoint on a separate port; never exposed publicly. */
export function startMetricsServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    registry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'content-type': registry.contentType }).end(body);
      })
      .catch(() => res.writeHead(500).end());
  });
  server.listen(port);
  return server;
}
