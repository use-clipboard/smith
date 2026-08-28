// XML building helpers for the CT600 GovTalk submission.
//
// The generic element/group/escaping/money/date helpers are shared with the
// SA100 builder (lib/hmrc-sa/xml.ts) — re-exported here so the CT builders import
// only from within lib/hmrc-ct, and any CT-specific helper can be added alongside
// without touching the SA side.
//
// ⚠ Element NAMES and structure in ct600Return.ts are PROVISIONAL until validated
// against the official CT600 schema pack (Phase A / test-in-live). This file and
// ct600Return.ts are the single place first-round HMRC corrections land, mirroring
// how lib/hmrc-sa was built and then schema-validated.

export {
  esc,
  el,
  group,
  flag,
  yesno,
  clip,
  digitsOnly,
  telephone,
  isoDate,
  sumField,
  money2,
  moneyDown,
  moneyUp,
  poundsDown,
  poundsUp,
} from '../hmrc-sa/xml';
