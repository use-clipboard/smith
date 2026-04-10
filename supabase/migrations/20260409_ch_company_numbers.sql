-- Firm-level saved company list for CH Secretarial
ALTER TABLE firms ADD COLUMN IF NOT EXISTS ch_company_numbers text[] DEFAULT NULL;
