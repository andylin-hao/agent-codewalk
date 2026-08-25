import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The extension host is not available under Vitest, so every `vscode`
      // import resolves to the controllable test double.
      vscode: path.resolve(import.meta.dirname, "src/test/vscode-mock.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/types.ts"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 92,
        lines: 90,
      },
    },
  },
});
