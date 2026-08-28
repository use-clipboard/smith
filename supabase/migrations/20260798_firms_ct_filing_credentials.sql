-- Per-firm HMRC Corporation Tax (CT600 / GovTalk) filing credentials.
--
-- The firm's Government Gateway "Corporation Tax for Agents" login — SenderID
-- (the Gateway user id) + password — placed in the GovTalk IRheader at CT600
-- submission time. Sibling of the SA100 credentials (sa_gateway_*); a separate
-- login because CT600 is a distinct HMRC service with its own vendor recognition.
--
-- The password is stored ENCRYPTED at rest (AES-256-GCM via lib/crypto/secretBox.ts,
-- keyed by the SA_CRED_ENCRYPTION_KEY env var — the same app-layer secret key).
-- The SenderID (a username) is stored in the clear. Never returned to the browser:
-- service-role reads only; the API returns a hasCredentials boolean, never the
-- password. The CT Vendor ID stays a global env var (HMRC_CT_VENDOR_ID) — it
-- identifies the SMITH product, not the firm.

alter table public.firms add column if not exists ct_gateway_sender_id text;
alter table public.firms add column if not exists ct_gateway_password_enc text;

comment on column public.firms.ct_gateway_sender_id is 'HMRC Government Gateway SenderID (CT-for-agents user id) for CT600 filing. Plaintext username.';
comment on column public.firms.ct_gateway_password_enc is 'HMRC Gateway password for CT600 filing, AES-256-GCM encrypted (lib/crypto/secretBox.ts). Never expose to the client.';
