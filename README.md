# context-manager

Cache-safe, **zero-token** context pruning for pi. When enabled, oversized tool
output is elided to a head + tail excerpt — but only for results first seen while
the context is under pressure, and that decision is **frozen** so the sent prefix
never changes turn-over-turn and provider prompt caching stays hot. Part of the
Pi Extension Suite (#327); consumes the [`shared/`](https://github.com/psmfd/pi-config/blob/main/agent/extensions/shared/README.md)
foundation. See [ADR-0032](https://github.com/psmfd/pi-config/blob/main/adrs/0032-context-manager.md).

## Install

```sh
pi install git:github.com/psmfd/pi-context-manager
```

Try it first without installing: `pi -e git:github.com/psmfd/pi-context-manager`.

## Why custom (not an adopted extension)

Both maintained candidates were rejected at inspection because their core
mechanism **rewrites the cached prefix**, violating the suite's binding cache
invariant: `@davecodes/pi-dcp` dedups/purges aged content across the full message
array; `pi-context-prune` summarizes earlier tool-call trees (and spends LLM
tokens doing it). Neither can be configured append-side-only. Evidence and the
build decision are in [ADR-0032](https://github.com/psmfd/pi-config/blob/main/adrs/0032-context-manager.md) / #334.

## How it stays cache-safe

Providers price cached input ~10× below fresh, matching on the **exact message
prefix**; editing any already-sent message invalidates the cache from that point
forward. The `context` event hands a fresh deep copy of the *original* messages
every turn, so the cache-busting mistake is re-deciding each message against
*current* usage (its sent form then flips full→pruned mid-session).

This extension instead **freezes each tool result's treatment the first turn it
is seen** (`toolCallId → full | pruned`, in memory):

1. A result first seen with **headroom** (usage `< PRUNE_AT` = 0.70) → frozen `full`, stays full forever.
2. A result first seen **under pressure** *and* **oversized** (combined text > the cap) → frozen `pruned`, stays pruned.

Because each message's sent form is a pure function of its own content and its
frozen decision — independent of position, age, and later usage — the prefix is
byte-identical turn-over-turn. Old prefix bloat is left to pi's built-in
compaction (a rare, bounded cache event); this extension only caps **new** output
as it arrives.

Only `toolResult` **content** is rewritten — the message and its `toolCallId`
always remain, so tool-call/result pairing is never broken.

## Hooks & coexistence

`context` only (plus `session_start` for state restore). **No** `before_agent_start`
(auto-router's) and **no** `agent_end` (indexing's) → zero collision with the rest
of the suite. No LLM calls → zero extra tokens.

## Controls

| Control | Effect |
|---|---|
| `/prune on` / `/prune off` | Toggle automatic elision; persisted (`shared/state.ts`, namespace `context-manager`). |
| `/prune status` (or `/prune`) | Show ON/OFF, the per-result cap, and live context usage. |
| `--prune` | Enable for the current session (in addition to the persisted toggle). |

Status bar: `✂️ prune on` / `✂️ prune off`.

## State

`~/.pi/agent/extensions/context-manager/state.json`, schema-versioned (`{v:1}`):
`{ enabled, maxResultBytes }`. `maxResultBytes` (default `12000`) is the per-result
text-length cap; a result over it, seen under pressure, is elided to the first
`HEAD_KEEP` (2000) + last `TAIL_KEEP` (2000) chars. The freeze map is in-memory
only — a `/reload` re-derives decisions against current usage (one bounded cache
event; pairing always preserved).

## Files

| File | Role |
|---|---|
| `index.ts` | Factory: wires `context`, `/prune`, `--prune`, the `✂️` status segment, and `session_start` state restore + freeze-map reset. |
| `policy.ts` | The prune decision: oversized × under-pressure gate (`shared/signals.ts` level), pure so it is safe to freeze. |
| `prune.ts` | Elision mechanics (`pruneToolResult`, deterministic head/tail excerpt) + the `applyPrune` freeze-and-rewrite loop. |
| `state.ts` | Persisted toggle/cap + in-memory `FreezeMap`. |
| `types.ts` | Structural `ToolResultMessage` / `AnyMessage` shapes the pruner reads. |

## Deferred (post-v1)

- **`session_before_compact` lever** — domain-aware compaction; only if the built-in summary proves too lossy.
- **Cache-busting "deep reclaim" `/prune` mode** — dedup/age-based reclamation; rejected for v1 because it reintroduces the rejected candidates' invariant violation.

## API provenance

Verified against **pi v0.79.0** (Phase 0, #328): the `context` event
(`docs/extensions.md:609` — fires before each LLM call, deep-copied
`event.messages`, returns `{ messages }`), `ToolResultMessage` shape
(`docs/session-format.md`), `ctx.getContextUsage()` / `ctx.model.contextWindow`
(via `shared/signals.ts`), `registerCommand`/`registerFlag`/`setStatus`.

## Tests

```sh
./scripts/test-context-manager.sh          # node:test via tsx
VERBOSE=1 ./scripts/test-context-manager.sh
```

Unit tests cover the elision mechanics, the freeze/gate decision, the sticky
apply loop (including the cache-safety property — re-running over the originals
yields a stable result), and state load/save. The structural typing runs the
core offline without a live pi runtime; live token-reduction and cache-hit-ratio
measurement is #338.
