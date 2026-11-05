'use strict';

/**
 * Notification provider adapters — Fast2SMS (SMS) and Meta WhatsApp Cloud API.
 *
 * Contract (every provider):
 *   isConfigured()            -> boolean
 *   status()                  -> { configured, missing:[...] } (never secrets)
 *   send({ to, message, subject }) -> Promise<{ providerMessageId }> (throws)
 *
 * - Credentials come from environment variables only; NEVER hardcoded, NEVER
 *   logged. `status()` lists which env vars are missing, not their values.
 * - Each adapter accepts an injectable `httpClient` for tests so no live paid
 *   API call is ever made during development/testing.
 * - A provider that is not configured FAILS CLEARLY — it never silently falls
 *   back or fakes success.
 */

class NotificationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotificationConfigError';
    this.code = 'NOTIFICATION_NOT_CONFIGURED';
    this.statusCode = 422;
  }
}

/** Transient vs permanent classification for safe retry decisions. */
function isTransient(err) {
  if (!err) return false;
  if (err.transient === true) return true;
  const s = err.statusCode || (err.response && err.response.status);
  return s === 429 || (typeof s === 'number' && s >= 500);
}

/** Default HTTP POST returning { ok, status, data } (injectable in tests). */
async function defaultHttpPost(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data: data };
}

// --- Fast2SMS (SMS) ---------------------------------------------------------
function createFast2smsProvider(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const apiKey = env.FAST2SMS_API_KEY;
  const senderId = env.FAST2SMS_SENDER_ID || 'FSTSMS';
  const route = env.FAST2SMS_ROUTE || 'q';
  const httpClient = opts.httpClient || defaultHttpPost;

  function isConfigured() { return !!apiKey; }
  function status() {
    return { configured: !!apiKey, missing: apiKey ? [] : ['FAST2SMS_API_KEY'] };
  }

  async function send(input) {
    if (!isConfigured()) {
      throw new NotificationConfigError('Fast2SMS is not configured (FAST2SMS_API_KEY missing).');
    }
    const body = {
      route: route,
      numbers: String(input.to),
      message: input.message,
      sender_id: senderId,
    };
    const res = await httpClient('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error('Fast2SMS send failed (HTTP ' + res.status + ')');
      err.statusCode = res.status;
      err.transient = res.status === 429 || res.status >= 500;
      throw err;
    }
    const data = res.data || {};
    return { providerMessageId: data.request_id || data.message_id || null, provider: 'fast2sms' };
  }

  return { name: 'fast2sms', channel: 'sms', isConfigured, status, send };
}

// --- Meta WhatsApp Business Cloud API --------------------------------------
function createWhatsAppProvider(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = env.WHATSAPP_API_VERSION || 'v20.0';
  const httpClient = opts.httpClient || defaultHttpPost;

  function isConfigured() { return !!(token && phoneNumberId); }
  function status() {
    const missing = [];
    if (!token) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    return { configured: isConfigured(), missing: missing };
  }

  async function send(input) {
    if (!isConfigured()) {
      throw new NotificationConfigError(
        'WhatsApp is not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing).'
      );
    }
    const url = 'https://graph.facebook.com/' + apiVersion + '/' + phoneNumberId + '/messages';
    const body = {
      messaging_product: 'whatsapp',
      to: String(input.to),
      type: 'text',
      text: { body: input.message },
    };
    const res = await httpClient(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error('WhatsApp send failed (HTTP ' + res.status + ')');
      err.statusCode = res.status;
      err.transient = res.status === 429 || res.status >= 500;
      throw err;
    }
    const data = res.data || {};
    const msg = (data.messages && data.messages[0]) || {};
    return { providerMessageId: msg.id || null, provider: 'whatsapp' };
  }

  return { name: 'whatsapp', channel: 'whatsapp', isConfigured, status, send };
}

module.exports = {
  NotificationConfigError: NotificationConfigError,
  isTransient: isTransient,
  createFast2smsProvider: createFast2smsProvider,
  createWhatsAppProvider: createWhatsAppProvider,
};

