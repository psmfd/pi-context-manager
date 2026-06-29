/**
 * context-manager/policy.ts — the cache-safe prune decision.
 *
 * A tool result is pruned iff it is oversized AND the context is under pressure
 * (`shared/signals.ts` level >= "prune"). The decision is taken on the message's
 * own intrinsic content and the usage level *at first sight*, then frozen
 * (see state.ts / prune.ts) — never re-derived against later usage. That
 * stickiness is what keeps the sent prefix byte-stable turn-over-turn and
 * preserves provider prompt caching (ADR-0032's binding invariant).
 */

import type { UsageLevel } from "./shared/signals.ts";
import { isToolResult, textLength } from "./prune.ts";
import type { AnyMessage } from "./types.ts";

/** A frozen treatment for one tool result. */
export type Decision = "full" | "pruned";

/**
 * True once usage has reached the prune band. `null` (unknown usage — #328
 * finding F: `getContextUsage().tokens` may be undefined) is treated as "not
 * under pressure", so an unknown signal never triggers a prune.
 */
export function gateOpen(level: UsageLevel | null): boolean {
  return level === "prune" || level === "escalate" || level === "force";
}

/** A tool result whose combined text exceeds the cap is a prune candidate. */
export function isOversized(message: AnyMessage, maxResultBytes: number): boolean {
  return isToolResult(message) && textLength(message) > maxResultBytes;
}

/**
 * The fresh decision for a message first seen at `level`. Pure: the same
 * message + level always yields the same treatment, which is why freezing it is
 * safe.
 */
export function decide(message: AnyMessage, level: UsageLevel | null, maxResultBytes: number): Decision {
  return gateOpen(level) && isOversized(message, maxResultBytes) ? "pruned" : "full";
}
