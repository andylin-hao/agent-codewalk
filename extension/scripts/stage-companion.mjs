import { constants, promises as fs } from "node:fs";
import path from "node:path";

// A cross-compiled build lands under target/<triple>/release rather than target/release,
// so the caller names the triple when the companion was not built for this machine.
const triple = process.env.AGENT_CODEWALK_RUST_TARGET ?? "";
const executable = process.platform === "win32" ? "agent-codewalk-mcp.exe" : "agent-codewalk-mcp";
const source = path.resolve("..", "target", ...(triple === "" ? [] : [triple]), "release", executable);
const destination = path.resolve("bin", executable);

try {
  await fs.access(source, constants.R_OK);
} catch {
  throw new Error(`Missing release companion at ${source}. Run cargo build --release first.`);
}

await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.copyFile(source, destination);
if (process.platform !== "win32") {
  await fs.chmod(destination, 0o755);
}
