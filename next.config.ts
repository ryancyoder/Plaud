import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/plaud",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
