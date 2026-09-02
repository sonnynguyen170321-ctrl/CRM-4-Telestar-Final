import type { NextConfig } from "next";
import { buildCsp, CSP_HEADER_NAME } from './lib/security/csp';
import bundleAnalyzer from "@next/bundle-analyzer";

// Security headers applied to every response. HSTS is harmless over plain HTTP (browsers
// ignore it) and enforced once the app is served over TLS behind the load balancer.
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Report-only: nothing is blocked, violations are posted to /api/csp-report so the real
  // origin inventory can be observed before enforcement. Set here rather than in proxy.ts
  // because the middleware deliberately skips /login, static assets and the public
  // client-report routes -- exactly the pages a partial policy would miss.
  { key: CSP_HEADER_NAME, value: buildCsp() },
];

// Workspace packages ship TypeScript source rather than a build step, so Next has to compile them
// like first-party code. Listing them explicitly (not a glob) keeps the failure loud: a package added
// to packages/ but not here fails at build with a parse error instead of silently resolving to
// nothing.
const WORKSPACE_PACKAGES = [
  '@telestar/core-identity',
  '@telestar/core-icp',
  '@telestar/core-scoring',
  '@telestar/core-ingest',
  '@telestar/core-research',
  '@telestar/core-search',
];

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  transpilePackages: WORKSPACE_PACKAGES,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

// Gated by `enabled` rather than by a conditional require(): when ANALYZE is unset the
// plugin returns the config untouched, so the behaviour matches the previous branch while
// staying a static ESM import.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

export default withBundleAnalyzer(nextConfig);
