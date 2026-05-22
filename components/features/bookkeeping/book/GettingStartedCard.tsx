'use client';

/**
 * GettingStartedCard — the right-hand help panel on the Home tab.
 *
 * VT equivalent: the "Getting Started" + Help Topics column on VT's Home Page.
 * Each topic is a clickable disclosure that reveals a short stub of help text.
 *
 * The content is deliberately brief in this first pass — long-form help can
 * be filled in later (or hooked up to a docs site) without re-touching the
 * UI shell.
 */

import { useState } from 'react';
import { Compass } from 'lucide-react';

interface Topic {
  id: string;
  title: string;
  body: string;
}

// Help body is plain text with paragraph breaks ("\n\n") — rendered with
// whitespace-pre-line so authors can write naturally without HTML.
const TOPICS: Topic[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    body:
`Welcome to SMITH bookkeeping. This is a cloud bookkeeping tool designed by accountants for accountants — built for speed, accuracy, and full double-entry accounting under the hood.

Every transaction you post here is double-entry: every debit has an equal and opposite credit. SMITH handles the second leg automatically for PAY, CHQ, REC, TRF, SIN, SCR, PIN and PCR. Only journals (JRN) ask you to enter both sides yourself.

The workspace is built around four areas: the side rail (left) gives you one-click access to every transaction type and the main views; the Home tab gives you an at-a-glance balance summary; the Input sheet is your fast keyboard-driven posting screen; and the Trial Balance shows every account with movement so you can drill into the detail.

If you've used VT Transaction+, the muscle memory should carry across. If you've used Xero or QuickBooks, you'll find this dramatically faster.`,
  },
  {
    id: 'setting_up',
    title: 'Setting up',
    body:
`When you create a new book, SMITH automatically seeds the Chart of Accounts from the firm-wide template for the chosen entity type. A Limited Company book gets 168 ready-to-use accounts across 22 ledgers; a Sole Trader gets a slimmer set, and so on. You're ready to post on day one.

You don't need to set up accounts in advance. Inside any account picker, type a name that doesn't exist yet, then click "Set up a new account" at the bottom of the dropdown. The new account joins your Chart of Accounts immediately and is selected for the current row.

VAT settings live in Book settings (cog icon, bottom of the rail). You can switch VAT on or off at any time — turning it on back-fills the six VAT routing accounts in Creditors automatically.

Admin-managed firm settings — like editing the master COA template that seeds future books — live in the main SMITH Settings under Bookkeeping.`,
  },
  {
    id: 'opening_balances',
    title: 'Opening balances',
    body:
`Opening balances are how you migrate an existing book into SMITH. Post them as a single journal dated the day before your first live transaction.

Open the Input sheet, click JRN, and enter one line per account with its opening figure as a debit or credit. Bank balances, debtors, creditors, fixed assets, share capital, retained earnings — they all go in. The Net Profit b/fwd typically sits in the "Profit and loss account" ledger.

Debits must equal credits before SMITH lets you post. If they don't balance, your old TB doesn't balance — go back to the source data, don't fudge the difference.

The system journal will get reference JRN 000001 and is visible in the Trial Balance from that date forward. It cannot be deleted without leaving an audit trail.`,
  },
  {
    id: 'entering_transactions',
    title: 'Entering transactions',
    body:
`The Input sheet is where 90% of your time will be spent. It's a single keyboard-driven row that handles every transaction type except journals.

Pick the type from the strip at the top (or the + button in the side rail). Then Tab through the cells: Date → Primary account → Details (payee) → Total → VAT → Analysis account → Entry details. Press Enter to post; the row clears and focus returns ready for the next entry.

Speed shortcuts:
  •  *  in the Date field = today
  •  dd/mm/yy or dd-mm-yy is accepted, including 2-digit years
  •  F9 clones the last transaction of the same type (great for monthly subscriptions)
  •  Ctrl+F9 clones and advances the date by one month
  •  Esc clears the row
  •  Memorised payees: type a known payee and the analysis account auto-fills from the last time

You can edit any cell after posting by clicking the row on the recent feed below.`,
  },
  {
    id: 'displaying_results',
    title: 'Displaying results',
    body:
`Open the Trial Balance from the side rail. Every account with movement in the chosen period appears, grouped by ledger and colour-coded by type (Income green, Expense red, Asset blue, Liability violet, Equity slate).

Click any account name to open a ledger drill-down. You'll see every transaction touching that account in chronological order, with a running balance column and proper "Balance b/fwd" + "Balance c/fwd" rows. Drill-down tabs stay open in the side rail — click their initials to switch back, or × to close.

Use the Period selector at the top to scope any report. Presets are there for the common ranges — This month, This quarter, This FY, Last FY, All time — and the date range is remembered per book across sessions.

Trial Balance footer shows Total Dr = Total Cr (they always balance — if they don't, something's wrong in the data, not the report) and the Net profit/loss for the period.`,
  },
  {
    id: 'correcting_mistakes',
    title: 'Correcting mistakes',
    body:
`Made an error? Three options, in increasing severity:

1. Edit it. Click the transaction's row on the recent feed (Home tab) to reopen it. Adjust any field, save. The change is logged silently to the audit trail.

2. Delete it. Click the bin icon on a row. The transaction disappears from reports. CRITICALLY: the reference number is NOT reused. If PAY 000012 is deleted, the next PAY will still be PAY 000013. The gap is the audit trail — it tells future-you that something was deleted, when, and by whom.

3. Reverse it. For posted journals that affect locked periods, post an equal-and-opposite journal in the current period rather than going back and editing history. This is the proper accounting way.

Period locks are a safety net: once an admin locks a period, no one can edit transactions on or before the lock date without admin approval.`,
  },
  {
    id: 'invoicing',
    title: 'Invoicing',
    body:
`Sales and purchases work via the SIN, SCR, PIN, PCR transaction types. The primary account is your customer or supplier (auto-filtered when you pick the type), and the analysis is your income/expense account.

For sales: SIN (Sales Invoice) puts the gross amount on the customer account as a debit (they owe you) and credits Income + Creditors: VAT - Output (if VAT-registered). SCR is the credit-note reversal.

For purchases: PIN credits the supplier (you owe them), debits Expenses + Creditors: VAT - Input. PCR reverses it.

The customer / supplier accounts live in the Customers / Suppliers ledgers. Both ledgers ship empty — you add accounts as you do business with them. The inline "Set up a new account" affordance makes this a 5-second job from the Input sheet.

To match a customer payment to specific invoices: this lands in Phase 4 (Bank reconciliation & matching). For now, post the receipt against the customer's account; the balance will reduce automatically.`,
  },
  {
    id: 'vat',
    title: 'VAT',
    body:
`When a book is VAT-registered, posting a transaction with a VAT treatment (Standard 20%, Reduced 5%, Zero, Exempt, Outside scope) automatically splits the gross total into net + VAT.

Routing:
  •  Output VAT (sales — SIN, SCR, REC) → Creditors: VAT - Output
  •  Input VAT (purchases — PIN, PCR, PAY, CHQ) → Creditors: VAT - Input

The net Net column shows you the post-VAT figure in real time as you type the total. You don't need to do the arithmetic — let SMITH do it.

If the book isn't VAT-registered, the VAT and Net columns disappear entirely. The "Total" column relabels to "Amount" and everything is gross.

The VAT return walkthrough (calculating Box 1 through Box 9, submitting to HMRC under MTD) arrives in Phase 5. Until then, you can extract figures manually from the Trial Balance using the period selector.`,
  },
  {
    id: 'year_ends',
    title: 'Year ends',
    body:
`At year end, post the closing journals before locking the period. The usual suspects:

  •  Depreciation — debit Expenses: Depreciation, credit FA: Depn - charge
  •  Accruals — debit Expenses (e.g. Accountancy fees), credit Creditors: Accruals
  •  Prepayments — debit Debtors: Prepayments, credit Expenses
  •  Tax provision — debit Taxation: Corporation tax, credit Creditors: Corporation tax
  •  Dividends declared — debit Profit and loss account: Equity dividends, credit Creditors: Proposed dividends

All go in as JRN entries. Each must balance to post.

Once the year is fully closed and audited, open Book settings and set the Period lock date to the year-end date. No one (other than an admin overriding) can post into the locked period afterward — protecting the figures you've signed off.

The Net profit for the year stays accumulated in "Profit and loss account: Brought forward" when you carry forward — handled automatically by SMITH when the book rolls into the next FY.`,
  },
  {
    id: 'notes',
    title: 'Notes',
    body:
`Shared per-book notes are coming in a later phase. The model is six tabs along the right of the Home page:

  •  Notes — free-text observations, "client came from another accountant", etc.
  •  Setting up — what was done at initial setup
  •  Opening balances — where the opening figures came from
  •  VAT — scheme quirks, what's been agreed with the client
  •  Year ends — close-out checklist
  •  Custom — whatever the firm decides

Every note is visible to every user with access to the book. The idea: when the next bookkeeper opens this file in six months, they instantly understand context that would otherwise be lost.

Until shipped, drop critical context in the book name itself (e.g. "Acme Ltd — VAT on cash basis, year-end Feb").`,
  },
];

interface Props {
  /** Caller-controlled height. Defaults to fitting the card to a height that
   *  matches the stacked Key Info + Quick Actions on the left of the Home tab. */
  className?: string;
}

export default function GettingStartedCard({ className }: Props) {
  const [activeId, setActiveId] = useState<string>('introduction');
  const active = TOPICS.find(t => t.id === activeId) ?? TOPICS[0];

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col ${className ?? 'h-full'}`}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Compass size={14} />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">Getting Started</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{active.title}</span>
      </div>

      {/* Body — scrollable, shows currently-selected topic */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 text-[12px] text-slate-600 leading-relaxed whitespace-pre-line">
        {active.body}
      </div>

      {/* Sub-tabs at the BOTTOM — same pill style as KeyInformationCard.
          Horizontal scroll lets all 10 topics stay reachable without wrapping. */}
      <div className="border-t border-slate-100 px-2 py-1.5 flex items-center gap-1 overflow-x-auto">
        {TOPICS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap ${
              activeId === t.id
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'text-slate-500 border-transparent hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>
    </div>
  );
}
