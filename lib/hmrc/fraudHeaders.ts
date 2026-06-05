// Server-side — builds HMRC fraud-prevention headers (Gov-Client-* / Gov-Vendor-*).
//
// Connection method is WEB_APP_VIA_SERVER: the user drives a browser, and the
// call to HMRC is made from our server. So some values are collected in the
// BROWSER (device id, timezone, screens, window size, user-agent, do-not-track,
// local IPs) and sent to us as `ClientFraudData`; the rest the server knows
// (the user's public IP from the request, vendor identity).
//
// Sandbox doesn't reject submissions for imperfect headers, but we send a
// complete set so the same code passes HMRC's "Test Fraud Prevention Headers"
// API before production. See lib/hmrc/clientFraudData.ts for the collector.

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

export function buildFraudHeaders(req: NextRequest, fd: ClientFraudData): Record<string, string> {
  const now = new Date().toISOString();
  const ip = clientPublicIp(req);
  const enc = encodeURIComponent;
  const productName = 'SMITH';
  const version = process.env.HMRC_VENDOR_VERSION ?? '1.0.0';

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
  };

  if (fd.localIPs && fd.localIPs.length > 0) {
    headers['Gov-Client-Local-IPs'] = fd.localIPs.join(',');
    headers['Gov-Client-Local-IPs-Timestamp'] = now;
  }

  if (ip) {
    headers['Gov-Client-Public-IP'] = ip;
    headers['Gov-Client-Public-IP-Timestamp'] = now;
    // Hop chain: by = the server that forwarded to HMRC, for = the user's device.
    // In a single-hop setup we only reliably know the user's public IP.
    headers['Gov-Vendor-Forwarded'] = `by=${enc(ip)}&for=${enc(ip)}`;
  }

  return headers;
}
