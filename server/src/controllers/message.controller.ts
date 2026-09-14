import { NextFunction, Request, Response } from "express";
import { runChatTurn } from "../ai/tool-loop";
import { AI_LIMITS } from "../ai/limits";
import { buildSystemPrompt } from "../ai/prompt";
import { buildProjectContext } from "../services/ai-context.service";
import * as messageService from "../services/message.service";
import type { ProviderMessage } from "../ai/provider";

// Streams the assistant's reply back over SSE as it's generated, delegating
// the multi-round tool-calling orchestration to ai/tool-loop.ts. Two
// distinct error-handling phases: anything before headers are written can
// still go through the normal Express error middleware (next(err)); once
// streaming has started, an error must be written as an SSE frame instead,
// since the response is already committed to a 200.
export async function postMessage(req: Request, res: Response, next: NextFunction) {
  const { projectId, id: conversationId } = req.params;
  const userId = req.user!.id;

  let systemPrompt: string;
  let history: ProviderMessage[];

  try {
    await messageService.assertConversationWritable(userId, projectId, conversationId);
    await messageService.appendMessage(conversationId, "USER", req.body.content);

    const context = await buildProjectContext(userId, projectId);
    systemPrompt = buildSystemPrompt(context);

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

  try {
    for await (const event of runChatTurn({
      systemPrompt,
      history,
      toolContext: { userId, projectId },
      signal: abortController.signal,
    })) {
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
      }
    }

    // Persisted only after the whole turn (all rounds/tool calls) fully
    // completes - a dropped client connection never leaves a partial or
    // garbled row, and an aborted or failed generation is not persisted at
    // all (no retry feature in Phase 12/13, so a half-written assistant
    // turn would just be confusing rather than useful).
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
