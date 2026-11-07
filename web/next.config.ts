import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Page images and PDFs come from the DigiMV API, same-origin for the browser (no CORS, X-Mark readable).
  async rewrites() {
    return [{ source: "/digimv/:path*", destination: `${process.env.DIGIMV_API ?? "http://127.0.0.1:8000"}/:path*` }];
  },
};

export default nextConfig;
