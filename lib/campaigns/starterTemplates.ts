// Built-in starter templates — ready-made emails every firm can start from.
// Pure data (client + server safe). Firms' own saved templates live in the
// campaign_templates table; these are the always-available starting points.
//
// Bodies use campaign merge tags ({{client.first_name | default: "there"}}) and
// [SQUARE-BRACKET] placeholders for firm-specific bits the sender fills in.

export interface StarterTemplate {
  id: string;            // 'starter:<slug>'
  name: string;
  category: string;
  description: string;
  subject: string;
  preview_text: string;
  body_html: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'starter:monthly-newsletter',
    name: 'Monthly newsletter',
    category: 'Newsletter',
    description: 'A simple, clean monthly update for your whole client base.',
    subject: '[Firm] update — [Month] [Year]',
    preview_text: 'This month’s news, deadlines and a helpful reminder.',
    body_html: `<p>Dear {{client.first_name | default: "client"}},</p>
<p>Welcome to this month’s update from [FIRM NAME]. Here’s a quick round-up of what’s new and what to keep an eye on.</p>
<h3>This month’s highlights</h3>
<ul>
  <li>[First item — a change, a tip, or a piece of firm news]</li>
  <li>[Second item]</li>
  <li>[Third item]</li>
</ul>
<h3>Dates for your diary</h3>
<p>[Add any upcoming deadlines relevant to your clients.]</p>
<p>As always, if there’s anything we can help with, just reply to this email.</p>
<p>Best wishes,<br>[YOUR NAME]<br>[FIRM NAME]</p>`,
  },
  {
    id: 'starter:records-checklist',
    name: 'Year-end records checklist',
    category: 'Operational',
    description: 'Ask clients to send their records ahead of their year end.',
    subject: 'Your records for the year ended {{client.year_end | default: "your year end"}}',
    preview_text: 'A quick checklist to get your accounts under way.',
    body_html: `<p>Dear {{client.first_name | default: "client"}},</p>
<p>Your accounting year end is approaching, so we’d be grateful if you could send us your records for <strong>{{client.business_name}}</strong> at your convenience.</p>
<p>To help, here’s a checklist of what we typically need:</p>
<ul>
  <li>Bank statements for the full period</li>
  <li>Sales invoices and purchase receipts</li>
  <li>Details of any new assets bought or sold</li>
  <li>Loan or finance agreements</li>
  <li>Anything unusual you’d like us to know about</li>
</ul>
<p>You can reply to this email with your documents, or send them however suits you best.</p>
<p>Kind regards,<br>[YOUR NAME]</p>`,
  },
  {
    id: 'starter:tax-deadline',
    name: 'Tax deadline reminder',
    category: 'Reminder',
    description: 'A friendly nudge ahead of a filing or payment deadline.',
    subject: 'A quick reminder ahead of [DEADLINE]',
    preview_text: 'Just a friendly heads-up so nothing slips through.',
    body_html: `<p>Dear {{client.first_name | default: "client"}},</p>
<p>This is a friendly reminder that <strong>[DEADLINE / WHAT’S DUE]</strong> is coming up on <strong>[DATE]</strong>.</p>
<p>If we already have everything we need from you, there’s nothing to do — we’ll take care of it. If not, please send anything outstanding as soon as you can so we have time to get it right.</p>
<p>Any questions at all, just reply and we’ll be happy to help.</p>
<p>Best wishes,<br>[YOUR NAME]</p>`,
  },
  {
    id: 'starter:payment-reminder',
    name: 'Payment reminder',
    category: 'Reminder',
    description: 'A polite reminder for an outstanding balance.',
    subject: 'Your account with [FIRM NAME]',
    preview_text: 'A quick note about your outstanding balance.',
    body_html: `<p>Dear {{client.first_name | default: "client"}},</p>
<p>We hope you’re well. Our records show an outstanding balance of <strong>{{billing.balance_outstanding | default: "[AMOUNT]"}}</strong> on your account.</p>
<p>If you’ve already arranged payment, please ignore this note — thank you. Otherwise, we’d be grateful if you could settle it at your earliest convenience.</p>
<p>If there’s anything you’d like to discuss, just reply to this email.</p>
<p>Kind regards,<br>[YOUR NAME]</p>`,
  },
  {
    id: 'starter:welcome',
    name: 'New client welcome',
    category: 'Onboarding',
    description: 'Welcome a new client and set out the next steps.',
    subject: 'Welcome to [FIRM NAME]',
    preview_text: 'We’re delighted to have you on board — here’s what happens next.',
    body_html: `<p>Dear {{client.first_name | default: "there"}},</p>
<p>Welcome to [FIRM NAME] — we’re delighted to be working with you.</p>
<p>Here’s what happens next:</p>
<ul>
  <li>[Step one — e.g. we’ll set up your records]</li>
  <li>[Step two — e.g. we’ll confirm your deadlines]</li>
  <li>[Step three — e.g. your first check-in]</li>
</ul>
<p>Your main point of contact is [YOUR NAME]. If anything comes up in the meantime, just reply to this email.</p>
<p>We look forward to working with you.</p>
<p>Best wishes,<br>[YOUR NAME]<br>[FIRM NAME]</p>`,
  },
  {
    id: 'starter:confirmation-statement',
    name: 'Confirmation statement reminder',
    category: 'Reminder',
    description: 'Remind a limited company its confirmation statement is due.',
    subject: 'Confirmation statement due — {{client.business_name}}',
    preview_text: 'A quick check before we file your confirmation statement.',
    body_html: `<p>Dear {{client.first_name | default: "client"}},</p>
<p>The confirmation statement for <strong>{{client.business_name}}</strong> (company number {{company.company_number | default: "[NUMBER]"}}) is due on <strong>{{company.confirmation_statement_due | default: "[DATE]"}}</strong>.</p>
<p>Before we file it, could you confirm the following are still correct?</p>
<ul>
  <li>Registered office address</li>
  <li>Directors and their details</li>
  <li>People with significant control (PSCs)</li>
  <li>Shareholders and share capital</li>
</ul>
<p>If everything’s unchanged, just reply “all correct” and we’ll take it from there.</p>
<p>Kind regards,<br>[YOUR NAME]</p>`,
  },
];

export const STARTER_BY_ID: Record<string, StarterTemplate> =
  Object.fromEntries(STARTER_TEMPLATES.map(t => [t.id, t]));
