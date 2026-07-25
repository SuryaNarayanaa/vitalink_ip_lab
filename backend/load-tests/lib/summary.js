import { redactSecrets, safeJson } from './redaction.js';

function safeSegment(value, fallback) {
  const segment = String(value || fallback).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100);
  return segment || fallback;
}

function thresholdOutcome(metric) {
  const thresholds = metric && metric.thresholds ? metric.thresholds : {};
  const names = Object.keys(thresholds);
  if (names.length === 0) return 'not_configured';
  return names.every((name) => thresholds[name] && thresholds[name].ok === true) ? 'passed' : 'failed';
}

function metricRows(data) {
  return Object.keys((data && data.metrics) || {}).sort().map((name) => {
    const metric = data.metrics[name] || {};
    return {
      name,
      type: metric.type || 'unknown',
      contains: metric.contains || 'unknown',
      values: metric.values || {},
      thresholdOutcome: thresholdOutcome(metric),
    };
  });
}

export function buildPortableSummary(data, metadata = {}) {
  const rows = metricRows(data);
  const failedThresholds = rows.filter((row) => row.thresholdOutcome === 'failed').map((row) => row.name);
  return redactSecrets({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run: {
      id: metadata.runId || 'unknown',
      profile: metadata.profile || 'unknown',
      targetHost: metadata.targetHost || 'unknown',
      gitSha: metadata.gitSha || 'unknown',
      interrupted: metadata.interrupted === true,
      cleanupStatus: metadata.cleanupStatus || 'pending_external_reconciliation',
    },
    status: failedThresholds.length === 0 && metadata.interrupted !== true ? 'thresholds_passed' : 'incomplete_or_failed',
    failedThresholds,
    metrics: rows,
  });
}

function valueText(values) {
  const preferred = ['count', 'rate', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
  const entries = preferred.filter((key) => values[key] !== undefined).map((key) => `${key}=${Number(values[key]).toFixed(3)}`);
  return entries.length ? entries.join(', ') : 'no aggregate values';
}

export function renderMarkdownSummary(summary) {
  const run = summary.run;
  const lines = [
    '# VitaLink load-test summary',
    '',
    `- Run ID: \`${run.id}\``,
    `- Profile: \`${run.profile}\``,
    `- Target host: \`${run.targetHost}\``,
    `- Git SHA: \`${run.gitSha}\``,
    `- Result: **${summary.status}**`,
    `- Cleanup: **${run.cleanupStatus}**`,
    '',
    '## Threshold failures',
    '',
    summary.failedThresholds.length ? summary.failedThresholds.map((name) => `- \`${name}\``).join('\n') : 'None reported by k6.',
    '',
    '## Aggregate metrics',
    '',
    '| Metric | Threshold | Values |',
    '|---|---:|---|',
  ];
  summary.metrics.forEach((metric) => {
    const safeName = String(metric.name).replace(/\|/g, '\\|');
    lines.push(`| \`${safeName}\` | ${metric.thresholdOutcome} | ${valueText(metric.values)} |`);
  });
  lines.push('', '> This is the harness-level summary. Endpoint coverage and cleanup are complete only after the external reconciler and report merger succeed.', '');
  return lines.join('\n');
}

/**
 * Creates a k6 handleSummary callback. The caller must create outputDir before
 * the run; k6 does not create nested directories for custom summary outputs.
 */
export function makeHandleSummary(metadata = {}) {
  const outputDir = String(metadata.outputDir || 'load-tests/reports').replace(/[\\/]$/, '');
  const runId = safeSegment(metadata.runId, 'unknown-run');
  const profile = safeSegment(metadata.profile, 'unknown-profile');
  const runDir = `${outputDir}/${runId}-${profile}`;

  return function handleSummary(data) {
    const summary = buildPortableSummary(data, metadata);
    const markdown = renderMarkdownSummary(summary);
    return {
      stdout: `VitaLink load test ${runId}/${profile}: ${summary.status}; cleanup=${summary.run.cleanupStatus}\n`,
      [`${runDir}/summary.json`]: `${safeJson(summary)}\n`,
      [`${runDir}/report.md`]: markdown,
      [`${runDir}/raw-k6-summary.json`]: `${safeJson(data)}\n`,
    };
  };
}

