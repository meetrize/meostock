import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/dapan",
  assetPrefix: "/dapan",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Origin-Agent-Cluster",
            value: "?1",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
