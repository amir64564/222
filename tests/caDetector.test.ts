import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCAs } from "../src/caDetector";

test("detects EVM CA without ticker", () => {
  const results = detectCAs("CA: 0x1234567890abcdef1234567890abcdef12345678", { sourcePostId: "1", sourceUsername: "test" });
  assert.equal(results.length, 1); assert.equal(results[0].chain, "base");
});
test("detects raw EVM CA", () => {
  const results = detectCAs("0x1234567890abcdef1234567890abcdef12345678", { sourcePostId: "2", sourceUsername: "test" });
  assert.equal(results.length, 1);
});
test("rejects malformed EVM CA", () => {
  assert.equal(detectCAs("0x1234", { sourcePostId: "3", sourceUsername: "test" }).length, 0);
});
test("deduplicates repeated CA", () => {
  const ca = "0x1234567890abcdef1234567890abcdef12345678";
  assert.equal(detectCAs(`${ca} ${ca}`, { sourcePostId: "4", sourceUsername: "test" }).length, 1);
});
