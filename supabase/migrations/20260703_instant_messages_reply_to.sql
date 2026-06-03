-- ============================================================
--  Team messenger — reply to a specific message
-- ============================================================
--  Lets a message reference an earlier message it's replying to,
--  so the chat can show a quoted reference (Slack/WhatsApp style).
--  Nullable — most messages aren't replies. ON DELETE SET NULL so
--  removing the referenced message just drops the quote, it never
--  cascades away the reply itself.
-- ============================================================

alter table public.instant_messages
  add column if not exists reply_to_id uuid
    references public.instant_messages(id) on delete set null;

create index if not exists instant_messages_reply_to_idx
  on public.instant_messages (reply_to_id)
  where reply_to_id is not null;

comment on column public.instant_messages.reply_to_id is
  'Optional: the message this one is a reply to (shown as a quoted reference in the chat).';
