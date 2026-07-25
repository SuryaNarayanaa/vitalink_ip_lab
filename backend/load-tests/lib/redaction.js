const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|ticket|otp|totp|api[-_]?key|session|credential|signature)/i;
const INLINE_SECRET = /((?:authorization|password|secret|token|ticket|otp|totp|api[-_]?key|signature)\s*[=:]\s*)([^\s,;"']+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const QUERY_SECRET = /([?&](?:access_token|refresh_token|token|ticket|otp|code|signature)=)[^&#\s]*/gi;

export const REDACTED = '[REDACTED]';

export function redactString(value) {
  return String(value)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(QUERY_SECRET, `$1${REDACTED}`)
    .replace(INLINE_SECRET, `$1${REDACTED}`);
}

export function redactSecrets(value, seen = []) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (seen.includes(value)) return '[CIRCULAR]';
  seen.push(value);

  if (Array.isArray(value)) {
    const output = value.map((item) => redactSecrets(item, seen));
    seen.pop();
    return output;
  }

  const output = {};
  Object.keys(value).forEach((key) => {
    output[key] = SECRET_KEY.test(key) ? REDACTED : redactSecrets(value[key], seen);
  });
  seen.pop();
  return output;
}

export function safeJson(value, spacing = 2) {
  return JSON.stringify(redactSecrets(value), null, spacing);
}

