-- ── Meeting Notes ──────────────────────────────────────────────────────────────
-- Stores AI-generated meeting notes, transcripts, and minutes.
-- Created by the Meeting Notes tool.

CREATE TABLE IF NOT EXISTS meeting_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           uuid        NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  client_id         uuid        REFERENCES clients(id) ON DELETE SET NULL,

  -- Meeting metadata
  title             text        NOT NULL,
  meeting_date      date        NOT NULL,
  meeting_time      text,                              -- "14:30" format
  duration_seconds  integer,
  location          text,
  attendees         text[]      NOT NULL DEFAULT '{}',
  calendar_event_id text,                              -- Google Calendar event ID if linked

  -- How the meeting was held
  meeting_origin    text        CHECK (meeting_origin IN ('recorded','virtual','in_person','phone')),

  -- Content
  transcript        text,
  summary           text        NOT NULL DEFAULT '',
  key_points        jsonb       NOT NULL DEFAULT '[]', -- string[]
  action_items      jsonb       NOT NULL DEFAULT '[]', -- {action, owner, deadline}[]
  decisions         jsonb       NOT NULL DEFAULT '[]', -- string[]
  formal_minutes    text        NOT NULL DEFAULT '',
  next_meeting      text,

  -- Google Drive
  google_drive_url          text,   -- Meeting notes PDF
  google_drive_file_id      text,
  google_drive_video_url    text,   -- Screen recording video
  google_drive_video_file_id text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meeting_notes_firm_isolation" ON meeting_notes
  USING (
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
  )
  WITH CHECK (
    firm_id = (SELECT firm_id FROM users WHERE id = auth.uid())
  );

-- Index for common queries
CREATE INDEX IF NOT EXISTS meeting_notes_firm_date ON meeting_notes (firm_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS meeting_notes_client    ON meeting_notes (client_id) WHERE client_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_meeting_notes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER meeting_notes_updated_at
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION update_meeting_notes_updated_at();

-- ── Extend client_timeline_notes with meeting notes fields ────────────────────
-- These columns are nullable; only populated when a note was auto-created
-- by the Meeting Notes tool.

ALTER TABLE client_timeline_notes
  ADD COLUMN IF NOT EXISTS meeting_note_id  uuid REFERENCES meeting_notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_drive_url text;

-- Add meeting_notes type to NOTE_TYPE_META in the application
-- (no DB enum change needed — note_type is stored as text)

COMMENT ON COLUMN client_timeline_notes.meeting_note_id IS
  'Set when this timeline entry was auto-created by the Meeting Notes tool';
COMMENT ON COLUMN client_timeline_notes.google_drive_url IS
  'Google Drive URL for an associated document (e.g. meeting notes PDF)';
