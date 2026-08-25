import esbuild from "esbuild";
import { promises as fs } from "node:fs";

const watch = process.argv.includes("--watch");
if (!watch) {
  await fs.rm("dist", { recursive: true, force: true });
}
const context = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  mainFields: ["module", "main"],
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
