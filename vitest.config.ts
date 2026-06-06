import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@nodedos/protocol": path.resolve(__dirname, "packages/protocol/src/index.ts"),
      "@nodedos/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@nodedos/fs-drivers": path.resolve(__dirname, "packages/fs-drivers/src/index.ts"),
      "@nodedos/server": path.resolve(__dirname, "packages/server/src/index.ts"),
      "@nodedos/client": path.resolve(__dirname, "packages/client/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
