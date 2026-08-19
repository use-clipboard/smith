-- Free-text description of a client's business / trade, used to give the Capture
-- (full-analysis) AI better context when coding transactions. Entered once per
-- client in Capture, saved here, prefilled + editable on every later analysis.

alter table clients
  add column if not exists business_description text;

comment on column clients.business_description is
  'Free-text business/trade description. Feeds the Capture AI for account coding; prefilled + roll-forward per client.';
