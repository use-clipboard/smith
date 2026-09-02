/** @type {import('next').NextConfig} */
const nextConfig = {
  // tiptap-pagination-plus ships ESM-syntax JS without "type":"module", so let
  // Next transpile it through its own loaders to avoid bundler resolution issues.
  transpilePackages: ['tiptap-pagination-plus'],
  // Headless-Chrome PDF rendering (Tax Studio "Download"): these must stay
  // external (required at runtime from node_modules) so webpack doesn't bundle
  // the chromium binary and Next's output tracing ships it with the function.
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    // Make sure the compressed chromium binary is traced into the PDF route's
    // serverless function (Next's tracer can miss the .br pack otherwise).
    outputFileTracingIncludes: {
      '/api/tax-studio/pdf': ['./node_modules/@sparticuz/chromium/**'],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Security response headers (applied to every route). A full content-
  // restricting Content-Security-Policy is a planned follow-up (needs nonce-based
  // rollout + testing against Next's inline runtime); for now we set the safe,
  // high-value headers plus frame-ancestors for clickjacking protection.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'microphone=(), geolocation=(), browsing-topics=()' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // canvg (pulled in by jspdf) imports `@babel/runtime/regenerator`, but that
    // subpath was removed in @babel/runtime 7.28+. Point it at the standalone
    // `regenerator-runtime` package, which is exactly what it used to re-export.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@babel/runtime/regenerator': 'regenerator-runtime',
    };
    return config;
  },
};

export default nextConfig;
