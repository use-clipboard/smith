// Deliverability checks for the firm's sending domain.
//
// Campaigns send over Gmail/Google Workspace, so the things that actually decide
// whether mail lands are: SPF authorising Google, DKIM signing (Workspace's
// default selector is `google`), and a DMARC record. We look these up live over
// DNS — no third-party service — and pair them with our own bounce/unsubscribe
// numbers.
//
// Every lookup is timeout-guarded and failure-tolerant: a DNS hiccup yields
// "couldn't check", never a broken page.

import { resolveTxt, resolveMx } from 'dns/promises';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'unknown';

export interface DeliverabilityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** The record we found, shown in a monospace line when present. */
  value?: string;
  /** What to do about it, when it isn't a pass. */
  fix?: string;
}

const DNS_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms = DNS_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), ms)),
  ]);
}

/** All TXT records at a name, each joined into one string. [] on any failure. */
async function txtRecords(name: string): Promise<string[]> {
  try {
    const records = await withTimeout(resolveTxt(name));
    return records.map(chunks => chunks.join(''));
  } catch {
    return [];
  }
}

export function domainFromEmail(email?: string | null): string | null {
  const at = (email ?? '').split('@')[1];
  return at ? at.trim().toLowerCase() : null;
}

export function isConsumerGmail(domain: string | null): boolean {
  return domain === 'gmail.com' || domain === 'googlemail.com';
}

/**
 * Does this SPF record authorise Google, following `include:` / `redirect=`?
 *
 * A flat text match isn't enough: plenty of domains authorise Google through a
 * nested include (SPF-flattening services publish something like
 * `include:dc-xxxx._spfm.example.com` which in turn includes _spf.google.com).
 * Treating those as "Google not authorised" would be a false alarm, so we walk
 * the chain, bounded by SPF's own 10-lookup limit.
 *
 * Returns 'unknown' when the chain can't be fully expanded — better to say we
 * couldn't confirm than to assert something wrong.
 */
async function spfAuthorisesGoogle(record: string): Promise<'yes' | 'no' | 'unknown'> {
  const GOOGLE = /_spf\.google\.com/i;
  const seen = new Set<string>();
  let lookups = 0;
  let unresolved = false;

  async function walk(rec: string): Promise<boolean> {
    if (GOOGLE.test(rec)) return true;
    const targets = Array.from(rec.matchAll(/\b(?:include:|redirect=)(\S+)/gi)).map(m => m[1].toLowerCase());
    for (const target of targets) {
      if (lookups >= 10) { unresolved = true; return false; }   // RFC 7208 limit
      if (seen.has(target)) continue;
      seen.add(target);
      lookups++;
      const recs = await txtRecords(target);
      const spf = recs.find(r => r.toLowerCase().startsWith('v=spf1'));
      if (!spf) { unresolved = true; continue; }
      if (await walk(spf)) return true;
    }
    return false;
  }

  if (await walk(record)) return 'yes';
  return unresolved ? 'unknown' : 'no';
}

/** Run the DNS-based authentication checks for a sending domain. */
export async function checkDomainAuth(domain: string): Promise<DeliverabilityCheck[]> {
  const [spfTxt, dkimTxt, dmarcTxt, mx] = await Promise.all([
    txtRecords(domain),
    txtRecords(`google._domainkey.${domain}`),
    txtRecords(`_dmarc.${domain}`),
    withTimeout(resolveMx(domain)).catch(() => [] as { exchange: string; priority: number }[]),
  ]);

  const checks: DeliverabilityCheck[] = [];

  // ── SPF ─────────────────────────────────────────────────────────────────────
  const spf = spfTxt.find(r => r.toLowerCase().startsWith('v=spf1'));
  if (!spf) {
    checks.push({
      id: 'spf', label: 'SPF', status: 'fail',
      detail: 'No SPF record found for this domain.',
      fix: `Add a TXT record on ${domain} containing "v=spf1 include:_spf.google.com ~all" so Google is authorised to send for you.`,
    });
  } else {
    const google = await spfAuthorisesGoogle(spf);
    if (google === 'yes') {
      checks.push({ id: 'spf', label: 'SPF', status: 'pass', detail: 'SPF authorises Google to send for your domain.', value: spf });
    } else if (google === 'unknown') {
      checks.push({
        id: 'spf', label: 'SPF', status: 'warn',
        detail: 'An SPF record exists, but its include chain couldn’t be fully expanded to confirm Google is authorised.',
        value: spf,
        fix: 'Worth confirming with whoever manages your DNS that Google is authorised (directly or via an include).',
      });
    } else {
      checks.push({
        id: 'spf', label: 'SPF', status: 'warn',
        detail: 'An SPF record exists but doesn’t appear to authorise Google, even following its includes.',
        value: spf,
        fix: 'Add "include:_spf.google.com" to your existing SPF record (keep it to a single TXT record).',
      });
    }
  }

  // ── DKIM ────────────────────────────────────────────────────────────────────
  const dkim = dkimTxt.find(r => /v=DKIM1|p=/i.test(r));
  if (dkim) {
    checks.push({ id: 'dkim', label: 'DKIM', status: 'pass', detail: 'DKIM is published for the default Google selector.', value: `google._domainkey.${domain}` });
  } else {
    checks.push({
      id: 'dkim', label: 'DKIM', status: 'warn',
      detail: `No DKIM record at the default Google selector (google._domainkey.${domain}).`,
      fix: 'In Google Admin → Apps → Gmail → Authenticate email, generate the DKIM key and publish it, then turn on authentication. If you use a custom selector, this check won’t see it.',
    });
  }

  // ── DMARC ───────────────────────────────────────────────────────────────────
  const dmarc = dmarcTxt.find(r => r.toLowerCase().startsWith('v=dmarc1'));
  if (!dmarc) {
    checks.push({
      id: 'dmarc', label: 'DMARC', status: 'fail',
      detail: 'No DMARC record found.',
      fix: `Add a TXT record at _dmarc.${domain} such as "v=DMARC1; p=none; rua=mailto:dmarc@${domain}" to start monitoring, then tighten to quarantine or reject.`,
    });
  } else {
    const policy = (dmarc.match(/p=([a-z]+)/i)?.[1] ?? '').toLowerCase();
    if (policy === 'reject' || policy === 'quarantine') {
      checks.push({ id: 'dmarc', label: 'DMARC', status: 'pass', detail: `DMARC is enforcing (p=${policy}).`, value: dmarc });
    } else {
      checks.push({
        id: 'dmarc', label: 'DMARC', status: 'warn',
        detail: 'DMARC is published but set to monitor only (p=none).',
        value: dmarc,
        fix: 'Once your reports look clean, move to p=quarantine and then p=reject for full protection.',
      });
    }
  }

  // ── MX (informational) ──────────────────────────────────────────────────────
  const onGoogle = mx.some(m => /google(mail)?\.com$/i.test(m.exchange.replace(/\.$/, '')));
  checks.push({
    id: 'mx', label: 'Mail host', status: 'info',
    detail: mx.length === 0
      ? 'No MX records found for this domain.'
      : onGoogle ? 'This domain receives mail through Google Workspace.' : 'This domain receives mail somewhere other than Google.',
    value: mx.length ? mx.map(m => m.exchange.replace(/\.$/, '')).slice(0, 3).join(', ') : undefined,
  });

  return checks;
}

/** Health checks derived from the firm's own send history. */
export function checkSendHealth(stats: {
  sent: number; bounced: number; unsubscribed: number; sentLast24h: number; includeUnsubscribe: boolean;
}): DeliverabilityCheck[] {
  const checks: DeliverabilityCheck[] = [];
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  if (stats.sent === 0) {
    checks.push({ id: 'volume', label: 'Send history', status: 'info', detail: 'No campaigns sent yet — health figures appear once you’ve sent.' });
    return checks;
  }

  const bounceRate = pct(stats.bounced, stats.sent);
  checks.push({
    id: 'bounce',
    label: 'Bounce rate',
    status: bounceRate < 2 ? 'pass' : bounceRate < 5 ? 'warn' : 'fail',
    detail: `${bounceRate.toFixed(1)}% of your sends bounced.`,
    fix: bounceRate >= 2 ? 'Clean invalid addresses from your client records — repeated bounces damage sender reputation.' : undefined,
  });

  const unsubRate = pct(stats.unsubscribed, stats.sent);
  checks.push({
    id: 'unsub',
    label: 'Unsubscribe rate',
    status: unsubRate < 0.5 ? 'pass' : unsubRate < 2 ? 'warn' : 'fail',
    detail: `${unsubRate.toFixed(2)}% of recipients unsubscribed.`,
    fix: unsubRate >= 0.5 ? 'Consider sending less often, or tightening your audiences so messages are more relevant.' : undefined,
  });

  checks.push({
    id: 'unsub_link',
    label: 'Unsubscribe link',
    status: stats.includeUnsubscribe ? 'pass' : 'fail',
    detail: stats.includeUnsubscribe ? 'Every campaign includes an unsubscribe link.' : 'Campaigns are sending without an unsubscribe link.',
    fix: stats.includeUnsubscribe ? undefined : 'Turn on "Add an unsubscribe link to every campaign" in Send defaults — mailbox providers expect it.',
  });

  // Gmail's per-user daily limits: ~500 consumer, ~2,000 Workspace.
  checks.push({
    id: 'volume',
    label: 'Daily volume',
    status: stats.sentLast24h > 1500 ? 'warn' : 'info',
    detail: `${stats.sentLast24h} email${stats.sentLast24h === 1 ? '' : 's'} sent in the last 24 hours.`,
    fix: stats.sentLast24h > 1500 ? 'You’re approaching Gmail’s daily sending cap — split large sends across days.' : undefined,
  });

  return checks;
}
