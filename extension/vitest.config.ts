import path from "node:path";

import { defineConfig } from "vitest/config";

// The extension host is not available under Vitest, so every `vscode` import
// resolves to the controllable test double in src/test/vscode-mock.ts.
const vscodeMock = path.resolve(import.meta.dirname, "src/test/vscode-mock.ts");

export default defineConfig({
  resolve: {
    alias: { vscode: vscodeMock },
  },
  test: {
    alias: { vscode: vscodeMock },
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: [/vscode/u],
      },
    },
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/types.ts"],
      thresholds: {
        statements: 93,
        branches: 87,
        functions: 97,
        lines: 93,
      },
    },
  },
});
