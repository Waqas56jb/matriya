-- =============================================================================
-- Phone number whitelist for WhatsApp inbound access control
-- Run once in Supabase SQL Editor.
-- David can add/remove numbers directly from this table — no redeploy needed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_whitelist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT        NOT NULL UNIQUE,   -- e.g. whatsapp:+972544568078
  label       TEXT        NULL,              -- human-readable name (optional)
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed David's number as always approved
INSERT INTO whatsapp_whitelist (phone, label, active)
VALUES ('whatsapp:+972544568078', 'David', TRUE)
ON CONFLICT (phone) DO UPDATE SET active = TRUE, label = EXCLUDED.label;

-- Seed Rachel's number
INSERT INTO whatsapp_whitelist (phone, label, active)
VALUES ('whatsapp:+972546704797', 'Rachel', TRUE)
ON CONFLICT (phone) DO UPDATE SET active = TRUE, label = EXCLUDED.label;

-- =============================================================================
-- To add a number:
--   INSERT INTO whatsapp_whitelist (phone, label) VALUES ('whatsapp:+972...', 'Name');
-- To block a number temporarily (without deleting):
--   UPDATE whatsapp_whitelist SET active = FALSE WHERE phone = 'whatsapp:+972...';
-- To remove permanently:
--   DELETE FROM whatsapp_whitelist WHERE phone = 'whatsapp:+972...';
-- =============================================================================

-- Verify seed
SELECT phone, label, active FROM whatsapp_whitelist ORDER BY added_at;
