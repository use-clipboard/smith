// Facsimile of HMRC's SA108 Capital Gains Tax summary — 4 pages (CG1–CG4), in
// the teal theme, bound box-for-box to Sa108 (see types.ts for the box map).

import type React from 'react';
import type { TaxReturn, Sa108 } from '../types';
import {
  FormThemeContext, TEAL_THEME, TEAL, CELL, Page, SuppHead, Note, SubHead, Panel, Money, Cells, Tick, Label, InfoDot,
} from './formPrimitives';

// Section title, e.g. "Residential property and carried interest – Please read…".
function Head({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return <p className="mb-1.5 mt-1 text-[15px] font-normal text-black">{children}{sub && <span className="text-[11px]"> – {sub}</span>}</p>;
}
// Teal band used for the grouped "Losses and adjustments" sub-sections.
function Band({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[13px] font-bold" style={{ color: TEAL }}>{children}</p>;
}
function NotInUse({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
}
// "Number of disposals" style count box: 5 plain cells, no £.
function Count({ n, label, value }: { n: React.ReactNode; label: string; value?: number }) {
  return <Cells n={n} label={label} groups={[5]} value={value ? String(value) : ''} />;
}
// Claim / election code: 3 plain cells.
function Code({ n, label, value }: { n: React.ReactNode; label: string; value?: string }) {
  return <Cells n={n} label={label} groups={[3]} value={value} />;
}

export default function CapitalGainsFacsimile({ ret }: { ret: TaxReturn }) {
  const s: Sa108 = ret.income.sa108 ?? {};

  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── CG 1 ── */}
      <Page tag="CG 1" code="SA108">
        <SuppHead title="Capital Gains Tax summary" name={ret.clientName} utr={ret.utr ?? undefined} />
        <p className="mb-2 flex items-start text-[10.5px] text-black"><InfoDot /> You must enclose your computations, including details of each gain or loss, as well as filling in the boxes.</p>
        <Head sub="Please read the notes before filling in this section.">Residential property and carried interest</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Count n={3} label="Number of disposals" value={s.resiDisposals} />
              <Money n={4} label="Disposal proceeds" value={s.resiProceeds} />
              <Money n={5} label="Allowable costs (including purchase price)" value={s.resiCosts} />
              <Money n={6} label="Gains on residential property in the year, before losses – do not include gains on carried interest. Any gains on residential property included in boxes 9 and 11 amounts must be included in this total" value={s.resiGains} />
              <Money n="6.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.resiFig} />
              <Money n={7} label="Losses in the year – any losses included in boxes 9 and 11 amounts must be included in this total" value={s.resiLosses} />
              <Code n={8} label="If you’re making any claim or election, put the relevant code in the box" value={s.resiClaimCode} />
              <Money n={9} label="Total gains or losses on UK residential property reported on Capital Gains Tax UK Property Disposal returns" value={s.resiPptGains} minus />
            </div>
            <div>
              <Money n={10} label="Tax on gains in box 9 already charged" value={s.resiPptTaxCharged} />
              <Money n={11} label="Total gains or losses on non-UK residential property or carried interest reported on Real Time Transaction returns" value={s.resiOverallGain} minus />
              <Money n={12} label="Tax on gains in box 11 already paid" value={s.resiOverallTaxPaid} />
              <Money n={13} label="Carried interest (arising basis) – the amount before any claim or election" value={s.carriedInterestArising} />
              <Money n="13A" label="Carried interest (accruals basis) – the amount before any claim or election" value={s.carriedInterestAccruals} />
              <Money n="13B" label="Gains on carried interest in the year – the sum of boxes 13 and 13A, less any claim or election. Any gains on carried interest included in box 11 amounts must be included in this total" value={s.carriedInterestGains} />
              <Money n="13C" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.carriedInterestFig} />
            </div>
          </div>
        </Panel>
        <Head sub="Please read the notes before filling in this section.">Cryptoassets</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Count n="13.1" label="Number of disposals" value={s.cryptoDisposals} />
              <Money n="13.2" label="Disposal proceeds" value={s.cryptoProceeds} />
              <Money n="13.3" label="Allowable costs (including purchase price)" value={s.cryptoCosts} />
              <Money n="13.4" label="Gains in the year, before losses – any gains included in box 13.7 amounts must be included in this total" value={s.cryptoGains} />
            </div>
            <div>
              <Money n="13.5" label="Losses in the year – any losses included in box 13.7 amounts must be included in this total" value={s.cryptoLosses} />
              <Code n="13.6" label="If you’re making any claim or election, put the relevant code in the box" value={s.cryptoClaimCode} />
              <Money n="13.7" label="Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns" value={s.cryptoRtt} minus />
              <Money n="13.8" label="Tax on gains in box 13.7 already paid" value={s.cryptoRttTaxPaid} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── CG 2 ── */}
      <Page tag="CG 2" code="SA108">
        <Head>Other property, assets and gains <span className="text-[11px]">– Gains where Business Assets Disposal Relief (BADR) is being claimed should be included in this section. Please read the notes before filling in this section.</span></Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Count n={14} label="Number of disposals" value={s.otherDisposals} />
              <Money n={15} label="Disposal proceeds" value={s.otherProceeds} />
              <Money n={16} label="Allowable costs (including purchase price)" value={s.otherCosts} />
              <Money n={17} label="Gains in the year, before losses – any gains included in box 21 amounts must be included in this total" value={s.otherGains} />
              <Money n="17.0" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.otherFig} />
              <Money n="17.1" label="Enter the amount included in box 17 total relating to disposals of non-residential land and buildings" value={s.otherNonResiLand} />
              <p className="mb-2 text-[9.5px] leading-snug text-black">In boxes 17.2 to 17.4, enter the amounts in the box 17 total that relate to a disposal where BADR is being claimed as advised in the guidance notes.</p>
              <Money n="17.2" label="Residential property and non-residential land and buildings" value={s.otherBadrResiLand} />
            </div>
            <div>
              <Money n="17.3" label="Listed and unlisted shares and securities" value={s.otherBadrShares} />
              <Money n="17.4" label="Other assets" value={s.otherBadrOther} />
              <NotInUse>Box 18 is not in use</NotInUse>
              <Money n={19} label="Losses in the year – any losses included in box 21 amounts must be included in this total" value={s.otherLosses} />
              <Code n={20} label="If you’re making any claim or election, put the relevant code in the box" value={s.otherClaimCode} />
              <Money n={21} label="Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns" value={s.otherRtt} minus />
              <Money n={22} label="Tax on gains in box 21 already paid" value={s.otherRttTaxPaid} />
            </div>
          </div>
        </Panel>
        <Head sub="Please read the notes before filling in this section.">Listed shares and securities</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Count n={23} label="Number of disposals" value={s.listedDisposals} />
              <Money n={24} label="Disposal proceeds" value={s.listedProceeds} />
              <Money n={25} label="Allowable costs (including purchase price)" value={s.listedCosts} />
              <Money n={26} label="Gains in the year, before losses – any gains included in box 29 amounts must be included in this total" value={s.listedGains} />
              <Money n="26.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.listedFig} />
            </div>
            <div>
              <Money n={27} label="Losses in the year – any losses included in box 29 amounts must be included in this total" value={s.listedLosses} />
              <Code n={28} label="If you’re making any claim or election, put the relevant code in the box" value={s.listedClaimCode} />
              <Money n={29} label="Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns" value={s.listedRtt} minus />
              <Money n={30} label="Tax on gains in box 29 already paid" value={s.listedRttTaxPaid} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── CG 3 ── */}
      <Page tag="CG 3" code="SA108">
        <Head sub="Please read the notes before filling in this section.">Unlisted shares and securities</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Count n={31} label="Number of disposals" value={s.unlistedDisposals} />
              <Money n={32} label="Disposal proceeds" value={s.unlistedProceeds} />
              <Money n={33} label="Allowable costs (including purchase price)" value={s.unlistedCosts} />
              <Money n={34} label="Gains in the year, before losses – any gains included in box 37 amounts must be included in this total" value={s.unlistedGains} />
              <Money n="34.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.unlistedFig} />
              <Money n={35} label="Losses in the year – any losses included in box 37 amounts must be included in this total" value={s.unlistedLosses} />
              <Code n={36} label="If you’re making any claim or election, put the relevant code in the box" value={s.unlistedClaimCode} />
              <Money n={37} label="Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns" value={s.unlistedRtt} minus />
            </div>
            <div>
              <Money n={38} label="Tax on gains in box 37 already paid" value={s.unlistedRttTaxPaid} />
              <Money n={39} label="Gains exceeding the lifetime limit for employee shareholder status shares" value={s.essExceedingLimit} />
              <Money n={40} label="Gains invested under Seed Enterprise Investment Scheme and qualifying for relief" value={s.seisReinvestment} />
              <Money n={41} label="Losses used against income – amount claimed against 2025–26 income" value={s.lossesUsedAgainstIncome1} />
              <Money n={42} label="Amount in box 41 relating to share loss relief in 2025–26 to which Enterprise Investment Scheme or Seed Enterprise Investment Scheme Relief is attributable" value={s.shareLossRelief1} />
              <Money n={43} label="Losses used against income – amount claimed against 2024–25 income" value={s.lossesUsedAgainstIncome2} />
              <Money n={44} label="Amount in box 43 relating to share loss relief in 2024–25 to which Enterprise Investment Scheme or Seed Enterprise Investment Scheme Relief is attributable" value={s.shareLossRelief2} />
            </div>
          </div>
        </Panel>
        <Head sub="Please read the notes before filling in this section.">Losses and adjustments</Head>
        <Panel>
          <Band>Losses set against 2025–26 capital gains</Band>
          <div className="grid grid-cols-2 gap-x-10">
            <Money n={45} label="Losses brought forward and used in-year" value={s.lossesBfUsed} />
            <Money n={46} label="Income losses of 2025–26 set against gains" value={s.incomeLossesSetAgainst} />
          </div>
        </Panel>
        <Panel>
          <Band>2025–26 capital losses – other information</Band>
          <div className="grid grid-cols-2 gap-x-10">
            <Money n={47} label="Losses available to be carried forward" value={s.lossesCarriedForward} />
            <Money n={48} label="Losses used against an earlier year’s gain" value={s.lossesUsedEarlierYear} />
          </div>
        </Panel>
        <Panel>
          <Band>Investors’ Relief and Business Asset Disposal Relief (previously ‘Entrepreneurs’ Relief’)</Band>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={49} label="Gains qualifying for Investors’ Relief" value={s.erGainsPre2010} />
              <Money n={50} label="Gains qualifying for Business Asset Disposal Relief" value={s.badrGains} />
            </div>
            <Money n="50.1" label="Lifetime allowance of Business Asset Disposal Relief and Entrepreneurs’ Relief claimed – the total amount claimed to date" value={s.badrLifetimeClaimed} />
          </div>
        </Panel>
      </Page>

      {/* ── CG 4 ── */}
      <Page tag="CG 4" code="SA108">
        <div className="flex h-full flex-col">
          <Panel>
            <Band>Tax adjustments to 2025–26 capital gains</Band>
            <div className="grid grid-cols-2 gap-x-10">
              <Money n={51} label="Adjustments to Capital Gains Tax" value={s.cgtAdjustments} minus />
              <Money n={52} label="Additional liability for non-resident or dual resident trusts" value={s.nonResTrustLiability} />
            </div>
          </Panel>
          <Head sub="Please read the notes before filling in this section.">Non-resident Capital Gains Tax (NRCGT) on UK property or land and indirect disposals</Head>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <Money n="52.1" label="For direct disposals of UK residential property or properties, put the total gains chargeable to NRCGT in the box" value={s.nrcgtResiProperty} />
                <Money n="52.2" label="For direct disposals of non-residential UK properties or land, or indirect disposals of any UK properties or land, put the total gains chargeable to NRCGT in the box" value={s.nrcgtNonResiProperty} />
              </div>
              <div>
                <div className="mb-3"><Label n="52.3">If any of the gains in box 52.2 are from indirect disposals, put ‘X’ in the box</Label><Tick on={!!s.nrcgtIndirect} /></div>
                <Money n="52.4" label="Tax on gains in boxes 52.1 and 52.2 already charged" value={s.nrcgtTaxCharged} />
                <Money n="52.5" label="Total losses available against NRCGT gains for the year" value={s.nrcgtLosses} />
              </div>
            </div>
          </Panel>
          <Head>Gains on excluded indexed securities and gains and losses on share repurchases and security redemptions from a qualifying asset holding company (QAHC)</Head>
          <Note>Please read the notes before filling in this section.</Note>
          <Note>Details of any gains or losses in this section should already be included in the relevant sections on pages CG2 and CG3.</Note>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <Money n="52EG" label="Total gains from the disposal of excluded indexed securities – the amount before losses and reliefs" value={s.eisExcludedSecurities} />
                <Money n="52EG.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.eisExcludedFig} />
              </div>
              <div>
                <Money n="52QG" label="Total gains from QAHC share repurchases and security redemptions – the amount before losses and reliefs" value={s.qahcGains} />
                <Money n="52QG.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={s.qahcGainsFig} />
                <Money n="52QL" label="Total losses from QAHC share repurchases and security redemptions" value={s.qahcLosses} />
              </div>
            </div>
          </Panel>
          <Head>Any other information</Head>
          <div className="mb-2"><Label n={53}>If your computations include any estimates or valuations, put ‘X’ in the box</Label><Tick on={!!s.estimatesOrValuations} /></div>
          <div className="flex flex-1 flex-col">
            <Label n={54}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{s.otherInformation}</div>
          </div>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
