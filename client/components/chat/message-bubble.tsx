import { cn } from "@/lib/utils";
import type { ChatMessageRole } from "@/lib/types";

interface MessageBubbleProps {
  role: ChatMessageRole;
  content: string;
}

// Plain text, not rendered markdown - avoids introducing a markdown
// renderer + sanitizer (and the XSS surface that implies) in the same
// phase as the AI feature itself. whitespace-pre-wrap keeps line breaks
// readable without needing to parse anything.
export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "USER";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {content}
      </div>
    </div>
  );
}
