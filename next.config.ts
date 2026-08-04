import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Node-native packages that must not be bundled — they rely on dynamic
   * requires and native bindings that break under Turbopack/webpack bundling.
   */
  serverExternalPackages: ["pg", "ioredis", "pino", "pino-pretty"],

  experimental: {
    /**
     * Tree-shake icon/primitive barrels so a single `lucide-react` import
     * doesn't pull thousands of modules into the client graph.
     */
    optimizePackageImports: ["lucide-react", "radix-ui", "date-fns"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
