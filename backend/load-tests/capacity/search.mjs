function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

export function normalizeSteps(values, cap) {
  if (!Number.isInteger(cap) || cap < 1) throw new Error('Capacity cap must be a positive whole number')
  const parsed = values.map(Number)
  if (parsed.some(value => !Number.isInteger(value) || value < 1)) {
    throw new Error('Capacity staircase values must be positive whole numbers')
  }
  const bounded = uniqueSorted(parsed.filter(value => value <= cap))
  if (!bounded.length || bounded[0] !== 1) bounded.unshift(1)
  if (bounded[bounded.length - 1] !== cap) bounded.push(cap)
  return uniqueSorted(bounded)
}

function highestPassingBelow(samples, ceiling) {
  const failed = new Set(samples.filter(sample => sample.passed === false).map(sample => sample.vus))
  const passing = samples
    .filter(sample => sample.passed === true && sample.vus < ceiling && !failed.has(sample.vus))
    .map(sample => sample.vus)
  return passing.length ? Math.max(...passing) : 0
}

function minimumFailure(samples) {
  const failures = samples.filter(sample => sample.passed === false).map(sample => sample.vus)
  return failures.length ? Math.min(...failures) : null
}

/**
 * Closed-model capacity discovery. runStep must resolve to a result containing
 * at least { passed, vus }; every invocation is endpoint-isolated.
 */
export async function discoverCapacity(options) {
  const cap = options.cap
  const steps = normalizeSteps(options.steps, cap)
  const confirmations = options.confirmations ?? 3
  const maxRefinements = options.maxRefinements ?? 16
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 10) {
    throw new Error('Capacity confirmations must be a whole number from 1 to 10')
  }
  if (!Number.isInteger(maxRefinements) || maxRefinements < 0 || maxRefinements > 32) {
    throw new Error('Capacity maxRefinements must be a whole number from 0 to 32')
  }

  const samples = Array.isArray(options.existingSamples) ? [...options.existingSamples] : []
  const invoke = async (vus, phase, attempt = 1) => {
    const result = await options.runStep({ vus, phase, attempt })
    const sample = { ...result, vus, phase, attempt }
    samples.push(sample)
    if (options.onSample) await options.onSample(sample, samples)
    return sample
  }

  if (!samples.some(sample => sample.phase === 'warmup') && options.warmup !== false) {
    await invoke(Math.min(options.warmupVus || 1, cap), 'warmup')
  }

  let firstFail = minimumFailure(samples.filter(sample => sample.phase !== 'warmup'))
  let lastPass = highestPassingBelow(samples.filter(sample => sample.phase !== 'warmup'), firstFail ?? cap + 1)

  for (const vus of steps) {
    if (firstFail !== null || samples.some(sample => sample.phase === 'staircase' && sample.vus === vus)) continue
    const sample = await invoke(vus, 'staircase')
    if (sample.passed) lastPass = Math.max(lastPass, vus)
    else firstFail = vus
  }

  const refine = async () => {
    if (firstFail === null) return
    let refinements = 0
    while (firstFail - lastPass > 1 && refinements < maxRefinements) {
      const midpoint = Math.floor((lastPass + firstFail) / 2)
      const prior = samples.find(sample => sample.phase === 'binary' && sample.vus === midpoint)
      const sample = prior || await invoke(midpoint, 'binary')
      if (sample.passed) lastPass = midpoint
      else firstFail = midpoint
      refinements += 1
    }
  }
  await refine()

  let candidate = firstFail === null ? cap : lastPass
  let confirmed = false
  while (candidate > 0 && !confirmed) {
    const outcomes = []
    for (let attempt = 1; attempt <= confirmations; attempt += 1) {
      const prior = samples.find(sample =>
        sample.phase === 'confirmation' && sample.vus === candidate && sample.attempt === attempt)
      outcomes.push(prior || await invoke(candidate, 'confirmation', attempt))
    }
    confirmed = outcomes.every(sample => sample.passed)
    if (!confirmed) {
      firstFail = Math.min(firstFail ?? candidate, candidate)
      lastPass = highestPassingBelow(samples.filter(sample => sample.phase !== 'warmup'), candidate)
      await refine()
      candidate = lastPass
    }
  }

  const safeSamples = samples.filter(sample =>
    sample.vus === candidate && sample.passed === true && sample.phase === 'confirmation')
  const achievedRps = safeSamples.length
    ? Math.min(...safeSamples.map(sample => Number(sample.achievedRps || 0)))
    : null
  const p95Ms = safeSamples.length
    ? Math.max(...safeSamples.map(sample => Number(sample.p95Ms || 0)))
    : null
  const p99Ms = safeSamples.length
    ? Math.max(...safeSamples.map(sample => Number(sample.p99Ms || 0)))
    : null

  return {
    status: candidate === 0
      ? 'no_passing_concurrency'
      : firstFail === null && candidate === cap
        ? 'censored_at_cap'
        : 'capacity_found',
    lastPassingVus: candidate,
    firstFailingVus: firstFail,
    capacityLabel: candidate === 0 ? 'none' : firstFail === null && candidate === cap ? `>=${cap}` : String(candidate),
    achievedRpsAtSafeConcurrency: achievedRps,
    p95MsAtSafeConcurrency: p95Ms,
    p99MsAtSafeConcurrency: p99Ms,
    cap,
    confirmations,
    samples,
  }
}
