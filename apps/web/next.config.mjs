/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloud Run uses Next's traced standalone server so the pilot image contains
  // only runtime files rather than the whole monorepo dependency tree.
  output: "standalone",
  // Keep production builds away from the live dev-server bundle. Running
  // `next build` used to replace `.next` while `next dev` was serving it,
  // leaving open pages with stale MediaPipe chunk URLs.
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  transpilePackages: [
    "@airboard/core",
    "@airboard/drawing-engine",
    "@airboard/gesture-engine",
    "@airboard/integrations",
    "@airboard/realtime-client"
  ],
  webpack(config) {
    // Workspace packages emit native ESM and therefore use explicit `.js`
    // specifiers in TypeScript source. Teach webpack to resolve those
    // specifiers back to the authored TypeScript files while Next transpiles
    // the packages in development and production builds.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"]
    };

    return config;
  }
};

export default nextConfig;
