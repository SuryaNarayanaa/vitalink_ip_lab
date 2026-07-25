import http from 'k6/http';
import { assertEnvironmentFingerprint } from './guards.js';

function header(response, name) {
  const headers = response && response.headers ? response.headers : {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : '';
}

export function verifyTargetIdentity(guard) {
  const response = http.get(`${guard.baseUrl}/health/ready`, {
    redirects: 0,
    tags: { name: 'LOAD TEST IDENTITY PREFLIGHT', scenario: 'safety_preflight' },
  });
  if (![200, 503].includes(response.status)) {
    throw new Error(`Load-test identity preflight returned ${response.status}`);
  }
  assertEnvironmentFingerprint(
    guard.fingerprint,
    header(response, 'X-Load-Test-Environment-Fingerprint'),
    guard.runId,
    header(response, 'X-Load-Test-Run-Id'),
  );
  return true;
}
