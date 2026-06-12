import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "#wasm-single-thread": "./stubs/satellite-wasm-stub.js",
      "#wasm-multi-thread": "./stubs/satellite-wasm-stub.js",
    },
  },
};

export default nextConfig;
