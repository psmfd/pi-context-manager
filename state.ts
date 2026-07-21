/**
 * context-manager/state.ts — persisted on/off + result cap, plus the in-memory
 * per-session freeze map.
 *
 * Persistence delegates to `shared/state.ts` (schema-versioned JSON under
 * `~/.pi/agent/extensions/context-manager/state.json`, ADR-0019/ADR-0030). The
 * freeze map is intentionally in-memory only: it keys on `toolCallId` so each
 * tool result keeps the treatment chosen at first sight, but it must not persist
 * across sessions (a reload re-derives decisions against current usage — the
 * one bounded cache event ADR-0032 documents).
 */

import { loadState, saveState } from "./shared/state.ts";
import type { Decision } from "./policy.ts";
import { HEAD_KEEP, TAIL_KEEP } from "./prune.ts";

const NAMESPACE = "context-manager";

// Smallest cap that can actually elide: below head+tail keep, pruneToolResult's
// no-middle guard returns the message unchanged, so a result would be frozen as
// "pruned" yet shipped in full. Repair any cap under this to the default.
const MIN_RESULT_CHARS = HEAD_KEEP + TAIL_KEEP;

export interface ContextManagerState {
  /** Whether automatic elision is active (persisted toggle; `--prune` also enables). */
  readonly enabled: boolean;
  /**
   * A tool result whose combined text exceeds this many CHARACTERS (JS string
   * `.length`, UTF-16 code units — not bytes) is a prune candidate.
   */
  readonly maxResultChars: number;
}

export const DEFAULT_STATE: ContextManagerState = {
  enabled: false,
  maxResultChars: 12000,
};

export async function load(agentDir?: string): Promise<ContextManagerState> {
  const loaded = await loadState<ContextManagerState>(NAMESPACE, DEFAULT_STATE, agentDir);
  // Back-compat: the cap was named `maxResultBytes` before it was corrected to
  // `maxResultChars` (#804) — it always measured chars. Adopt a legacy value so
  // an operator's tuned runtime state (and mirror consumers pinned to the old
  // schema) is not silently reset on upgrade.
  const legacy = loaded as ContextManagerState & { maxResultBytes?: number };
  const cap =
    typeof legacy.maxResultChars === "number"
      ? legacy.maxResultChars
      : typeof legacy.maxResultBytes === "number"
        ? legacy.maxResultBytes
        : DEFAULT_STATE.maxResultChars;
  // Defend against a hand-edited state file with a nonsensical or unusably-small
  // cap (a cap below MIN_RESULT_CHARS can never elide — see its definition).
  const repaired = cap < MIN_RESULT_CHARS ? DEFAULT_STATE.maxResultChars : cap;
  return { enabled: loaded.enabled, maxResultChars: repaired };
}

export async function save(state: ContextManagerState, agentDir?: string): Promise<void> {
  await saveState<ContextManagerState>(NAMESPACE, state, agentDir);
}

/**
 * Bounded, insertion-ordered `toolCallId -> Decision` map for one session.
 * Bounded only as a runaway guard; real sessions hold far fewer tool calls.
 */
export class FreezeMap {
  private readonly map = new Map<string, Decision>();

  constructor(private readonly maxSize = 5000) {}

  get(key: string): Decision | undefined {
    return this.map.get(key);
  }

  set(key: string, value: Decision): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
