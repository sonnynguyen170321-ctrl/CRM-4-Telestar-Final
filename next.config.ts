import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.100.140",
    "192.168.100.140:3000",
  ],
  // `next build` re-runs tsc in-process, which OOMs a 4GB build host (t3.medium). typecheck is
  // gated independently in CI, so skip the redundant in-build pass. (Next 16 dropped the `eslint`
  // config key + built-in lint, so there's nothing to disable there.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;