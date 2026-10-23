import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // WordPress permalinks end with a slash; keep every old URL byte-identical.
  trailingSlash: true,
  // the /foo -> /foo/ redirect is done in src/proxy.ts instead, so /api/mcp (no slash) is not 308'd
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
