import assert from "node:assert/strict";
import { test } from "node:test";

import { decide, gateOpen, isOversized } from "../policy.ts";
import type { AnyMessage, ToolResultMessage } from "../types.ts";

const CAP = 100;

function tr(text: string): ToolResultMessage {
  return { role: "toolResult", toolCallId: "a", toolName: "read", content: [{ type: "text", text }] };
}

test("gateOpen is true only at/above the prune band", () => {
  assert.equal(gateOpen("ok"), false);
  assert.equal(gateOpen(null), false);
  assert.equal(gateOpen("prune"), true);
  assert.equal(gateOpen("escalate"), true);
  assert.equal(gateOpen("force"), true);
});

test("isOversized compares combined text to the cap; non-tool-results are never oversized", () => {
  assert.equal(isOversized(tr("x".repeat(CAP + 1)), CAP), true);
  assert.equal(isOversized(tr("x".repeat(CAP)), CAP), false);
  assert.equal(isOversized({ role: "user", content: "x".repeat(CAP + 1) } as AnyMessage, CAP), false);
});

test("decide prunes only when oversized AND under pressure", () => {
  assert.equal(decide(tr("x".repeat(CAP + 1)), "prune", CAP), "pruned");
  assert.equal(decide(tr("x".repeat(CAP + 1)), "ok", CAP), "full", "headroom keeps it full");
  assert.equal(decide(tr("small"), "force", CAP), "full", "under cap keeps it full");
  assert.equal(decide(tr("x".repeat(CAP + 1)), null, CAP), "full", "unknown usage keeps it full");
});
