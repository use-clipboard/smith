-- Firm-level Services settings (jsonb), holding service TEMPLATES (bundles of
-- catalogue services applied to a client in one click) and room for future
-- options (proposal integration, the at-risk window). Shape:
--   { "templates": [ { "id": "...", "name": "Ltd package", "catalogueIds": ["...","..."] } ] }
alter table public.firms
  add column if not exists services_settings jsonb;
