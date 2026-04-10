# Agent Smith — Project Brief for Claude Code

## What is Agent Smith?

Agent Smith is a professional web application built for accountancy firms. It uses AI to automate and assist with common bookkeeping and accounting tasks — saving time on document processing, analysis, and report generation.

It is currently used internally by a 16-person accountancy firm and is being developed toward a public SaaS release for other accountancy firms.

The original app was built as a single-file React app in Google AI Studio using the Gemini API. We are rebuilding it properly in Next.js with the Anthropic API (Claude), proper authentication, a database, and a maintainable folder structure.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS — clean, professional aesthetic inspired by Xero and QuickBooks
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **File Storage:** Supabase Storage
- **AI:** Anthropic API — model `claude-sonnet-4-6`
- **Payments (Phase 2):** Stripe
- **Deployment:** Vercel

---

## Design Principles

- Clean, professional UI — think Xero or QuickBooks, not a generic AI chatbot
- Neutral colour palette: whites, light greys, subtle blues
- Every screen should feel trustworthy and enterprise-grade
- Mobile-responsive but desktop-first (accountants primarily work at desks)
- No unnecessary animations or distractions
- Clear loading states when AI is processing documents
- Errors should always show in a friendly, user-facing format — never expose raw API errors

---

## Users & Access Model

There are two user types:

### Firm Admin
- Can manage team members (invite, remove, set roles)
- Can view all clients and all work across the firm
- Can configure firm-level settings

### Staff User
- Has their own personal workspace
- Can access shared firm clients
- Cannot see other staff members' personal workspaces

### Client Records
- Each client record is shared across the firm
- Any staff member can work on any client
- All outputs generated for a client are saved to that client's record

---

## File Handling

Users upload the following document types:
- PDF invoices
- Bank statements (PDF)
- Bank statements (CSV / Excel)
- Scanned documents and images (JPG, PNG)

All uploaded files must be:
- Stored securely in Supabase Storage
- Linked to the relevant client record
- Retained for audit/history purposes
- Passed to Claude via base64 encoding or the Anthropic Files API

Images should be compressed before sending to the API where possible (the original app used a `compressImage` utility — retain this behaviour).

---

## App Modes (Features)

The original app used an `AppMode` type to switch between features. In the new app, these become separate pages/routes. Each mode had its own theme class — preserve this concept with Tailwind variants or a theme context.

### 1. Full Analysis (`full_analysis`)
**Purpose:** Analyse invoices/receipts and produce bookkeeping entries formatted for a target accounting software.

**Target software options:**
- VT Transaction+ (`vt`)
- Capium Bookkeeping (`capium`)
- Xero (`xero`)

**Inputs:**
- Client name, client address, VAT registered (yes/no)
- Multiple document uploads (invoices, receipts — PDF or image)
- Optional: past transactions file (for duplicate detection)
- Optional: ledger accounts CSV (for account code matching)
- Target software selector

**Output schemas (migrate these exactly from Gemini structured output to Claude JSON mode):**

VT Schema fields per transaction: `fileName`, `pageNumber`, `type`, `refNo`, `date`, `primaryAccount`, `details`, `total`, `vat`, `analysis`, `analysisAccount`, `entryDetails`, `transactionNotes`

Capium Schema fields: `fileName`, `pageNumber`, `contactname`, `contacttype`, `reference`, `description`, `accountname`, `accountcode`, `invoicedate`, `vatname`, `vatamount`, `isvatincluded`, `amount`, `netAmount`, `paydate`, `payaccountname`, `payaccountcode`

Xero Schema fields: `fileName`, `pageNumber`, `contactName`, `invoiceNumber`, `invoiceDate`, `dueDate`, `description`, `quantity`, `unitAmount`, `grossAmount`, `accountCode`, `accountName`, `taxType`

All schemas also include a `flaggedEntries` array with fields: `fileName`, `reason`, `duplicateOf`, `pageNumber`, `date`, `supplier`, `amount`, `description`

**Features:**
- Undo/redo history on transaction edits
- Batch selection and editing of transactions
- Export to CSV formatted for the target software
- Flagged entries view (duplicates, anomalies)
- Session restore (save state so work isn't lost on refresh)

---

### 2. Bank to CSV (`bank_to_csv`)
**Purpose:** Extract transactions from a bank statement and produce a clean CSV.

**Inputs:** Bank statement (PDF, CSV, or Excel)

**Output schema per transaction:** `fileName`, `detectedDate`, `entityName`, `detailedCategory`, `totalNetAmount` (optional), `totalVatAmount` (optional), `totalGrossAmount`

**Features:**
- User can review and edit extracted rows before downloading
- Export as CSV

---

### 3. Landlord Analysis (`landlord_analysis`)
**Purpose:** Analyse income and expense documents for a rental property portfolio and produce a UK property income computation.

**Inputs:** Mix of income documents and expense documents (PDF or image)

**Output schema:**

Income fields per row: `fileName`, `Date` (YYYY-MM-DD), `PropertyAddress`, `Description`, `Category` (always `"Total rents and other income from property"`), `Amount`

Expense fields per row: `fileName`, `DueDate` (YYYY-MM-DD), `Description`, `Category`, `Amount`, `Supplier`, `TenantPayable` (boolean), `CapitalExpense` (boolean), `PropertyAddress`

Also includes `flaggedEntries` array.

**Features:**
- Undo/redo history
- Separate income and expense views
- Follows UK property income tax rules

---

### 4. Final Accounts Review (`final_accounts_review`)
**Purpose:** Review a set of financial statements and produce a list of review points with suggested journals.

**Inputs:**
- Business name, client code, business type (`sole_trader` | `partnership` | `limited_company`)
- Period start and end dates
- VAT registered (yes/no)
- Relevant context (free text)
- Preparer name
- Current year: P&L, Balance Sheet, Trial Balance (file uploads)
- Prior year (optional): P&L, Balance Sheet, Trial Balance

**Output schema per review point:** `area`, `issue`, `explanation`, `severity` (`"Serious"` | `"Minor"`), `suggestedJournal` (with `debitAccount`, `creditAccount`, `amount`, `description`)

**Features:**
- Undo/redo on working papers
- Working papers generated separately from review points (schema: array of `{ title, content }`)
- Export working papers

---

### 5. Performance Analysis (`performance_analysis`)
**Purpose:** Analyse management accounts and produce a business performance report with KPI ratios and commentary.

**Inputs:**
- Business name, business type, trade/sector, trading location
- Relevant context (free text)
- Analysis period type (`yearly` | `quarterly` | `monthly`) and description
- Management accounts files (current period)
- Prior period accounts files (optional)
- Prior period analysis files (optional)

**Output schema:**
- `reportHtml`: Full HTML-formatted report
- `chartDataJson`: JSON string — array of `{ label, company, benchmark }` for bar charts

---

### 6. P32 Summary (`p32_summary`)
**Purpose:** Summarise a P32 payroll document and produce a client-ready email body.

**Inputs:** P32 document (PDF or image)

**Output schema:** `emailBody` (plain text with double line breaks for paragraphs)

---

### 7. Risk Assessment (`risk_assessment`)
**Purpose:** Conduct a client risk assessment using a structured questionnaire and produce a risk report.

**Inputs:**
- User's name, client name, client code
- Client type: `individual` | `limited_company` | `llp` | `trust` | `charity`
- Answers to risk assessment questions (yes/no + optional comment per question)

**Output schema:** `overallRiskLevel` (`"Low"` | `"Medium"` | `"High"`), `riskJustification`, `summaryOfAnswers` (array of `{ questionId, question, answer, userComment }`), `suggestedControls`, `trainingSuggestions`

**Features:**
- Risk rating badge (Low/Medium/High) prominently displayed on results
- Export report as PDF

---

### 8. Ask Smith (`ask_smith`)
**Purpose:** Full-page AI chat assistant for accounting questions, help with the app, or explaining outputs.

**Features:**
- Full conversation history within the session
- Context-aware: knows which client and feature the user is working in
- Floating "Ask Smith" button visible on all other screens (opens a mini chat overlay)
- System prompt tailored to UK accountancy practice

---

### 9. Summarise (`summarise`)
**Purpose:** Summarise documents that are out of date range or not relevant to the current job, for file note purposes.

**Inputs:** Multiple document uploads

**Output:** Array of `OutOfRangeDocument` objects — each with a summary of what the document contains and why it was flagged

---

### 10. Policies & Procedures (`policies_and_procedures`)
**Purpose:** A static reference section containing the firm's internal policies and procedures.

**No AI involved.** This is a content/reference page only.

---

## Existing Utility Functions (preserve these)

These were in `utils/fileUtils.ts` — recreate them:
- `fileToBase64(file)` — converts a File to base64 string
- `readFileAsText(file)` — reads a file as plain text
- `exportToCsv(data, filename)` — exports an array of objects as a CSV download
- `parseLedgerCsv(text)` — parses a ledger accounts CSV into `LedgerAccount[]`
- `findBestMatch(str, options)` — fuzzy matching for account code suggestions
- `parseTrialBalance(text)` — parses trial balance CSV
- `compressImage(file)` — compresses an image file before uploading to reduce API costs

These were in `utils/localStorageUtils.ts` — replace with Supabase-backed persistence:
- `saveStateToLocalStorage(state)` → save to Supabase
- `loadStateFromLocalStorage()` → load from Supabase
- `clearStateFromLocalStorage()` → clear from Supabase

---

## AI Integration Guidelines

- Always use model `claude-sonnet-4-6`
- Set `max_tokens: 4096` for most tasks; increase to `8192` for working papers and performance reports
- All AI calls must go through **server-side Next.js API routes** — never call the Anthropic API directly from the browser
- The Anthropic API key must only ever exist in server-side environment variables (`ANTHROPIC_API_KEY`) — never exposed to the client
- For structured output (all features except Ask Smith and P32), instruct Claude in the system prompt to return only valid JSON matching the schema, then parse the response
- For document processing, send files as base64-encoded content in the Claude messages array
- Stream responses for the Ask Smith chatbot
- Handle API errors gracefully — always show a user-friendly message, log the raw error server-side only
- Log all AI calls to an `ai_logs` table: `feature`, `client_id`, `input_tokens`, `output_tokens`, `created_at`

---

## Key UX Patterns to Preserve

The original app had these important patterns — preserve them in the new build:

- **Undo/redo history** on full analysis, landlord analysis, and working papers — implemented as an array of states with a history index pointer
- **Progress indicator** during AI processing — animated progress bar while waiting for the API response
- **Session restore** — save in-progress work so it survives a page refresh (use Supabase instead of localStorage)
- **Batch selection** — select multiple transactions and apply changes to all at once
- **Floating Ask Smith button** — visible on all feature screens, opens a mini chat overlay without losing current work

---

## Database Schema

```sql
-- Firms (scaffold now, enforce in Phase 2)
firms (
  id uuid primary key,
  name text,
  subscription_tier text default 'internal',
  created_at timestamptz default now()
)

-- Users
users (
  id uuid primary key references auth.users,
  firm_id uuid references firms,
  email text,
  full_name text,
  role text check (role in ('admin', 'staff')),
  created_at timestamptz default now()
)

-- Clients
clients (
  id uuid primary key,
  firm_id uuid references firms,
  name text,
  client_ref text,
  business_type text,
  contact_email text,
  risk_rating text,
  created_at timestamptz default now()
)

-- Uploaded documents
documents (
  id uuid primary key,
  client_id uuid references clients,
  uploaded_by uuid references users,
  file_name text,
  file_url text,
  document_type text,
  created_at timestamptz default now()
)

-- AI outputs (one row per job run)
outputs (
  id uuid primary key,
  client_id uuid references clients,
  user_id uuid references users,
  feature text,
  target_software text,
  result_data jsonb,
  created_at timestamptz default now()
)

-- AI usage log
ai_logs (
  id uuid primary key,
  user_id uuid references users,
  client_id uuid references clients,
  feature text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz default now()
)

-- Chat messages (Ask Smith)
chat_messages (
  id uuid primary key,
  user_id uuid references users,
  client_id uuid references clients,
  role text check (role in ('user', 'assistant')),
  content text,
  created_at timestamptz default now()
)
```

Enable Row Level Security (RLS) on all tables. Users should only be able to read/write data belonging to their own firm.

---

## Folder Structure

```
/app
  /api
    /analyse          -- full analysis endpoint
    /bank-to-csv      -- bank to CSV endpoint
    /landlord         -- landlord analysis endpoint
    /final-accounts   -- final accounts review endpoint
    /performance      -- performance analysis endpoint
    /p32              -- P32 summary endpoint
    /risk-assessment  -- risk assessment endpoint
    /summarise        -- summarise endpoint
    /chat             -- Ask Smith chat endpoint
  /(auth)
    /login
    /signup
  /(app)
    /dashboard
    /clients
      /[id]
    /full-analysis
    /bank-to-csv
    /landlord
    /final-accounts
    /performance
    /p32
    /risk-assessment
    /summarise
    /ask-smith
    /policies
/components
  /ui               -- shared UI components (buttons, inputs, cards, spinner etc.)
  /features
    /full-analysis
    /bank-to-csv
    /landlord
    /final-accounts
    /performance
    /p32
    /risk-assessment
    /summarise
    /ask-smith
/lib
  /supabase.ts      -- Supabase client
  /anthropic.ts     -- Anthropic client (server-side only)
/prompts
  /full-analysis.ts
  /bank-to-csv.ts
  /landlord.ts
  /final-accounts.ts
  /performance.ts
  /p32.ts
  /risk-assessment.ts
  /summarise.ts
  /ask-smith.ts
/types
  /index.ts         -- all TypeScript types (migrated from original types.ts)
/utils
  /fileUtils.ts     -- preserve all original utility functions
  /csvExport.ts
```

---

## Coding Standards

- TypeScript throughout (strict mode)
- Use server components by default; client components only where interactivity requires it (mark with `'use client'`)
- All AI calls in `/app/api/` route handlers — never in client components
- Environment variables for all secrets — `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Use Zod for input validation on all API routes
- Error boundaries on all major UI sections
- Loading skeletons on all data-fetching components
- Never hardcode API keys anywhere
- Do not use `any` types in TypeScript unless absolutely unavoidable

---

## Current Development Phase

**Phase 1 — Migration & Internal Stabilisation**

Migrating from Google AI Studio (Gemini) to Next.js (Claude/Anthropic). The goal is a stable, well-structured codebase that the internal team of 16 can use reliably.

Priority order:
1. Scaffold Next.js project and folder structure
2. Copy all existing components across and get them rendering
3. Swap all Gemini API calls for Anthropic API (preserve all prompts and schemas exactly)
4. Add Supabase auth — replace localStorage API key with proper login
5. Move all AI calls server-side (API routes)
6. Add Supabase Storage for file uploads
7. Add client records and output history
8. Polish UI and test with the full team

Do NOT build Stripe or multi-tenancy yet — that is Phase 2.

---

## What to Avoid

- Do not call the Anthropic API from the browser — server-side only
- Do not store the API key in any client-side code or in any env var prefixed with `NEXT_PUBLIC_`
- Do not over-engineer — keep it simple and working
- Do not use any AI provider other than Anthropic
- Do not store sensitive financial data in plain text — always use Supabase with RLS enabled
- Do not build mobile-native features yet — web only
- Do not add features not listed above without checking first
