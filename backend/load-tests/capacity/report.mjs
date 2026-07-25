function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function resultFor(entry, results) {
  if (entry.inheritsCapacityFrom && results[entry.inheritsCapacityFrom]) {
    const canonical = results[entry.inheritsCapacityFrom]
    return {
      ...canonical,
      status: 'inherited_from_canonical',
      samples: [],
    }
  }
  return results[entry.id] || {
    status: entry.eligible ? 'not_run' : entry.executionClass,
    lastPassingVus: null,
    firstFailingVus: null,
    capacityLabel: '',
    achievedRpsAtSafeConcurrency: null,
    p95MsAtSafeConcurrency: null,
    p99MsAtSafeConcurrency: null,
    samples: [],
  }
}

export function buildCapacityReport({ run, config, manifest, results }) {
  const endpoints = manifest.map(entry => {
    const result = resultFor(entry, results)
    return {
      ...entry,
      resultStatus: result.status,
      lastPassingVus: result.lastPassingVus,
      firstFailingVus: result.firstFailingVus,
      capacityLabel: result.capacityLabel,
      achievedRpsAtSafeConcurrency: result.achievedRpsAtSafeConcurrency,
      p95MsAtSafeConcurrency: result.p95MsAtSafeConcurrency,
      p99MsAtSafeConcurrency: result.p99MsAtSafeConcurrency,
      sampleCount: result.samples?.length || 0,
      samples: result.samples || [],
    }
  })
  const executed = endpoints.filter(entry => ['capacity_found', 'censored_at_cap', 'no_passing_concurrency'].includes(entry.resultStatus))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run,
    config,
    summary: {
      mandatoryEndpoints: endpoints.length,
      eligibleEndpoints: endpoints.filter(entry => entry.eligible).length,
      executedEndpoints: executed.length,
      exactCapacityFound: executed.filter(entry => entry.resultStatus === 'capacity_found').length,
      censoredAtCap: executed.filter(entry => entry.resultStatus === 'censored_at_cap').length,
      noPassingConcurrency: executed.filter(entry => entry.resultStatus === 'no_passing_concurrency').length,
      notExecuted: endpoints.length - executed.length,
    },
    endpoints,
    chartData: executed.map(entry => ({
      id: entry.id,
      family: entry.family,
      lastPassingVus: entry.lastPassingVus,
      firstFailingVus: entry.firstFailingVus,
      capacityLabel: entry.capacityLabel,
      achievedRps: entry.achievedRpsAtSafeConcurrency,
      censored: entry.resultStatus === 'censored_at_cap',
    })),
  }
}

export function renderCsv(report) {
  const fields = [
    'id', 'canonicalId', 'scope', 'family', 'evidenceClass', 'executionClass',
    'resultStatus', 'capacityLabel', 'lastPassingVus', 'firstFailingVus',
    'achievedRpsAtSafeConcurrency', 'p95MsAtSafeConcurrency', 'p99MsAtSafeConcurrency',
    'sampleCount', 'inheritsCapacityFrom', 'reason',
  ]
  return [
    fields.join(','),
    ...report.endpoints.map(endpoint => fields.map(field => csvCell(endpoint[field])).join(',')),
    '',
  ].join('\n')
}

export function renderMarkdown(report) {
  const lines = [
    '# VitaLink per-endpoint capacity report',
    '',
    `- Run ID: \`${report.run.id}\``,
    `- Target host: \`${report.run.targetHost}\``,
    `- Endpoint inventory: **${report.summary.mandatoryEndpoints} mandatory endpoints**`,
    `- Capacity-tested: **${report.summary.executedEndpoints}**`,
    `- Censored at configured ceiling: **${report.summary.censoredAtCap}**`,
    `- Not independently capacity-tested: **${report.summary.notExecuted}**`,
    '',
    '> A value such as `>=100` is right-censored: the endpoint passed at the configured ceiling, so its actual maximum was not discovered.',
    '',
    '## Endpoint capacity matrix',
    '',
    '| Endpoint | Evidence | Result | Safe concurrent VUs | First failing VUs | Achieved RPS |',
    '|---|---|---|---:|---:|---:|',
  ]
  for (const endpoint of report.endpoints) {
    const id = endpoint.id.replaceAll('|', '\\|')
    const achievedRps = Number.isFinite(endpoint.achievedRpsAtSafeConcurrency)
      ? endpoint.achievedRpsAtSafeConcurrency.toFixed(2)
      : '—'
    lines.push(`| \`${id}\` | ${endpoint.evidenceClass} | ${endpoint.resultStatus} | ${endpoint.capacityLabel || '—'} | ${endpoint.firstFailingVus ?? '—'} | ${achievedRps} |`)
  }
  lines.push(
    '',
    '## Interpretation boundaries',
    '',
    '- Valid mutation and upload capacity is not claimed while durable dynamic cleanup is unavailable.',
    '- Legacy aliases inherit canonical-handler capacity and are not independently saturated.',
    '- Isolated endpoint maxima cannot be added together; a mixed-workload capacity test is a separate result.',
    '- Results apply only to the recorded environment, build, data volume, thresholds, and configured ceiling.',
    '',
  )
  return lines.join('\n')
}

export function renderHtml(report) {
  const chartRows = report.chartData
    .sort((left, right) => (right.lastPassingVus || 0) - (left.lastPassingVus || 0))
    .map(entry => {
      const width = report.config.cap ? Math.min(100, (entry.lastPassingVus / report.config.cap) * 100) : 0
      return `<div class="bar-row"><div class="bar-label" title="${escapeHtml(entry.id)}">${escapeHtml(entry.id)}</div><div class="bar-track"><div class="bar" style="width:${width}%"></div></div><div class="bar-value">${escapeHtml(entry.capacityLabel)} VUs · ${Number(entry.achievedRps || 0).toFixed(1)} RPS</div></div>`
    }).join('\n')
  const tableRows = report.endpoints.map(endpoint => `<tr>
<td><code>${escapeHtml(endpoint.id)}</code></td><td>${escapeHtml(endpoint.evidenceClass)}</td>
<td><span class="status ${escapeHtml(endpoint.resultStatus)}">${escapeHtml(endpoint.resultStatus)}</span></td>
<td>${escapeHtml(endpoint.capacityLabel || '—')}</td><td>${escapeHtml(endpoint.firstFailingVus ?? '—')}</td>
<td>${Number.isFinite(endpoint.achievedRpsAtSafeConcurrency) ? endpoint.achievedRpsAtSafeConcurrency.toFixed(2) : '—'}</td>
</tr>`).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VitaLink endpoint capacity</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui;color:#172033;background:#f3f6fb}body{margin:0;padding:32px}.wrap{max-width:1500px;margin:auto}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card,.panel{background:white;border:1px solid #dfe5ef;border-radius:12px;padding:18px;box-shadow:0 2px 8px #18243b0a}.card strong{display:block;font-size:28px;color:#176b87}.panel{margin-top:18px;overflow:auto}.bar-row{display:grid;grid-template-columns:minmax(260px,2fr) minmax(180px,3fr) 150px;gap:10px;align-items:center;margin:8px 0;font-size:12px}.bar-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar-track{height:12px;background:#e8edf5;border-radius:10px;overflow:hidden}.bar{height:100%;background:linear-gradient(90deg,#1b829f,#42b883)}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #e6ebf2;white-space:nowrap}th{position:sticky;top:0;background:#f8fafc}.status{padding:3px 7px;border-radius:10px;background:#eef2f7}.censored_at_cap{background:#fff1c7}.capacity_found{background:#d9f7e8}.no_passing_concurrency{background:#ffe0e0}.note{color:#56627a;max-width:900px}
</style></head><body><main class="wrap">
<h1>VitaLink per-endpoint virtual-user capacity</h1>
<p class="note">Run <code>${escapeHtml(report.run.id)}</code> against <code>${escapeHtml(report.run.targetHost)}</code>. “≥ cap” is a censored lower bound, not an exact maximum. Valid mutation and upload capacity is not claimed without durable cleanup.</p>
<section class="cards"><div class="card"><strong>${report.summary.mandatoryEndpoints}</strong>mandatory endpoints</div><div class="card"><strong>${report.summary.executedEndpoints}</strong>capacity-tested</div><div class="card"><strong>${report.summary.exactCapacityFound}</strong>exact breakpoints</div><div class="card"><strong>${report.summary.censoredAtCap}</strong>passed at ceiling</div></section>
<section class="panel"><h2>Safe concurrent VUs and achieved RPS</h2>${chartRows || '<p>No capacity results yet.</p>'}</section>
<section class="panel"><h2>Complete endpoint matrix</h2><table><thead><tr><th>Endpoint</th><th>Evidence</th><th>Result</th><th>Safe VUs</th><th>First fail</th><th>RPS</th></tr></thead><tbody>${tableRows}</tbody></table></section>
</main></body></html>`
}
