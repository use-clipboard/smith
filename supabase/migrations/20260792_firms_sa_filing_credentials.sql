-- Per-firm HMRC Self Assessment (legacy SA100 / GovTalk) filing credentials.
--
-- The firm's OLD-STYLE Government Gateway "Self Assessment for Agents" login —
-- SenderID (the Gateway user id) + password — placed in the GovTalk IRheader at
-- submission time. Distinct from the MTD Agent Services Account (which is OAuth).
--
-- Unlike anthropic_api_key / ch_api_key (stored plaintext), the password is
-- stored ENCRYPTED at rest (AES-256-GCM via lib/crypto/secretBox.ts, keyed by the
-- SA_CRED_ENCRYPTION_KEY env var) because it is a reusable primary credential to
-- a government system. The SenderID (a username) is stored in the clear.
-- Never returned to the browser: service-role reads only; the API returns a
-- hasCredentials boolean, never the password. Vendor ID (9626) stays a global
-- env var — it identifies the SMITH product, not the firm.

alter table public.firms add column if not exists sa_gateway_sender_id text;
alter table public.firms add column if not exists sa_gateway_password_enc text;

comment on column public.firms.sa_gateway_sender_id is 'HMRC Government Gateway SenderID (SA-for-agents user id) for legacy SA100 filing. Plaintext username.';
comment on column public.firms.sa_gateway_password_enc is 'HMRC Gateway password for legacy SA100 filing, AES-256-GCM encrypted (lib/crypto/secretBox.ts). Never expose to the client.';
