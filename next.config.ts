import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // WordPress permalinks end with a slash; keep every old URL byte-identical.
  trailingSlash: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
