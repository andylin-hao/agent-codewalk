import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/test/suite.ts"],
  bundle: true,
  outfile: "dist/test/suite.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
});

