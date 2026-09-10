import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O Railway/Docker usa Linux. No Windows, o modo standalone tenta criar
  // symlinks que podem falhar mesmo com a aplicação compilando corretamente.
  output: process.platform === "win32" ? undefined : "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
};
export default nextConfig;
