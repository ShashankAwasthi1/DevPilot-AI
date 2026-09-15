import { NextFunction, Request, Response } from "express";
import { runChatTurn, type TurnEvent } from "../ai/tool-loop";
import { runAgentTurn, type AgentErrorReason, type AgentTurnEvent } from "../ai/agent-runner";
import { AI_LIMITS } from "../ai/limits";
import { buildAgentSystemPrompt, buildSystemPrompt } from "../ai/prompt";
import { buildProjectContext } from "../services/ai-context.service";
import * as messageService from "../services/message.service";
import type { ProviderMessage } from "../ai/provider";

// Safe, fixed, user-facing text per AgentErrorReason - never the internal
// reason value or any raw provider/tool detail. "provider_error" reuses
// the exact same generic message the existing catch-all below already
// uses for a thrown provider failure, so agent and chat modes present an
// identical failure message for the identical underlying condition.
const AGENT_ERROR_MESSAGES: Record<AgentErrorReason, string> = {
  timeout: "The request took too long to complete.",
  provider_error: "Something went wrong generating a response.",
};

// Streams the assistant's reply back over SSE as it's generated, delegating
// the multi-round tool-calling orchestration to ai/tool-loop.ts. Two
// distinct error-handling phases: anything before headers are written can
// still go through the normal Express error middleware (next(err)); once
// streaming has started, an error must be written as an SSE frame instead,
// since the response is already committed to a 200.
export async function postMessage(req: Request, res: Response, next: NextFunction) {
  const { projectId, id: conversationId } = req.params;
  const userId = req.user!.id;
  // Validated/normalized by createMessageSchema (a strict "chat" | "agent"
  // enum defaulting to "chat") - never read from anywhere else, and never
  // capable of carrying userId/projectId.
  const mode: "chat" | "agent" = req.body.mode === "agent" ? "agent" : "chat";

  let systemPrompt: string;
  let history: ProviderMessage[];

  try {
    await messageService.assertConversationWritable(userId, projectId, conversationId);
    await messageService.appendMessage(conversationId, "USER", req.body.content);

    const context = await buildProjectContext(userId, projectId);
    systemPrompt = mode === "agent" ? buildAgentSystemPrompt(context) : buildSystemPrompt(context);

    // Includes the just-appended user message, since it's now the most
    // recent row for this conversation.
    const recent = await messageService.listRecentHistory(conversationId, AI_LIMITS.MAX_HISTORY_MESSAGES);
    history = recent.map((message) => ({
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content,
    }));
  } catch (err) {
    next(err);
    return;
  }

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let finalText = "";
  // Set only when AgentRunner yields its own in-band { type: "error" }
  // event (timeout/provider_error) - runChatTurn has no such event, it
  // only ever throws, which the existing catch block below already
  // handles exactly as it did before this integration.
  let agentTurnFailed = false;

  // toolContext is built exclusively from the authenticated userId (the
  // session) and the URL's projectId - never from req.body, so nothing in
  // the request payload (mode included) can influence it.
  const toolContext = { userId, projectId };

  try {
    const turnEvents: AsyncGenerator<TurnEvent | AgentTurnEvent> =
      mode === "agent"
        ? runAgentTurn({ systemPrompt, history, toolContext, signal: abortController.signal })
        : runChatTurn({ systemPrompt, history, toolContext, signal: abortController.signal });

    for await (const event of turnEvents) {
      if (event.type === "text") {
        res.write(`data: ${JSON.stringify({ delta: event.text })}\n\n`);
      } else if (event.type === "tool_call") {
        // Only the tool name and its (already Zod-bounded, model-supplied)
        // input are exposed - never the raw tool result.
        res.write(`event: tool_call\ndata: ${JSON.stringify({ name: event.name, input: event.input })}\n\n`);
      } else if (event.type === "tool_result") {
        res.write(`event: tool_result\ndata: ${JSON.stringify({ name: event.name, ok: event.ok })}\n\n`);
      } else if (event.type === "done") {
        finalText = event.text;
      } else if (event.type === "error") {
        // AgentRunner's own bounded failure (timeout or a provider error it
        // chose to surface as an event rather than a thrown exception) -
        // never the raw reason/message, only a fixed, safe string.
        agentTurnFailed = true;
        res.write(`event: error\ndata: ${JSON.stringify({ message: AGENT_ERROR_MESSAGES[event.reason] })}\n\n`);
      }
    }

    if (agentTurnFailed) {
      // Already wrote the one error frame above - no done frame, and
      // nothing to persist (finalText was never set on this path).
      res.end();
      return;
    }

    // Persisted only after the whole turn (all rounds/tool calls) fully
    // completes - a dropped client connection never leaves a partial or
    // garbled row, and an aborted or failed generation is not persisted at
    // all (no retry feature in Phase 12/13, so a half-written assistant
    // turn would just be confusing rather than useful). This applies
    // identically to agent mode: a client abort yields no `done` event at
    // all (AgentRunner's abort semantics are silent, by design), so
    // finalText stays empty and nothing is persisted here either.
    if (finalText.length > 0) {
      await messageService.appendMessage(conversationId, "ASSISTANT", finalText);
    }

    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (err) {
    if (abortController.signal.aborted) {
      // Client disconnected - nothing left to write, nothing to persist.
      res.end();
      return;
    }
    console.error(err);
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: "Something went wrong generating a response." })}\n\n`,
    );
    res.end();
  }
}
