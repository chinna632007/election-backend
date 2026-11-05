-- 015_training_member_stage3: carry Stage-3 duty station + ballot (venue) code
-- on training batch members (and orders) so generated training orders reflect
-- the officer's real Stage-3 allotment:
--   station_mandal -> duty_mandal
--   station_code   -> venue_code  (ballot / polling-station ID)
-- rather than only the Stage-2 posting mandal. Training allocation writes
-- these on the member rows; generateOrders reads them back into the order.

ALTER TABLE po_training_batch_members
  ADD COLUMN IF NOT EXISTS duty_mandal TEXT,
  ADD COLUMN IF NOT EXISTS venue_code TEXT;

ALTER TABLE apo_training_batch_members
  ADD COLUMN IF NOT EXISTS duty_mandal TEXT,
  ADD COLUMN IF NOT EXISTS venue_code TEXT;

ALTER TABLE po_training_orders
  ADD COLUMN IF NOT EXISTS venue_code TEXT;

ALTER TABLE apo_training_orders
  ADD COLUMN IF NOT EXISTS venue_code TEXT;
