// Server-side only — HMRC Transaction Engine (GovTalk) client for legacy SA100.
//
// Same GovTalk dialect as lib/companiesHouse/gateway.ts (request → acknowledgement
// → poll → response/error, CorrelationID, PollInterval), so the envelope builders
// + response parsing mirror it. Differences: EnvelopeVersion 2.0, Class
// HMRC-SA-SA100, Government-Gateway auth (SenderID + clear password), a
// ChannelRouting vendor block, and an <IRenvelope> body carrying the IRmark.
//
// ⚠ The exact Header ordering / auth Role / ChannelRouting shape are PROVISIONAL
// until validated against TPVS (Phase 5) — the first response is the oracle.

import {
  SA_CLASS, SA_PRODUCT, saGatewayUrl, saGatewayTestFlag, saSenderId, saPassword,
  saVendorId, saProductVersion,
} from './config';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const ENVELOPE_NS = 'http://www.govtalk.gov.uk/CM/envelope';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** SenderDetails / IDAuthentication — identical across request/poll/delete. */
function senderDetailsXml(): string {
  return `<SenderDetails>
      <IDAuthentication>
        <SenderID>${esc(saSenderId())}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>${esc(saPassword())}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>`;
}

function govTalkDetailsXml(utr: string): string {
  return `<GovTalkDetails>
    <Keys>
      <Key Type="UTR">${esc(utr)}</Key>
    </Keys>
    <ChannelRouting>
      <Channel>
        <URI>${esc(saVendorId())}</URI>
        <Product>${esc(SA_PRODUCT)}</Product>
        <Version>${esc(saProductVersion())}</Version>
      </Channel>
    </ChannelRouting>
  </GovTalkDetails>`;
}

/** Build the full submission envelope. `submissionBody` is the `<Body>…</Body>`
 *  produced by markIrEnvelope() (IRmark already filled in). */
export function buildSubmissionEnvelope(submissionBody: string, utr: string): string {
  return `${XML_DECL}
<GovTalkMessage xmlns="${ENVELOPE_NS}">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>${SA_CLASS}</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <Transformation>XML</Transformation>
      <GatewayTest>${saGatewayTestFlag()}</GatewayTest>
    </MessageDetails>
    ${senderDetailsXml()}
  </Header>
  ${govTalkDetailsXml(utr)}
  ${submissionBody}
</GovTalkMessage>`;
}

/** A poll or delete request — Body is empty; CorrelationID identifies the job. */
function buildControlEnvelope(qualifier: 'poll' | 'delete', correlationId: string): string {
  return `${XML_DECL}
<GovTalkMessage xmlns="${ENVELOPE_NS}">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>${SA_CLASS}</Class>
      <Qualifier>${qualifier}</Qualifier>
      <Function>submit</Function>
      <CorrelationID>${esc(correlationId)}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTest>${saGatewayTestFlag()}</GatewayTest>
    </MessageDetails>
    ${senderDetailsXml()}
  </Header>
  <GovTalkDetails><Keys/></GovTalkDetails>
  <Body/>
</GovTalkMessage>`;
}

export const buildPollEnvelope = (correlationId: string) => buildControlEnvelope('poll', correlationId);
export const buildDeleteEnvelope = (correlationId: string) => buildControlEnvelope('delete', correlationId);

// ── Response parsing (mirrors the CH gateway) ────────────────────────────────

export interface SaGatewayResult {
  ok: boolean;
  /** 'submitted' (ack — poll), 'accepted' (final response), 'rejected', 'error'. */
  status: 'submitted' | 'accepted' | 'rejected' | 'error';
  qualifier: string | null;
  correlationId: string | null;
  /** Seconds to wait before polling (acknowledgement only). */
  pollSeconds: number | null;
  /** Poll endpoint the gateway tells us to use (ResponseEndPoint), if given. */
  pollEndpoint: string | null;
  message: string;
  raw: string;
  httpStatus: number;
}

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

function extractErrors(xml: string): string {
  const out: string[] = [];
  const re = /<(?:\w+:)?Error\b[\s\S]*?<\/(?:\w+:)?Error>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = firstTag(m[0], 'Text') ?? firstTag(m[0], 'Number');
    if (t) out.push(t);
  }
  return out.join(' · ');
}

export function parseGatewayResponse(raw: string, httpStatus: number): SaGatewayResult {
  const qualifier = firstTag(raw, 'Qualifier');
  const correlationId = firstTag(raw, 'CorrelationID');
  const pollRaw = firstTag(raw, 'PollInterval');
  const pollSeconds = pollRaw && /^\d+$/.test(pollRaw) ? Number(pollRaw) : null;
  const pollEndpoint = firstTag(raw, 'ResponseEndPoint');
  const q = (qualifier ?? '').toLowerCase();
  const base = { qualifier, correlationId, pollSeconds, pollEndpoint, raw, httpStatus };

  if (q === 'error' || httpStatus < 200 || httpStatus >= 300) {
    return { ...base, ok: false, status: 'rejected', message: extractErrors(raw) || `HMRC rejected the submission (HTTP ${httpStatus}).` };
  }
  if (q === 'acknowledgement') {
    return { ...base, ok: true, status: 'submitted', message: 'Accepted by the gateway for processing — polling for the outcome.' };
  }
  if (q === 'response') {
    return { ...base, ok: true, status: 'accepted', message: 'Accepted by HMRC.' };
  }
  const errs = extractErrors(raw);
  return { ...base, ok: !errs, status: errs ? 'rejected' : 'submitted', message: errs || 'Submitted — awaiting HMRC response.' };
}

/** POST an envelope to the Transaction Engine and parse the response. */
export async function submitToGateway(envelope: string, endpoint?: string): Promise<SaGatewayResult> {
  let res: Response;
  try {
    res = await fetch(endpoint || saGatewayUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: envelope,
    });
  } catch (e) {
    return {
      ok: false, status: 'error', qualifier: null, correlationId: null, pollSeconds: null, pollEndpoint: null,
      message: e instanceof Error ? `Could not reach the HMRC gateway: ${e.message}` : 'Could not reach the HMRC gateway.',
      raw: '', httpStatus: 0,
    };
  }
  const raw = await res.text();
  return parseGatewayResponse(raw, res.status);
}

export const pollGateway = (correlationId: string, endpoint?: string) => submitToGateway(buildPollEnvelope(correlationId), endpoint);
export const deleteFromGateway = (correlationId: string, endpoint?: string) => submitToGateway(buildDeleteEnvelope(correlationId), endpoint);
