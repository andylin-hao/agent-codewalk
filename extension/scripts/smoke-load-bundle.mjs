import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const require = createRequire(import.meta.url);
  const extension = require("../dist/extension.cjs");
  assert.equal(typeof extension.activate, "function", "bundle must export activate");
} finally {
  Module._load = originalLoad;
}
