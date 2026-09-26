import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext routes multipart form uploads through Next's request reader before
    // the Worker route receives them. Its default is 1 MB, below our 8 MB
    // contestant-photo limit.
    proxyClientMaxBodySize: '10mb',
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
