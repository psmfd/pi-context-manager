/**
 * context-manager — cache-safe, zero-token context pruning for pi.
 *
 * On the `context` event (when enabled), oversized `toolResult` output is elided
 * to a head + tail excerpt, but only for results first seen while the context is
 * under pressure — and that decision is frozen per `toolCallId`, so the sent
 * prefix never changes turn-over-turn and provider prompt caching is preserved.
 * No `before_agent_start`/`agent_end` hooks (no collision with auto-router or
 * indexing) and no LLM calls (zero extra tokens). `/prune [on|off|status]` and
 * `--prune` control it; state persists via shared/state. See ADR-0032.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getUsage, type UsageContext } from "./shared/signals.ts";
import { applyPrune } from "./prune.ts";
import * as state from "./state.ts";
import type { AnyMessage } from "./types.ts";

/** Status-bar segment reflecting whether pruning is active. */
function showStatus(ctx: ExtensionContext, active: boolean): void {
  if (ctx.hasUI) ctx.ui.setStatus("context-manager", active ? "✂️ prune on" : "✂️ prune off");
}

export default function contextManager(pi: ExtensionAPI): void {
  let cfg: state.ContextManagerState = state.DEFAULT_STATE;
  // Per-session `toolCallId -> full|pruned`; cleared on session_start so a
  // reload re-derives against current usage (the one bounded cache event).
  const frozen = new state.FreezeMap();

  pi.registerFlag("prune", {
    description: "Enable automatic cache-safe context pruning for this session",
    type: "boolean",
    default: false,
  });

  pi.on("session_start", async (_event, ctx) => {
    cfg = await state.load();
    frozen.clear();
    showStatus(ctx, cfg.enabled || pi.getFlag("prune") === true);
  });

  pi.registerCommand("prune", {
    description: "Cache-safe context pruning: /prune [on|off|status]",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "on" || sub === "off") {
        cfg = { ...cfg, enabled: sub === "on" };
        await state.save(cfg);
      } else if (sub !== "" && sub !== "status") {
        // A typo (`/prune onn`) must not silently read as a status query.
        ctx.ui.notify(`context-manager: unknown action '${sub}' — use /prune [on|off|status]`, "warning");
        return;
      }
      const flagOn = pi.getFlag("prune") === true;
      const active = cfg.enabled || flagOn;
      const usage = getUsage(ctx as unknown as UsageContext);
      ctx.ui.notify(
        `context-manager: ${active ? "ON" : "OFF"}${flagOn && !cfg.enabled ? " (via --prune)" : ""}; ` +
          `cap=${cfg.maxResultChars} chars/result; ` +
          `usage=${usage ? `${Math.round(usage.pct * 100)}% (${usage.level})` : "unknown"}`,
        "info",
      );
      showStatus(ctx, active);
    },
  });

  pi.on("context", async (event, ctx) => {
    if (!cfg.enabled && pi.getFlag("prune") !== true) return undefined;
    try {
      const usage = getUsage(ctx as unknown as UsageContext);
      const level = usage ? usage.level : null;
      const result = applyPrune(
        event.messages as unknown as AnyMessage[],
        level,
        cfg.maxResultChars,
        frozen,
      );
      // Decisions are frozen as a side effect every enabled turn; only return a
      // rewritten array when something actually changed (keeps the no-op path cheap).
      if (result.prunedCount === 0) return undefined;
      return { messages: result.messages as unknown as typeof event.messages };
    } catch (err) {
      // Pruning must never break a turn — keep the original messages. Log so a
      // silent failure (e.g. a future SDK message-shape change) is diagnosable
      // rather than invisible.
      console.error(`context-manager: prune skipped after error — ${(err as Error).message}`);
      return undefined;
    }
  });
}
