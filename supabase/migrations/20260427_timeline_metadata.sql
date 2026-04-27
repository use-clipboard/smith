-- Add a generic metadata JSONB column to client_timeline_notes.
-- Used by the Meeting Notes tool to store structured data (key points, actions, decisions, etc.)
-- so the timeline card can render a rich expandable view without a separate table join.

ALTER TABLE client_timeline_notes
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN client_timeline_notes.metadata IS
  'Structured data for rich timeline cards. For meeting_notes type: { summary, keyPoints, actionItems, decisions, formalMinutes, nextMeeting, attendees, location, meetingOrigin, attendees }';
