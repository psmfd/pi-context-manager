import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULT_STATE, FreezeMap, load, save } from "../state.ts";
import { saveState } from "../shared/state.ts";

async function tmpAgentDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "pi-suite-ctxmgr-"));
}

test("save then load round-trips state", async () => {
  const dir = await tmpAgentDir();
  const value = { enabled: true, maxResultBytes: 8000 };
  await save(value, dir);
  assert.deepEqual(await load(dir), value);
});

test("load returns the default when no state file exists", async () => {
  const dir = await tmpAgentDir();
  assert.deepEqual(await load(dir), DEFAULT_STATE);
});

test("load repairs a non-positive maxResultBytes to the default", async () => {
  const dir = await tmpAgentDir();
  await saveState("context-manager", { enabled: true, maxResultBytes: 0 }, dir);
  const loaded = await load(dir);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.maxResultBytes, DEFAULT_STATE.maxResultBytes);
});

test("load repairs a too-small maxResultBytes (below head+tail keep) to the default", async () => {
  const dir = await tmpAgentDir();
  // 100 is > 0 but can never elide (< HEAD_KEEP + TAIL_KEEP) — must be repaired.
  await saveState("context-manager", { enabled: true, maxResultBytes: 100 }, dir);
  const loaded = await load(dir);
  assert.equal(loaded.maxResultBytes, DEFAULT_STATE.maxResultBytes);
});

test("FreezeMap stores, overwrites, and clears decisions", () => {
  const m = new FreezeMap();
  m.set("a", "full");
  m.set("b", "pruned");
  assert.equal(m.get("a"), "full");
  assert.equal(m.size, 2);
  m.set("a", "pruned"); // re-decide is overwrite, not duplicate
  assert.equal(m.get("a"), "pruned");
  assert.equal(m.size, 2);
  m.clear();
  assert.equal(m.size, 0);
  assert.equal(m.get("a"), undefined);
});

test("FreezeMap evicts oldest beyond its bound", () => {
  const m = new FreezeMap(2);
  m.set("a", "full");
  m.set("b", "full");
  m.set("c", "full"); // evicts "a"
  assert.equal(m.size, 2);
  assert.equal(m.get("a"), undefined);
  assert.equal(m.get("c"), "full");
});
