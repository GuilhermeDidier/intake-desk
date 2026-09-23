import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFs up to 2 MB, plus multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "2.5mb" } },
};

export default nextConfig;
