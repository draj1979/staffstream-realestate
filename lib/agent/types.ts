/** A single tool invocation recorded during one agent turn (best-effort — see effects.ts). */
export interface ToolEffect {
  tool: string;
  args: unknown;
  result: unknown;
  at: string;
}

export interface RunTurnOptions {
  /** WhatsApp's message id for the inbound message, when available — see lib/agent/runTurn.ts. */
  waMessageId?: string;
}

export interface RunTurnResult {
  /** The assistant's reply text, already persisted as an outbound Message. */
  replyText: string;
  /** True if request_brochure was called this turn — caller should send the PDF. */
  sendBrochure: boolean;
  /** GCS path of the brochure to send, when sendBrochure is true. */
  brochureGcsPath?: string;
  /** Display filename for the brochure, when sendBrochure is true. */
  brochureFileName?: string;
  /** Tool calls observed during this turn (best-effort; see lib/agent/effects.ts). */
  toolEffects: ToolEffect[];
  /** The lead's stage after this turn (re-read from the DB, since tool handlers write directly to it). */
  leadStage: string;
}
