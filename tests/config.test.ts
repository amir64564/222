import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("source no longer contains legacy ticker gate", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "index.ts"), "utf8");
  assert.equal(source.includes("text.includes"), false);
  assert.equal(source.includes("tickerMatches"), false);
});
