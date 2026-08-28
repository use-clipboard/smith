// IRmark for the CT600 GovTalk submission (Phase D).
//
// The IRmark algorithm is common across HMRC GovTalk services and operates on any
// <IRenvelope> carrying the empty <IRmark Type="generic"></IRmark> slot — which
// ct600Return.ts emits, exactly like sa100Return.ts. So the Arelle/TPVS-proven SA
// implementation is reused verbatim; nothing here is CT-specific.

export { computeIrmark, markIrEnvelope, type IrmarkResult } from '../hmrc-sa/irmark';
