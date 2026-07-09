// Shared authorisation check for Vercel Cron endpoints.
//
// Vercel's scheduler invokes cron paths with a GET request carrying
// `Authorization: Bearer <CRON_SECRET>`. Routes that instead expected a POST
// or a custom header were never actually triggered. Use this helper (and a
// GET handler) so every cron route authorises the same, correct way — matching
// app/api/cron/ch-refresh and the other working crons.
export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[Cron] CRON_SECRET env var not set — allowing request. Set it in Vercel env vars to secure this endpoint.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
