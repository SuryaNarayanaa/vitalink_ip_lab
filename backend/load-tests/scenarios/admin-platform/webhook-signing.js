import crypto from 'k6/crypto';

export function paymentWebhookMaterial(parts) {
  const required = ['session_id', 'invoice_number', 'amount', 'currency', 'provider_event_id', 'timestamp'];
  required.forEach((key) => {
    if (parts[key] === undefined || parts[key] === null || String(parts[key]).trim() === '') {
      throw new Error(`Payment webhook signing requires ${key}`);
    }
  });
  const amount = Number(parts.amount);
  const timestamp = Number(parts.timestamp);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment webhook amount must be positive');
  if (!Number.isFinite(timestamp)) throw new Error('Payment webhook timestamp must be numeric');
  return [
    String(parts.session_id),
    String(parts.invoice_number),
    String(amount),
    String(parts.currency).toUpperCase(),
    String(parts.provider_event_id),
    String(timestamp),
  ].join('.');
}

/** Build the exact provider callback body without exposing the shared secret. */
export function signPaymentWebhook(secret, parts, options = {}) {
  if (!secret || !String(secret).trim()) throw new Error('Payment webhook sandbox secret is required');
  const timestamp = parts.timestamp === undefined || parts.timestamp === null
    ? (options.now === undefined ? Date.now() : Number(options.now))
    : Number(parts.timestamp);
  const body = {
    session_id: String(parts.session_id || ''),
    invoice_number: String(parts.invoice_number || ''),
    amount: Number(parts.amount),
    currency: String(parts.currency || 'INR').toUpperCase(),
    provider_event_id: String(parts.provider_event_id || ''),
    timestamp,
  };
  body.signature = crypto.hmac('sha256', String(secret), paymentWebhookMaterial(body), 'hex');
  return body;
}

