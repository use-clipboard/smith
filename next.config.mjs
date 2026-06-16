/** @type {import('next').NextConfig} */
const nextConfig = {
  // tiptap-pagination-plus ships ESM-syntax JS without "type":"module", so let
  // Next transpile it through its own loaders to avoid bundler resolution issues.
  transpilePackages: ['tiptap-pagination-plus'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
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
