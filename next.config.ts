import type { NextConfig } from "next";
import { buildCsp, CSP_HEADER_NAME } from './lib/security/csp';

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

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

let config = nextConfig;

if (process.env.ANALYZE === 'true') {
  const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: true });
  config = withBundleAnalyzer(config);
}

export default config;
