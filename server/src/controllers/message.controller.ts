import { NextFunction, Request, Response } from "express";
import { getAIProvider } from "../ai";
import { AI_LIMITS } from "../ai/limits";
import { buildSystemPrompt } from "../ai/prompt";
import { buildProjectContext } from "../services/ai-context.service";
import * as messageService from "../services/message.service";

// Streams the assistant's reply back over SSE as it's generated. Two
// distinct error-handling phases: anything before headers are written can
// still go through the normal Express error middleware (next(err)); once
// streaming has started, an error must be written as an SSE frame instead,
// since the response is already committed to a 200.
export async function postMessage(req: Request, res: Response, next: NextFunction) {
  const { projectId, id: conversationId } = req.params;
  const userId = req.user!.id;

  let history: Awaited<ReturnType<typeof messageService.listRecentHistory>>;
  let systemPrompt: string;
  let provider: ReturnType<typeof getAIProvider>;

  try {
    await messageService.assertConversationWritable(userId, projectId, conversationId);
    await messageService.appendMessage(conversationId, "USER", req.body.content);

    const context = await buildProjectContext(userId, projectId);
    systemPrompt = buildSystemPrompt(context);
    history = await messageService.listRecentHistory(conversationId, AI_LIMITS.MAX_HISTORY_MESSAGES);
    // Resolved before headers are written so a missing/misconfigured AI
    // provider (e.g. ANTHROPIC_API_KEY not set) is reported through the
    // normal error middleware as a clean 500, not a hung streaming response.
    provider = getAIProvider();
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

  let assistantText = "";

  try {
    for await (const delta of provider.streamReply({
      systemPrompt,
      history: history.map((message) => ({
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
      })),
      maxOutputTokens: AI_LIMITS.MAX_OUTPUT_TOKENS,
      signal: abortController.signal,
    })) {
      assistantText += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }

    // Persisted only after the provider's stream fully completes - a
    // dropped client connection never leaves a partial/garbled row, and an
    // aborted or failed generation is not persisted at all (no retry
    // feature in Phase 12, so a half-written assistant turn would just be
    // confusing rather than useful).
    if (assistantText.length > 0) {
      await messageService.appendMessage(conversationId, "ASSISTANT", assistantText);
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
