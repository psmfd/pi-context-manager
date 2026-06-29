/**
 * context-manager/prune.ts — cache-safe elision mechanics + the apply loop.
 *
 * `pruneToolResult` is a pure function of a message's own content (plus the
 * cap), so re-running it every turn yields byte-identical output → the sent
 * prefix never changes → provider prompt caching is preserved. `applyPrune`
 * walks the message array, freezing each tool result's decision the first turn
 * it is seen (see ADR-0032). Only `toolResult` *content* is rewritten; the
 * message and its `toolCallId` are always kept, so tool-call/result pairing is
 * never broken.
 */

import { decide, type Decision } from "./policy.ts";
import type { AnyMessage, ContentBlock, ToolResultMessage } from "./types.ts";
import type { UsageLevel } from "./shared/signals.ts";

/** Chars of the original output kept at the head and tail of an elided result. */
export const HEAD_KEEP = 2000;
export const TAIL_KEEP = 2000;

export function isToolResult(message: AnyMessage): message is ToolResultMessage {
  return message.role === "toolResult" && Array.isArray((message as ToolResultMessage).content);
}

/** Combined length of every text block in a tool result. */
export function textLength(message: ToolResultMessage): number {
  let total = 0;
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string") total += block.text.length;
  }
  return total;
}

/**
 * Return a copy of `message` with its text content elided to a head + tail
 * excerpt when the combined text exceeds `maxResultBytes`; otherwise return the
 * message unchanged. Non-text blocks (e.g. images) are preserved. Deterministic.
 */
export function pruneToolResult(message: ToolResultMessage, maxResultBytes: number): ToolResultMessage {
  const joined = message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");

  // Nothing to gain if it is not oversized, or the cap leaves no middle to cut.
  if (joined.length <= maxResultBytes || joined.length <= HEAD_KEEP + TAIL_KEEP) {
    return message;
  }

  const head = joined.slice(0, HEAD_KEEP);
  const tail = joined.slice(joined.length - TAIL_KEEP);
  const elided = joined.length - HEAD_KEEP - TAIL_KEEP;
  // Sanitize toolName before interpolating it into model-visible content: a
  // malicious or dynamically-registered tool name could otherwise embed newlines
  // or brackets to break out of this annotation and plant instructions the model
  // reads as a status message (LLM01, indirect prompt injection). Strip control
  // and bracket chars and bound the length.
  const safeToolName = message.toolName.replace(/[\r\n[\]]/g, " ").slice(0, 80);
  const marker = `\n\n[context-manager: elided ${elided} chars from ${safeToolName} — re-run the tool for full output]\n\n`;

  // Rebuild preserving original block order: the elided excerpt replaces the
  // FIRST text block in place; subsequent text blocks are folded into it
  // (dropped); every non-text block (e.g. images) keeps its position. Collapsing
  // all text to the front would reorder interleaved text/non-text content.
  const rebuilt: ContentBlock[] = [];
  let excerptEmitted = false;
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string") {
      if (!excerptEmitted) {
        rebuilt.push({ type: "text", text: head + marker + tail });
        excerptEmitted = true;
      }
    } else {
      rebuilt.push(block);
    }
  }
  return { ...message, content: rebuilt };
}

export interface PruneResult {
  /** The (possibly) rewritten message array to send. */
  readonly messages: AnyMessage[];
  /** How many tool results were elided this pass. */
  readonly prunedCount: number;
  /** Total characters removed this pass. */
  readonly savedChars: number;
}

/** The slice of a freeze store `applyPrune` needs — satisfied by `FreezeMap` and `Map`. */
export interface FreezeStore {
  get(key: string): Decision | undefined;
  set(key: string, value: Decision): void;
}

/**
 * Apply the frozen-decision prune across `messages`. For each tool result:
 * reuse its frozen decision if present, else `decide()` it against `level` and
 * freeze it. `frozen` is mutated in place (the caller owns its per-session
 * lifetime). Non-tool-result messages pass through untouched.
 */
export function applyPrune(
  messages: ReadonlyArray<AnyMessage>,
  level: UsageLevel | null,
  maxResultBytes: number,
  frozen: FreezeStore,
): PruneResult {
  const out: AnyMessage[] = [];
  let prunedCount = 0;
  let savedChars = 0;

  for (const message of messages) {
    if (!isToolResult(message)) {
      out.push(message);
      continue;
    }
    const key = message.toolCallId;
    let decision = frozen.get(key);
    if (decision === undefined) {
      decision = decide(message, level, maxResultBytes);
      frozen.set(key, decision);
    }
    if (decision === "pruned") {
      const before = textLength(message);
      const pruned = pruneToolResult(message, maxResultBytes);
      const after = textLength(pruned);
      if (after < before) {
        prunedCount += 1;
        savedChars += before - after;
      }
      out.push(pruned);
    } else {
      out.push(message);
    }
  }

  return { messages: out, prunedCount, savedChars };
}
