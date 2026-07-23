// Server-side only — Companies House XML Gateway client for accounts filing.
//
// Builds the GovTalk envelope, computes the CHMD5 authentication token, POSTs the
// submission to the gateway and parses the GovTalk response. This is the ONE
// place the wire format lives, so corrections after the first CH validation
// round-trip land in a single file.
//
// ── Envelope shape (GovTalk + FormSubmission) ────────────────────────────────
// <GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
//   <EnvelopeVersion>1.0</EnvelopeVersion>
//   <Header>
//     <MessageDetails>
//       <Class>Accounts</Class>
//       <Qualifier>request</Qualifier>
//       <TransactionID>{unique numeric}</TransactionID>
//       <GatewayTest>1</GatewayTest>
//     </MessageDetails>
//     <SenderDetails>
//       <IDAuthentication>
//         <SenderID>{presenter id}</SenderID>
//         <Authentication>
//           <Method>CHMD5</Method>
//           <Value>{md5(senderId + authValue + transactionId)}</Value>
//         </Authentication>
//       </IDAuthentication>
//     </SenderDetails>
//   </Header>
//   <GovTalkDetails><Keys/></GovTalkDetails>
//   <Body>
//     <FormSubmission xmlns="http://xmlgw.companieshouse.gov.uk/Header" ...>
//       <FormHeader>… CompanyAuthenticationCode, PackageReference, FormIdentifier=Accounts, SubmissionNumber …</FormHeader>
//       <DateSigned/><Form/>
//       <Document><Data>{base64 iXBRL}</Data><Date/><Filename/><ContentType>application/xml</ContentType><Category>ACCOUNTS</Category></Document>
//     </FormSubmission>
//   </Body>
// </GovTalkMessage>
//
// ── Software Filing authentication (CONFIRMED against CH TIS v5.3) ────────────
// The Software Filing (accounts) service hashes BOTH credentials independently
// with the lowercase MD5 algorithm — it does NOT concatenate them, and the
// TransactionID plays no part in authentication (it is only a tracking id):
//   <SenderID>          = md5(Presenter_ID)               ("Software Filing user_id")
//   <Authentication>
//     <Method>          = clear                           (TIS: "the only allowed value is 'clear'")
//     <Value>           = md5(Presenter Authentication Code)
// (The senderId+password+transactionId "CHMD5" recipe is Companies House's DATA
// gateway, a different service — using it here returns 502 Authorisation Failure.)
//
// ── Schema-validated 2026-07-22 ──────────────────────────────────────────────
// The generated envelope validates CLEAN (offline, via xmlschema) against BOTH
// Companies House schemas: the GovTalk envelope (Egov_ch-v2-0.xsd) and the
// FormSubmission body (FormSubmission-v2-11.xsd). Confirmed there: CompanyType
// enum (EW/SC/NI/R/OC/SO/NC), SubmissionNumber = exactly 6 chars, CompanyNumber =
// integer/digits-only, Filename ≤ 32 chars, ContentType application/xml, Category
// ACCOUNTS, CustomerReference optional.
//
// ⚠ REMAINING unknown is CH's BUSINESS-rule layer (not schema): mandatory iXBRL
// content per accounts type, whether the dummy auth code is accepted in test,
// etc. The first test submission's response is the oracle for those.

import { createHash } from 'crypto';
import {
  CH_XMLGW_URL, CH_GATEWAY_TEST_FLAG, chPresenterId, chAuthValue, chPackageReference,
} from './config';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const ENVELOPE_NS = 'http://www.govtalk.gov.uk/CM/envelope';
const FORM_NS = 'http://xmlgw.companieshouse.gov.uk/Header';
const FORM_SCHEMA = 'http://xmlgw.companieshouse.gov.uk/v1-0/schema/forms/FormSubmission-v2-11.xsd';

/** XML-escape text content / attribute values. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lowercase MD5 hex — the Software Filing credential hash (TIS v5.3). */
export function md5Lower(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

export interface ChSubmissionInput {
  /** The iXBRL accounts document (raw XHTML string). */
  ixbrl: string;
  companyNumber: string;
  companyName: string;
  /** CH FormSubmission company-type code. ⚠ enum to confirm against the schema. */
  companyType: string;
  /** Per-company authentication code (from the client / CH). */
  companyAuthCode: string;
  /** Unique, incremental submission number (from ch_gateway_submission_seq). */
  submissionNumber: string;
  /** Unique numeric transaction id (nonce for the auth hash). */
  transactionId: string;
  contactName: string;
  contactNumber: string;
  /** yyyy-mm-dd — date the accounts were approved/signed. */
  dateSigned: string;
  filename: string;
}

/** Build the full GovTalk submission envelope for an accounts filing. */
export function buildSubmissionEnvelope(input: ChSubmissionInput): string {
  // Software Filing auth (TIS v5.3): SenderID = md5(presenter id), Value =
  // md5(presenter auth code), Method 'clear'. NOT concatenated, no transaction id.
  const senderId = md5Lower(chPresenterId());
  const authToken = md5Lower(chAuthValue());
  const data = Buffer.from(input.ixbrl, 'utf8').toString('base64');
  const pkgRef = chPackageReference();

  const formHeader = [
    `<CompanyNumber>${esc(input.companyNumber)}</CompanyNumber>`,
    // CompanyType: EW/SC/NI/R/OC/SO/NC (see chCompanyType). Schema-validated.
    `<CompanyType>${esc(input.companyType)}</CompanyType>`,
    `<CompanyName>${esc(input.companyName)}</CompanyName>`,
    `<CompanyAuthenticationCode>${esc(input.companyAuthCode)}</CompanyAuthenticationCode>`,
    pkgRef ? `<PackageReference>${esc(pkgRef)}</PackageReference>` : '',
    `<Language>EN</Language>`,
    `<FormIdentifier>Accounts</FormIdentifier>`,
    `<SubmissionNumber>${esc(input.submissionNumber)}</SubmissionNumber>`,
    `<ContactName>${esc(input.contactName)}</ContactName>`,
    `<ContactNumber>${esc(input.contactNumber)}</ContactNumber>`,
  ].filter(Boolean).join('');

  return `${XML_DECL}
<GovTalkMessage xmlns="${ENVELOPE_NS}">
  <EnvelopeVersion>1.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>Accounts</Class>
      <Qualifier>request</Qualifier>
      <TransactionID>${esc(input.transactionId)}</TransactionID>
      <GatewayTest>${CH_GATEWAY_TEST_FLAG}</GatewayTest>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>${senderId}</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Value>${authToken}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>
  <GovTalkDetails>
    <Keys/>
  </GovTalkDetails>
  <Body>
    <FormSubmission xmlns="${FORM_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${FORM_NS} ${FORM_SCHEMA}">
      <FormHeader>${formHeader}</FormHeader>
      <DateSigned>${esc(input.dateSigned)}</DateSigned>
      <Form/>
      <Document>
        <Data>${data}</Data>
        <Date>${esc(input.dateSigned)}</Date>
        <Filename>${esc(input.filename)}</Filename>
        <ContentType>application/xml</ContentType>
        <Category>ACCOUNTS</Category>
      </Document>
    </FormSubmission>
  </Body>
</GovTalkMessage>`;
}

// ── Response parsing ─────────────────────────────────────────────────────────
// The gateway replies with a GovTalkMessage whose <Qualifier> is 'acknowledgement'
// (accepted for processing — poll for the outcome), 'response' (final), or
// 'error' (rejected). We extract just enough to drive the UI + audit log without
// pulling in an XML parser dependency.

export interface ChGatewayResult {
  ok: boolean;
  /** 'submitted' (ack), 'accepted', 'rejected', or 'error'. */
  status: 'submitted' | 'accepted' | 'rejected' | 'error';
  qualifier: string | null;
  correlationId: string | null;
  /** Human-readable message (first error text, or a summary). */
  message: string;
  /** Raw response body for the audit log. */
  raw: string;
  httpStatus: number;
}

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

/** Pull every GovTalk <Error> block's <Text> into one message. */
function extractErrors(xml: string): string {
  const errors: string[] = [];
  const re = /<(?:\w+:)?Error\b[\s\S]*?<\/(?:\w+:)?Error>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = firstTag(m[0], 'Text') ?? firstTag(m[0], 'Number');
    if (text) errors.push(text);
  }
  return errors.join(' · ');
}

export function parseGatewayResponse(raw: string, httpStatus: number): ChGatewayResult {
  const qualifier = firstTag(raw, 'Qualifier');
  const correlationId = firstTag(raw, 'CorrelationID');
  const q = (qualifier ?? '').toLowerCase();

  if (q === 'error' || httpStatus < 200 || httpStatus >= 300) {
    const message = extractErrors(raw) || `Companies House rejected the submission (HTTP ${httpStatus}).`;
    return { ok: false, status: 'rejected', qualifier, correlationId, message, raw, httpStatus };
  }
  if (q === 'acknowledgement') {
    return { ok: true, status: 'submitted', qualifier, correlationId,
      message: 'Accepted by the gateway for processing. Companies House review test submissions manually.', raw, httpStatus };
  }
  if (q === 'response') {
    return { ok: true, status: 'accepted', qualifier, correlationId, message: 'Accepted by Companies House.', raw, httpStatus };
  }
  // Unknown qualifier — surface the raw for inspection rather than guessing.
  const errs = extractErrors(raw);
  return { ok: !errs, status: errs ? 'rejected' : 'submitted', qualifier, correlationId,
    message: errs || 'Submitted — awaiting Companies House response.', raw, httpStatus };
}

/** POST an envelope to the gateway and parse the response. */
export async function submitToGateway(envelope: string): Promise<ChGatewayResult> {
  let res: Response;
  try {
    res = await fetch(CH_XMLGW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: envelope,
    });
  } catch (e) {
    return {
      ok: false, status: 'error', qualifier: null, correlationId: null,
      message: e instanceof Error ? `Could not reach the Companies House gateway: ${e.message}` : 'Could not reach the Companies House gateway.',
      raw: '', httpStatus: 0,
    };
  }
  const raw = await res.text();
  return parseGatewayResponse(raw, res.status);
}
