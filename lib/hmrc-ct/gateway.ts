// Server-side only — HMRC Transaction Engine (GovTalk) client for CT600.
//
// Same GovTalk dialect as lib/hmrc-sa/gateway.ts (request → acknowledgement →
// poll → response/error, CorrelationID, PollInterval). Differences from SA100:
// Class HMRC-CT-CT600, and the <IRenvelope> body is the CompanyTaxReturn (with
// its embedded iXBRL attachments) instead of the SA100 return. The GovTalk
// response parsing is provider-agnostic, so it is reused from the SA client.
//
// ⚠ The exact Header ordering / auth Role / ChannelRouting shape are PROVISIONAL
// until validated against HMRC's CT test service — the first response is the
// oracle, mirroring how the SA gateway was built.

import {
  CT_CLASS, CT_PRODUCT, ctGatewayUrl, ctGatewayTestFlag, ctSenderId, ctPassword,
  ctVendorId, ctProductVersion, type CtCreds,
} from './config';
import { parseGatewayResponse, type SaGatewayResult } from '../hmrc-sa/gateway';

/** GovTalk gateway result (the parser is shared with SA100). */
export type CtGatewayResult = SaGatewayResult;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const ENVELOPE_NS = 'http://www.govtalk.gov.uk/CM/envelope';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Credentials are threaded in per-firm (Phase E: getCtCredsForFirm); when omitted
// they fall back to the env getters (single-firm internal pilot).

/** SenderDetails / IDAuthentication — identical across request/poll/delete. */
function senderDetailsXml(creds?: CtCreds): string {
  const senderId = creds?.senderId ?? ctSenderId();
  const password = creds?.password ?? ctPassword();
  return `<SenderDetails>
      <IDAuthentication>
        <SenderID>${esc(senderId)}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Role>principal</Role>
          <Value>${esc(password)}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>`;
}

function govTalkDetailsXml(utr: string, creds?: CtCreds): string {
  const vendorId = creds?.vendorId ?? ctVendorId();
  return `<GovTalkDetails>
    <Keys>
      <Key Type="UTR">${esc(utr)}</Key>
    </Keys>
    <ChannelRouting>
      <Channel>
        <URI>${esc(vendorId)}</URI>
        <Product>${esc(CT_PRODUCT)}</Product>
        <Version>${esc(ctProductVersion())}</Version>
      </Channel>
    </ChannelRouting>
  </GovTalkDetails>`;
}

/** Build the full submission envelope. `submissionBody` is the `<Body>…</Body>`
 *  produced by markIrEnvelope() (IRmark already filled in). */
export function buildSubmissionEnvelope(submissionBody: string, utr: string, creds?: CtCreds): string {
  return `${XML_DECL}
<GovTalkMessage xmlns="${ENVELOPE_NS}">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>${CT_CLASS}</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <Transformation>XML</Transformation>
      <GatewayTest>${ctGatewayTestFlag()}</GatewayTest>
    </MessageDetails>
    ${senderDetailsXml(creds)}
  </Header>
  ${govTalkDetailsXml(utr, creds)}
  ${submissionBody}
</GovTalkMessage>`;
}

/** A poll or delete request — Body is empty; CorrelationID identifies the job. */
function buildControlEnvelope(qualifier: 'poll' | 'delete', correlationId: string, creds?: CtCreds): string {
  return `${XML_DECL}
<GovTalkMessage xmlns="${ENVELOPE_NS}">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>${CT_CLASS}</Class>
      <Qualifier>${qualifier}</Qualifier>
      <Function>submit</Function>
      <CorrelationID>${esc(correlationId)}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTest>${ctGatewayTestFlag()}</GatewayTest>
    </MessageDetails>
    ${senderDetailsXml(creds)}
  </Header>
  <GovTalkDetails><Keys/></GovTalkDetails>
  <Body/>
</GovTalkMessage>`;
}

export const buildPollEnvelope = (correlationId: string, creds?: CtCreds) => buildControlEnvelope('poll', correlationId, creds);
export const buildDeleteEnvelope = (correlationId: string, creds?: CtCreds) => buildControlEnvelope('delete', correlationId, creds);

/** POST an envelope to the Transaction Engine and parse the response. */
export async function submitToGateway(envelope: string, endpoint?: string): Promise<CtGatewayResult> {
  let res: Response;
  try {
    res = await fetch(endpoint || ctGatewayUrl(), {
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

export const pollGateway = (correlationId: string, endpoint?: string, creds?: CtCreds) => submitToGateway(buildPollEnvelope(correlationId, creds), endpoint);
export const deleteFromGateway = (correlationId: string, endpoint?: string, creds?: CtCreds) => submitToGateway(buildDeleteEnvelope(correlationId, creds), endpoint);
