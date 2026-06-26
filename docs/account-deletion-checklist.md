# Account & data deletion — internal process

SMITH's privacy policy commits to deleting a user's personal data (including
cached Google user data) **within 30 days of a verified request**. This is the
internal checklist for honouring that. There are two ways a request arrives.

## A. In-app request (preferred)

1. **User** raises it: Settings → **Account** → "Delete my account & data" →
   *Request account deletion*. On submit, SMITH **immediately revokes** their
   Gmail + Calendar access at Google and disconnects them. Firm admins get an
   in-app notification.
2. **Admin** completes it: Settings → **Team** → the red "Account deletion
   requests" panel → **Complete deletion**. This permanently deletes the user
   and their personal data and removes their auth login.

That's the whole flow — no manual database work needed.

## B. Emailed request (`hello@smithforaccountants.co.uk`)

The privacy policy also lets users request deletion by email. For those:

1. **Verify identity** — confirm the request genuinely comes from the account
   holder (reply from the address on file / known contact). Do **not** action an
   unverified request.
2. If the person is a **current SMITH user**, the quickest route is to ask them
   to raise it in-app (A), or an admin can remove them directly via Settings →
   Team → the member's ⋯ → Remove (this runs the same full deletion).
3. If they're **not** a current user (already removed, or a former prospect),
   confirm there's nothing left to delete, or remove any residual personal data
   in Supabase (see "What gets deleted" below).
4. **Reply** to confirm completion, and record the date (you have 30 days).

## What gets deleted vs retained

**Deleted** (personal data):
- The `users` row + Supabase auth login.
- Google connections — `email_connections` (Gmail) and `calendar_tokens`
  (Calendar), with the tokens **revoked at Google**, not just removed from our DB.
- Per-user data that cascades from `users`: notifications, chat history
  (Ask Smith), personal sticky notes, calendar personal reminders, email
  reactions, community posts/comments/likes, plus `email_allocations` and
  `email_task_links` (removed explicitly).

**Retained** (not personal data / legally required):
- Shared **client/firm records and work outputs** — these stay, attributed to no
  user (`user_id` is set to NULL on outputs, tasks, etc.). The firm needs these
  for audit and statutory retention.
- The firm's **Google Drive** connection — it's firm-level, shared by the team,
  and unaffected by an individual deletion.

## C. Whole-firm deletion (close the entire account)

Distinct from deleting one user. A firm **admin** raises it in Settings →
**Account** → "Delete entire firm account" (must type the firm name to confirm).
This is **recorded only** — it is **not** an instant wipe — and SMITH/operator
completes it after verification. Pending requests land in
`firm_deletion_requests`; the firm's admins also get an in-app notification.

To process a firm-deletion request (operator):
1. **Verify** the request with the firm admin (and handle any billing / notice
   period / data-export they're owed).
2. **Delete every user** in the firm via Settings → Team (or the per-user delete
   path) — this revokes each person's Google tokens and removes their data.
3. **Disconnect the firm's Google Drive** connection (firm settings) and revoke
   its token.
4. Remove remaining firm-scoped data and the `firms` row. NOTE: confirm cascade
   coverage across all firm-scoped tables before relying on a single
   `delete from firms` — some tables may need explicit cleanup. (A programmatic
   whole-firm wipe is deliberately not exposed in-app yet.)
5. Mark the `firm_deletion_requests` row `completed`.

## Guards & notes

- The **last remaining admin** can't delete their own account — promote another
  admin first. (Enforced on both request and completion.)
- Token **revocation** is best-effort: if Google's revoke endpoint is briefly
  unavailable we still delete our stored copy, so no token is retained either way.
- Implementation: `lib/accountDeletion.ts`, `app/api/account/deletion-request/*`,
  `app/api/account/deletion-requests/*`, UI in `DeleteAccountSection.tsx` /
  `DeletionRequestsPanel.tsx`. Table: `account_deletion_requests`
  (migration `20260715`).
