import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { registerQueueMetrics, registry } from '../src/platform/metrics.js';

/**
 * Alert rules (R8) must reference metrics and labels the services export, and
 * runbook sections that exist; a renamed metric would otherwise silence an alert.
 * Expression syntax and firing behaviour are checked by promtool in CI.
 */
const root = new URL('../../../', import.meta.url);
const rules = (
  parse(readFileSync(new URL('infra/observability/alerts.yml', root), 'utf8')) as {
    groups: { rules: { alert: string; expr: string; annotations: Record<string, string> }[] }[];
  }
).groups.flatMap((g) => g.rules);
const runbook = readFileSync(new URL('docs/09-operations/runbooks.md', root), 'utf8');

registerQueueMetrics(() =>
  Promise.resolve({ byStatus: {}, oldestQueuedSeconds: 0, outboxPending: 0 }),
);
const SUFFIXES = ['_bucket', '_count', '_sum'];
function labelsOf(series: string): string[] | null {
  const direct = registry.getSingleMetric(series);
  const base = SUFFIXES.map((s) => (series.endsWith(s) ? series.slice(0, -s.length) : null)).find(
    (b) => b && registry.getSingleMetric(b),
  );
  const m = direct ?? (base ? registry.getSingleMetric(base) : undefined);
  if (!m) return null;
  const names = (m as unknown as { labelNames: string[] }).labelNames;
  return series.endsWith('_bucket') ? [...names, 'le'] : names;
}

describe('alert rules (R8)', () => {
  it.each(rules.map((r) => [r.alert, r] as const))('%s uses exported metrics', (_, rule) => {
    const selectors = [...rule.expr.matchAll(/\b(rabit_\w+)(?:\{([^}]*)\})?/g)];
    expect(selectors.length).toBeGreaterThan(0);
    for (const [, name, matchers] of selectors) {
      const labels = labelsOf(name!);
      expect(labels, `${name} is not exported`).not.toBeNull();
      for (const [, label] of (matchers ?? '').matchAll(/(\w+)\s*[=!~]+/g)) {
        expect(labels, `${name} has no label ${label}`).toContain(label);
      }
    }
    for (const [, label] of rule.expr.matchAll(/by \((\w+)\)/g)) {
      expect(['le']).toContain(label);
    }
  });

  it.each(rules.map((r) => [r.alert, r] as const))('%s links a runbook section', (_, rule) => {
    expect(rule.annotations['impact']).toBeTruthy();
    const anchor = /runbooks\.md#([\w-]+)$/.exec(rule.annotations['runbook'] ?? '')?.[1];
    expect(anchor).toBeTruthy();
    expect(runbook).toMatch(new RegExp(`^## ${anchor}$`, 'm'));
  });
});
