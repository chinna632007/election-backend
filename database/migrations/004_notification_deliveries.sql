-- 004_notification_deliveries: durable log of notification send attempts.
--
-- PREPARED ONLY — NOT APPLIED (requires separate approval). The notification
-- service currently uses an in-memory store with exactly this row shape, so
-- adopting the table later is a drop-in swap of the store adapter.
--
-- Each row records ONE delivery attempt for ONE recipient on ONE channel.
-- The (run_id, personnel_id, channel, attempt_no) grain makes retries
-- auditable and idempotent: a (run, recipient, channel) already marked
-- 'delivered' is never re-sent by the service.
--
-- Privacy: destinations (phone/email) are NOT stored; records carry only
-- personnel id + name + role + channel + provider-side message id.

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Which allocation run triggered the send (in-memory run id for now):
  run_ref TEXT,

  -- Recipient identity (non-sensitive only):
  personnel_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_micro_observer BOOLEAN NOT NULL DEFAULT FALSE,

  -- Channel + provider:
  channel TEXT NOT NULL,             -- 'sms' | 'whatsapp' | 'email'
  provider TEXT NOT NULL,            -- 'fast2sms' | 'whatsapp' | 'gmail'

  -- Outcome:
  status TEXT NOT NULL,              -- 'delivered' | 'failed' | 'unavailable' |
                                     -- 'no_destination' | 'dry_run'
  error TEXT,                        -- provider/config error (never credentials)
  provider_message_id TEXT,          -- provider-side message reference
  attempts INTEGER NOT NULL DEFAULT 1,

  -- Who confirmed the send that produced this attempt:
  sent_by_user_id INTEGER,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_run_recipient
  ON notification_delivery_attempts (run_ref, personnel_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_status
  ON notification_delivery_attempts (status);
