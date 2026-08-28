// Accounts iXBRL for the CT600 submission (Phase C).
//
// The statutory-accounts iXBRL attached to a CT600 is the SAME document Accounts
// Studio already produces for Companies House filing — we must not file one set
// of accounts with CH and a different tagging with HMRC. So this is a thin bridge
// over the single Accounts Studio mapper (lib/accounts-studio/ixbrlFromEngagement),
// re-exported here so the CT filing code imports only from within lib/hmrc-ct.
//
// Sourcing the Engagement for a given company + accounting period is the caller's
// job (the ct-submit route, Phase E): find the Accounts Studio engagement whose
// period matches the CT600 accounting period, then call this.

export { buildIxbrlFromEngagement, type IxbrlFirmOptions } from '../accounts-studio/ixbrlFromEngagement';
