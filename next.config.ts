import path from "path";
import type { NextConfig } from "next";

const emptyNodeBrowser = path.join(
  process.cwd(),
  "src/lib/empty-node-browser.ts"
);

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["sharp"],
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty-node-browser.ts" },
      path: { browser: "./src/lib/empty-node-browser.ts" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: emptyNodeBrowser,
        path: emptyNodeBrowser,
      };
    }
    return config;
  },
};

export default nextConfig;
