// Server-side — builds HMRC fraud-prevention headers (Gov-Client-* / Gov-Vendor-*).
//
// Connection method is WEB_APP_VIA_SERVER: the user drives a browser, and the
// call to HMRC is made from our server. So some values are collected in the
// BROWSER (device id, timezone, screens, window size, user-agent, do-not-track,
// local IPs) and sent to us as `ClientFraudData`; the rest the server knows
// (the user's public IP from the request, our internal user id, our server's
// egress IP, vendor identity).
//
// The exact header set below was validated against HMRC's Test Fraud Prevention
// Headers API (spec 3.3) — it returns POTENTIALLY_INVALID_HEADERS with only the
// `gov-client-multi-factor` warning, which is acceptable for single-factor
// (username/password) auth and is declared to HMRC on the approval checklist.
// Known production limitation: Gov-Client-Public-Port is unavailable behind a
// serverless edge (the user's TCP source port is lost) — also declared to HMRC.

import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';

export interface ClientFraudData {
  deviceId: string;
  /** Date.getTimezoneOffset() — minutes BEHIND UTC (UTC+1 → -60). */
  timezoneOffsetMinutes: number;
  screenWidth: number;
  screenHeight: number;
  colourDepth: number;
  scalingFactor: number;
  windowWidth: number;
  windowHeight: number;
  userAgent: string;
  doNotTrack: boolean;
  localIPs: string[];
}

export interface FraudHeaderOpts {
  /** Our internal user id → Gov-Client-User-IDs (`SMITH=<id>`). */
  userId?: string;
  /** Our server's public egress IP → Gov-Vendor-Public-IP. Falls back to the
   *  HMRC_VENDOR_PUBLIC_IP env var. Use resolveVendorPublicIp() to obtain it. */
  vendorPublicIp?: string;
}

function formatTz(offsetMinutes: number): string {
  const total = -offsetMinutes; // minutes ahead of UTC
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function clientPublicIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '';
}

// HMRC requires Gov-Vendor-License-IDs values to be HASHED (SHA-256 hex). With
// no per-device licence in a SaaS, we hash a stable product licence identifier.
function licenseHeader(): string {
  const id = process.env.HMRC_VENDOR_LICENSE_ID ?? 'smith-internal-licence';
  return `SMITH=${createHash('sha256').update(id).digest('hex')}`;
}

// Our server's outbound public IP (Gov-Vendor-Public-IP). Env first (set this in
// production to the static egress IP); otherwise fetched once from an IP echo
// and cached per warm instance.
let _cachedVendorIp: string | null = null;
export async function resolveVendorPublicIp(): Promise<string> {
  if (process.env.HMRC_VENDOR_PUBLIC_IP) return process.env.HMRC_VENDOR_PUBLIC_IP;
  if (_cachedVendorIp) return _cachedVendorIp;
  try {
    const r = await fetch('https://api.ipify.org?format=text', { cache: 'no-store' });
    const ip = (await r.text()).trim();
    if (/^[0-9a-fA-F.:]+$/.test(ip)) { _cachedVendorIp = ip; return ip; }
  } catch { /* unavailable — header omitted, validator will flag it */ }
  return '';
}

export function buildFraudHeaders(req: NextRequest, fd: ClientFraudData, opts: FraudHeaderOpts = {}): Record<string, string> {
  const now = new Date().toISOString();
  const ip = clientPublicIp(req);
  const enc = encodeURIComponent;
  const productName = 'SMITH';
  const version = process.env.HMRC_VENDOR_VERSION ?? '1.0.0';
  const vendorIp = opts.vendorPublicIp || process.env.HMRC_VENDOR_PUBLIC_IP || '';

  const headers: Record<string, string> = {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Device-ID': fd.deviceId,
    'Gov-Client-Timezone': formatTz(fd.timezoneOffsetMinutes),
    'Gov-Client-Screens': `width=${fd.screenWidth}&height=${fd.screenHeight}&scaling-factor=${fd.scalingFactor}&colour-depth=${fd.colourDepth}`,
    'Gov-Client-Window-Size': `width=${fd.windowWidth}&height=${fd.windowHeight}`,
    'Gov-Client-Browser-JS-User-Agent': fd.userAgent,
    'Gov-Client-Browser-Do-Not-Track': fd.doNotTrack ? 'true' : 'false',
    'Gov-Vendor-Product-Name': enc(productName),
    'Gov-Vendor-Version': `${productName}=${enc(version)}`,
    'Gov-Vendor-License-IDs': licenseHeader(),
  };

  // The signed-in user's id in our system. Required header.
  if (opts.userId) headers['Gov-Client-User-IDs'] = `${productName}=${enc(opts.userId)}`;

  if (fd.localIPs && fd.localIPs.length > 0) {
    headers['Gov-Client-Local-IPs'] = fd.localIPs.join(',');
    headers['Gov-Client-Local-IPs-Timestamp'] = now;
  }

  if (ip) {
    headers['Gov-Client-Public-IP'] = ip;
    headers['Gov-Client-Public-IP-Timestamp'] = now;
    // Hop chain: by = the server that forwarded to HMRC, for = the user's device.
    headers['Gov-Vendor-Forwarded'] = `by=${enc(vendorIp || ip)}&for=${enc(ip)}`;
  }

  // Our server's own public IP. Required header for WEB_APP_VIA_SERVER.
  if (vendorIp) headers['Gov-Vendor-Public-IP'] = vendorIp;

  return headers;
}
