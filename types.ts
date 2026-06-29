/**
 * context-manager/types.ts — structural message shapes the pruner reads.
 *
 * Typed against the slice of pi v0.79.0's `AgentMessage` union that the
 * `context` event hands us (`docs/session-format.md`: `ToolResultMessage` has
 * `role: "toolResult"`, `toolCallId`, `toolName`, `content: (TextContent |
 * ImageContent)[]`). The index signatures let a deep-copied message round-trip
 * through `{ ...m, content }` without dropping pi's other fields (`timestamp`,
 * `details`, `isError`). The real `event.messages` is cast to these at the
 * `index.ts` boundary, so the pure logic unit-tests without a live runtime.
 */

/** A single content block; `text` present only on `type: "text"` blocks. */
export interface ContentBlock {
  readonly type: string;
  readonly text?: string | undefined;
  readonly [key: string]: unknown;
}

/** The one message kind the pruner rewrites. */
export interface ToolResultMessage {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: ReadonlyArray<ContentBlock>;
  readonly [key: string]: unknown;
}

/** Any other message kind — passed through untouched. */
export interface OtherMessage {
  readonly role: string;
  readonly [key: string]: unknown;
}

export type AnyMessage = ToolResultMessage | OtherMessage;
