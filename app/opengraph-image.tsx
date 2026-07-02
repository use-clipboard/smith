import { ImageResponse } from 'next/og';

// Branded Open Graph / Twitter card image, generated at request time. Applies
// as the default social-share image for every route (Next file convention).
export const runtime = 'edge';
export const alt = 'SMITH — The AI workspace for UK accounting firms';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: 'linear-gradient(135deg, #3b3a8c 0%, #4f46e5 55%, #6366f1 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '72px',
              height: '72px',
              borderRadius: '18px',
              background: 'rgba(255,255,255,0.15)',
              fontSize: '40px',
              fontWeight: 800,
            }}
          >
            S
          </div>
          <div style={{ fontSize: '40px', fontWeight: 800, letterSpacing: '-1px' }}>SMITH</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ fontSize: '68px', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-2px' }}>
            The AI workspace for
            <br />
            UK accounting firms
          </div>
          <div style={{ fontSize: '30px', color: 'rgba(255,255,255,0.85)', maxWidth: '900px' }}>
            Bookkeeping, MTD &amp; VAT, accounts review, email triage and client-ready outputs — built
            by accountants, for accountants.
          </div>
        </div>

        <div style={{ fontSize: '26px', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
          smithforaccountants.co.uk
        </div>
      </div>
    ),
    { ...size },
  );
}
