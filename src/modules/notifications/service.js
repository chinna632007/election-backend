'use strict';

/**
 * Notification service — builds per-member messages, dispatches via configured
 * providers, records delivery attempts, and reports per-channel results.
 *
 * - Preview (no send): renders every recipient's message for authorised review.
 * - Send: dispatches only to CONFIGURED channels; an unconfigured channel is
 *   reported as unavailable, never faked, never silently skipped as success.
 * - Retries: transient failures (429/5xx/network) are retried up to
 *   `maxAttempts`; permanent failures (other 4xx) are not. A recipient+channel
 *   already recorded as delivered in this run is not re-sent (no duplicates).
 * - Delivery records are kept in an in-memory store for now; the durable
 *   schema (notification_delivery_attempts) is a prepared, unapplied migration.
 */

const { buildNotification, smsSegments } = require('./templates');
const { isTransient } = require('./providers');

function createNotificationService(deps) {
  deps = deps || {};
  const providers = deps.providers || [];
  const maxAttempts = deps.maxAttempts || 2;
  const now = deps.now || function () { return new Date(); };
  // In-memory delivery log; replace with a DB-backed store when the migration
  // is applied.
  const deliveries = deps.store || [];

  function channelStatus() {
    return providers.map(function (p) {
      const s = p.status();
      return { channel: p.channel, provider: p.name, configured: s.configured, missing: s.missing };
    });
  }

  /**
   * Build a preview of every recipient's message across all channels.
   * No provider is called. Recipients need a contact point per channel; the
   * preview shows which channels are available/unconfigured.
   */
  function preview(input) {
    const recipients = (input && input.recipients) || [];
    const party = input && input.party;
    const station = input && input.station;
    const election = (input && input.election) || {};
    const config = (input && input.config) || {};
    const status = channelStatus();

    const rendered = recipients.map(function (r) {
      const notice = buildNotification({
        recipient: r, party: party, station: station, election: election, config: config,
      });
      const channels = {};
      status.forEach(function (c) {
        // SMS + WhatsApp both route to the officer's mobile number.
        const hasDestination = !!r.mobile;
        channels[c.channel] = {
          configured: c.configured,
          destinationAvailable: !!hasDestination,
          smsSegments: c.channel === 'sms' ? smsSegments(notice.sms) : undefined,
        };
      });
      return {
        personnelId: r.personnelId,
        name: r.name,
        role: r.role,
        isMicroObserver: !!r.isMicroObserver,
        subject: notice.subject,
        message: notice.text,
        channels: channels,
      };
    });

    return {
      channelStatus: status,
      election: election,
      recipients: rendered,
    };
  }

  /** Destination lookup for a recipient on a channel (never logged). */
  function destinationFor(recipient, channel) {
    // SMS + WhatsApp both route to the officer's mobile number.
    if (channel === 'sms' || channel === 'whatsapp') return recipient.mobile || null;
    return null;
  }

  /**
   * Dispatch to all configured channels for every recipient.
   * Records one delivery row per recipient+channel attempt.
   *
   * @param {object} input  { recipients, party, station, election, config, dryRun }
   * @returns per-channel summary + the delivery records written this run.
   */
  async function send(input) {
    const recipients = (input && input.recipients) || [];
    const party = input && input.party;
    const station = input && input.station;
    const election = (input && input.election) || {};
    const config = (input && input.config) || {};
    const dryRun = !!(input && input.dryRun);

    const summary = { total: recipients.length, byChannel: {}, sent: 0, failed: 0, skipped: 0 };
    const written = [];

    for (const r of recipients) {
      const notice = buildNotification({
        recipient: r, party: party, station: station, election: election, config: config,
      });

      for (const provider of providers) {
        const channel = provider.channel;
        summary.byChannel[channel] = summary.byChannel[channel] ||
          { attempted: 0, delivered: 0, failed: 0, unavailable: 0 };

        // Unconfigured provider -> report unavailable, never fake a send.
        if (!provider.isConfigured()) {
          summary.byChannel[channel].unavailable += 1;
          summary.skipped += 1;
          written.push(record(deliveryRow(r, channel, provider.name, 'unavailable',
            'Provider not configured', null)));
          continue;
        }

        const to = destinationFor(r, channel);
        if (!to) {
          summary.byChannel[channel].unavailable += 1;
          summary.skipped += 1;
          written.push(record(deliveryRow(r, channel, provider.name, 'no_destination',
            'Recipient has no ' + channel + ' destination', null)));
          continue;
        }

        // Dry run: report what would be sent without contacting the provider.
        if (dryRun) {
          summary.byChannel[channel].attempted += 1;
          written.push(record(deliveryRow(r, channel, provider.name, 'dry_run',
            'Dry run; provider not contacted', null)));
          continue;
        }

        // Already delivered to this recipient+channel earlier in this run?
        const already = deliveries.find(function (d) {
          return String(d.personnelId) === String(r.personnelId) &&
            d.channel === channel && d.status === 'delivered';
        });
        if (already) {
          summary.skipped += 1;
          continue; // idempotent: never duplicate a delivered message
        }

        const outcome = await dispatchWithRetry(provider, r, channel, to, notice);
        summary.byChannel[channel].attempted += 1;
        if (outcome.status === 'delivered') {
          summary.byChannel[channel].delivered += 1;
          summary.sent += 1;
        } else {
          summary.byChannel[channel].failed += 1;
          summary.failed += 1;
        }
        written.push(record(outcome.row));
      }
    }

    return { summary: summary, deliveries: written };
  }

  /** Attempt a provider send with bounded retry on transient failures only. */
  async function dispatchWithRetry(provider, r, channel, to, notice) {
    let attempt = 0;
    let lastErr = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const result = await provider.send({
          to: to,
          message: notice.sms,
          subject: notice.subject,
        });
        return { status: 'delivered', row: deliveryRow(r, channel, provider.name, 'delivered',
          null, result && result.providerMessageId, attempt) };
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt >= maxAttempts) break;
      }
    }
    const msg = (lastErr && lastErr.message) || 'send failed';
    return { status: 'failed', row: deliveryRow(r, channel, provider.name, 'failed', msg, null,
      attempt) };
  }

  function deliveryRow(r, channel, providerName, status, error, providerMessageId, attempts) {
    return {
      personnelId: r.personnelId,
      name: r.name,
      role: r.role,
      channel: channel,
      provider: providerName,
      status: status,
      error: error || null,
      providerMessageId: providerMessageId || null,
      attempts: attempts || 0,
      at: now().toISOString(),
    };
  }

  function record(row) {
    deliveries.push(row);
    return row;
  }

  return { preview, send, channelStatus, deliveries };
}

module.exports = { createNotificationService };

