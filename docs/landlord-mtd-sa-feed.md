# Landlord → MTD IT / Self-Assessment feed — scope

Status: **design only — not built.** Turns a saved Landlord Analysis into the
figures the MTD IT tool files quarterly and the (future) self-assessment tool
reports annually. Builds on the property register + per-person split shipped in
`20260759`.

## Two distinct targets (different shapes — don't conflate)

| | **A. MTD IT quarterly** | **B. Self-assessment (annual)** |
|---|---|---|
| Cadence | Cumulative YTD, per quarter | Once, year-end |
| Granularity | Per-transaction entries | Computed totals per person |
| Finance costs | Posted **as an expense** (HMRC residential finance-cost field); restriction applied later at SA finalisation | **Restricted** — 20% reducer (already in `computeRentComputation`) |
| Allowance / losses | Not a quarterly concept | Applied (already in the computation) |
| Capital | Excluded | Excluded |
| Target | `mtd_it_entries` on each owner's MTD IT client | The SA tool (doesn't exist yet) |

The key consequence: **Feed A must NOT apply the finance/allowance/loss logic** —
it posts raw per-owner income + expenses (finance included as an expense, capital
excluded). Feed B is where `computeRentComputation`'s tax treatment lives.

## The load-bearing insight — full amount, share applied at compute

> Superseded 2026-07-17. This previously said MTD IT "never divides", so the feed
> had to pre-split each amount. That was the *intent* but never the behaviour:
> `share_pct` was written and then ignored everywhere, so a 50% owner's figures
> came out at 200%. The rule below is what the code now does.

Entries hold the **whole-property `gross_amount`** plus the owner's `share_pct`.
Every figure — the totals strip, the P&L, the Excel export, the approval PDF, the
client approval page and the cumulative update filed with HMRC — is valued via
`shareAdjustedGbp()` in `lib/mtdIt/amounts.ts`, which applies the share once, at
the point of use.

Keeping the full amount on the row means it still reconciles to the invoice a
reviewer opens next to it, and the Share % column shows how the reported figure
was derived. For a co-owned property, post to **each owner's** MTD IT client
tagged to their matching property row, carrying that property's `ownership_pct`.

Note `mtd_it_properties.ownership_pct` holds the **primary** landlord's share;
additional co-owners live in `property_owners` (see `utils/landlordAllocation.ts`).
The feed currently carries only the primary share — a property whose shares don't
sum to 100 leaves a gap that nobody declares. Landlord surfaces that as
`unaccountedShare`; MTD IT does not yet.

HMRC models **all UK property as one business** (foreign split by country), so we
don't file per-property — we post entries tagged to each client's matching
property, and `computeMtdItCumulative(aggregateStream)` rolls them up.

## Building blocks that already exist (reuse, don't rebuild)

- **Per-person split** — `utils/landlordAllocation.computePersonBreakdown`, owners = `property_owners` (client-linked or named). `owner_client_id` is the bridge to an MTD IT client.
- **`mtd_it_entries`** — already has `property_id`, `entry_type`, `category`, `gross_amount`, `entry_date`, `share_pct`, `manual`, `source_file_name`, `drive_link`.
- **Category mapping** — `lib/mtdIt/categoryMap.classifyPropertyExpense` maps our SA105 categories → HMRC property expense fields (our 7 categories are already SA105).
- **Quarter mapping** — `lib/mtdIt/quarters.getQuarterDates` + `clients.mtd_it_quarter_type` (calendar/standard); quarters live in `mtd_it_quarters (client, tax_year, quarter)`.
- **Co-owner import** — `MtdItCoOwnerImportModal` + its API already copy entries between clients' matching properties with per-property **append / replace / skip** modes. The landlord feed should mirror this idempotency model.
- **Cumulative compute** — `computeMtdItCumulative` / `computeFilingUnits` already turn entries into filing figures. The feed only needs to *land* entries correctly.

## Feed A — MTD IT quarterly (design)

**Trigger:** a "Send to MTD IT" action on the Landlord results (per person, or all owners at once).

**Per owner who is an MTD IT client:**
1. Resolve the owner's MTD IT **property row** for each landlord property (their `mtd_it_properties` at the same address). If missing, create it (the co-owner flow already does this) — this is the `property_owners` ↔ `mtd_it_property_links` reconciliation point (see Decisions).
2. Bucket the owner's transactions by **quarter** (entry date → `getQuarterDates` for the client's quarter type), creating `mtd_it_quarters` rows as needed for the tax year.
3. For each transaction, insert an `mtd_it_entry`: `stream='uk_rental'` (or `foreign_rental`), `property_id` = owner's property, `entry_type`, `category` (SA105 → passed through), `gross_amount = round(share% × amount)`, `entry_date`, `description`, `supplier`, `source_file_name`, `drive_link`. **Exclude capital**; **include finance costs** as expenses.
4. Idempotency: append / replace / skip per (client, property, quarter), mirroring the co-owner import. Requires a dedupe marker (see Decisions).

**Preview before posting** (mirror the co-owner modal): per owner × quarter, show entry counts + income/expense totals, existing-on-target counts, and warnings (owner not MTD-IT-enabled; no quarter for the tax year; named owner with no client link → skipped).

## Feed B — Self-assessment (design)

The SA tool doesn't exist yet, and `computeRentComputation` already yields the
SA105 annual figures per person (net profit, finance reducer, allowance, losses
b/f & c/f). So Feed B is mostly a **read contract**, not new persistence:

- When the SA tool is built, it reads the client's saved Landlord Analysis for the tax year + the property register, and calls `computeRentComputation` / `computePersonBreakdown` to get each person's SA105 figures.
- Optional now: stamp a lightweight `sa_property_figures` snapshot (client, tax_year, per-person net/finance/allowance/loss-cf) on save, so the SA tool has a stable record even if the analysis is later edited. Defer until the SA tool's shape is known.

This aligns with `docs/people-and-entities.md` phase 4 (self-assessment feed).

## Data-model changes needed

1. **Entry provenance / dedupe** — `mtd_it_entries` has no source marker. Add `source text` (e.g. `'landlord'`) + `source_ref` (the landlord output id) so re-feeding can replace prior landlord-fed entries without touching manually-added ones. Migration.
2. **Owner ↔ MTD IT property reconciliation** — `property_owners` (landlord, client-or-named) and `mtd_it_property_links` (MTD IT, client-only) are separate. The feed needs each owner-client's `mtd_it_properties` row at the property address. Either (a) on feed, ensure/create it via the co-owner API, or (b) the longer-term consolidation of the two owner models. Decide before building.
3. **Named (non-client) owners** — can't be fed (no MTD IT client). Feed skips them with a clear message; their share still shows in Feed B via the named split.

## Edge cases & risks

- Owner client not MTD-IT-enabled (no streams / no quarter for the year) → skip + warn.
- Quarter-type mismatch between the landlord date range and the client's calendar/standard quarters → map by date regardless; warn if the analysis window doesn't cover a full quarter.
- Rounding: per-owner shares must reconcile to the whole (sum of rounded shares vs whole-property total) — round per entry, accept sub-penny drift, or assign the remainder to the primary owner.
- Re-runs after edits — replace-by-source, never blind append (double-counting is the main hazard).
- Foreign property (currency/FX) — landlord tool is UK-first today; foreign feed reuses `foreign_rental` + FX but is a later slice.
- MTD IT quarters may be **locked/submitted** — never overwrite a submitted quarter; feed into draft quarters only, warn otherwise.

## Open decisions (need your call before building)

1. **Owner property model** — reconcile `property_owners` with `mtd_it_property_links`, or bridge at feed time? (Recommend: bridge at feed time now; consolidate later.)
2. **Feed granularity** — post per-transaction entries (richest, supports MTD IT review/flags) vs a single summarised entry per category per quarter (simpler, less traceable)? (Recommend: per-transaction.)
3. **Trigger point** — push from the Landlord tool ("Send to MTD IT"), or pull from MTD IT ("Import from Landlord", mirroring the Bookkeeping/co-owner import stubs)? (Recommend: pull from MTD IT, reusing the existing import UX.)
4. **SA snapshot now or defer** — persist `sa_property_figures` on save, or compute on demand when the SA tool exists? (Recommend: defer.)

## Phasing

1. **Reconciliation + dedupe migration** — source/source_ref on `mtd_it_entries`; owner→mtd_it_property bridge helper.
2. **Feed A core** — per-owner, per-quarter entry builder (raw income/expenses, capital excluded, finance included, per-owner share), idempotent by source.
3. **Feed A UX** — import/preview modal (reuse co-owner pattern), warnings, locked-quarter guard.
4. **Feed B** — SA read contract (+ optional snapshot) once the SA tool starts.

## Rough effort

Feed A (phases 1–3): a substantial multi-day piece — new migration, a
distribution/quarter-mapping service, and an import/preview flow, plus careful
idempotency and reconciliation. Feed B is small on its own but gated on the SA
tool existing. Recommend building Feed A first (immediate value for MTD IT
clients), Feed B alongside the SA tool.
