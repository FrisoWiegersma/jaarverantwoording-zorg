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
  // Reuse the installed Tailwind loader in Webpack's existing CSS pipeline too.
  webpack(config) {
    for (const rule of config.module.rules) {
      for (const css of rule.oneOf ?? []) {
        if (Array.isArray(css.use) && css.use.some((entry: { loader?: string }) => entry.loader?.includes("postcss-loader"))) {
          css.use.push({ loader: "@tailwindcss/turbopack" });
        }
      }
    }
    return config;
  },
  // Page images and PDFs come from the DigiMV API, same-origin for the browser (no CORS, X-Mark readable).
  async rewrites() {
    return [{ source: "/digimv/:path*", destination: `${process.env.DIGIMV_API ?? "http://127.0.0.1:8000"}/:path*` }];
  },
};

export default nextConfig;
