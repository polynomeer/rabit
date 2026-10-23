import { createServer, type Server } from 'node:http';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

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
  paymentEvents: new Counter({
    name: 'rabit_payment_events_total',
    help: 'Payment provider webhooks by type and outcome (received, rejected, applied, ignored, held)',
    labelNames: ['provider', 'type', 'outcome'] as const,
    registers: [registry],
  }),
  orders: new Counter({
    name: 'rabit_orders_total',
    help: 'Order state transitions',
    labelNames: ['event'] as const,
    registers: [registry],
  }),
  appStoreOverlaps: new Counter({
    name: 'rabit_app_store_overlaps_total',
    help: 'App Store periods applied while a web subscription was active (support refunds one side)',
    registers: [registry],
  }),
  paymentReconcileMismatches: new Counter({
    name: 'rabit_payment_reconcile_mismatches_total',
    help: 'Orders whose state disagrees with the payment provider',
    labelNames: ['kind'] as const,
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
  usageStreams: new Counter({
    name: 'rabit_usage_streams_closed_total',
    help: 'Qualifying streams written to closed monthly usage statements (ADR-0025)',
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
  // Client-reported playback quality (QoE, slo.md): platform labels only.
  playbackStartup: new Histogram({
    name: 'rabit_playback_startup_seconds',
    help: 'Client time from choosing a track to the first audible frame',
    labelNames: ['platform'] as const,
    buckets: [0.25, 0.5, 1, 1.5, 2, 3, 5, 10, 30],
    registers: [registry],
  }),
  playbackPlayedSeconds: new Counter({
    name: 'rabit_playback_played_seconds_total',
    help: 'Client-reported playing time, the denominator of the rebuffering ratio',
    labelNames: ['platform'] as const,
    registers: [registry],
  }),
  playbackStallSeconds: new Counter({
    name: 'rabit_playback_stall_seconds_total',
    help: 'Client-reported time stalled (rebuffering) after playback started',
    labelNames: ['platform'] as const,
    registers: [registry],
  }),
  playbackStalls: new Counter({
    name: 'rabit_playback_stalls_total',
    help: 'Client-reported stalls after playback started',
    labelNames: ['platform'] as const,
    registers: [registry],
  }),
  playbackClientErrors: new Counter({
    name: 'rabit_playback_client_errors_total',
    help: 'Sessions that ended in a client playback error, by error class',
    labelNames: ['platform', 'code'] as const,
    registers: [registry],
  }),
  clientLaunches: new Counter({
    name: 'rabit_client_launches_total',
    help: 'App launches (iOS) and page loads (web) reported by signed-in clients (ADR-0027)',
    labelNames: ['platform'] as const,
    registers: [registry],
  }),
  clientErrorsReported: new Counter({
    name: 'rabit_client_errors_reported_total',
    help: 'Client errors, crashes and hangs reported, by kind (ADR-0027)',
    labelNames: ['platform', 'kind'] as const,
    registers: [registry],
  }),
  clientErrorGroupsDropped: new Counter({
    name: 'rabit_client_error_groups_dropped_total',
    help: 'New client error groups not stored because the group cap was reached',
    labelNames: ['platform'] as const,
    registers: [registry],
  }),
  webVitalsLcp: new Histogram({
    name: 'rabit_web_vitals_lcp_seconds',
    help: 'Largest Contentful Paint of web page views',
    buckets: [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10],
    registers: [registry],
  }),
  webVitalsInp: new Histogram({
    name: 'rabit_web_vitals_inp_seconds',
    help: 'Interaction to Next Paint of web page views',
    buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2],
    registers: [registry],
  }),
  webVitalsCls: new Histogram({
    name: 'rabit_web_vitals_cls',
    help: 'Cumulative Layout Shift of web page views',
    buckets: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
    registers: [registry],
  }),
  playbackQualityReports: new Counter({
    name: 'rabit_playback_quality_reports_total',
    help: 'Playback quality reports by outcome (accepted, duplicate, implausible)',
    labelNames: ['platform', 'outcome'] as const,
    registers: [registry],
  }),
  listeningEvents: new Counter({
    name: 'rabit_listening_events_total',
    help: 'Listening events by outcome',
    labelNames: ['outcome'] as const,
    registers: [registry],
  }),
  rateLimitStoreErrors: new Counter({
    name: 'rabit_rate_limit_store_errors_total',
    help: 'Requests let through because the shared rate-limit store failed (fail-open)',
    registers: [registry],
  }),
  sessionsRevoked: new Counter({
    name: 'rabit_playback_sessions_revoked_total',
    help: 'Playback sessions revoked',
    labelNames: ['reason'] as const,
    registers: [registry],
  }),
};

/**
 * Queue health gauges, sampled on scrape (worker metrics endpoint): jobs per
 * status, and per job kind the ready count and the age of the oldest ready job.
 */
export function registerQueueMetrics(
  sample: () => Promise<{
    byStatus: Record<string, number>;
    byKind: Record<string, { ready: number; oldestSeconds: number }>;
    outboxPending: number;
  }>,
): void {
  let last: Awaited<ReturnType<typeof sample>> | null = null;
  const refresh = async () => {
    last = await sample();
  };
  new Gauge({
    name: 'rabit_jobs',
    help: 'Jobs by status',
    labelNames: ['status'] as const,
    registers: [registry],
    async collect() {
      await refresh();
      for (const [status, n] of Object.entries(last?.byStatus ?? {})) this.set({ status }, n);
    },
  });
  new Gauge({
    name: 'rabit_jobs_ready',
    help: 'Jobs ready to run, by kind',
    labelNames: ['kind'] as const,
    registers: [registry],
    collect() {
      this.reset();
      for (const [kind, k] of Object.entries(last?.byKind ?? {})) this.set({ kind }, k.ready);
    },
  });
  new Gauge({
    name: 'rabit_job_oldest_queued_seconds',
    help: 'Age of the oldest job ready to run, by kind',
    labelNames: ['kind'] as const,
    registers: [registry],
    collect() {
      this.reset();
      for (const [kind, k] of Object.entries(last?.byKind ?? {}))
        this.set({ kind }, k.oldestSeconds);
    },
  });
  new Gauge({
    name: 'rabit_outbox_pending',
    help: 'Outbox events not yet dispatched',
    registers: [registry],
    collect() {
      this.set(last?.outboxPending ?? 0);
    },
  });
}

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
