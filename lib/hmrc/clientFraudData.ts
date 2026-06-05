'use client';

// Browser-collected fraud-prevention data for HMRC (WEB_APP_VIA_SERVER). Sent to
// our server, which combines it with the request's public IP to build the
// Gov-Client-* headers. See lib/hmrc/fraudHeaders.ts.

export function collectFraudData() {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('hmrc_device_id') ?? '';
    if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('hmrc_device_id', deviceId); }
  } catch { deviceId = '00000000-0000-4000-8000-000000000000'; }
  const dnt = navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1';
  return {
    deviceId,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    colourDepth: window.screen.colorDepth,
    scalingFactor: window.devicePixelRatio || 1,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    userAgent: navigator.userAgent,
    doNotTrack: !!dnt,
    localIPs: [] as string[],
  };
}

/** HMRC sandbox `Gov-Test-Scenario` options for the VAT obligations endpoint.
 *  Ignored in production. Lets the sandbox return obligations dated relative to
 *  today instead of the static 2017 sample. */
export const HMRC_OBLIGATION_SCENARIOS: { value: string; label: string }[] = [
  { value: '', label: 'Default (HMRC sample data)' },
  { value: 'QUARTERLY_NONE_MET', label: 'Quarterly — none filed' },
  { value: 'QUARTERLY_ONE_MET', label: 'Quarterly — one filed' },
  { value: 'QUARTERLY_TWO_MET', label: 'Quarterly — two filed' },
  { value: 'MONTHLY_NONE_MET', label: 'Monthly — none filed' },
];
