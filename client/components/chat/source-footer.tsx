import { FileText } from "lucide-react";

export interface SourceRef {
  documentId: string;
  title: string;
}

interface SourceFooterProps {
  sources: SourceRef[];
}

// Small, compact citation list rendered below an assistant response - only
// ever built from structured { documentId, title } pairs the server
// already vetted (see lib/ai-chat.ts's "source" event handling), never
// inferred from the assistant's own text. documentId is used only as a
// stable React key, never shown - the title is the only human-facing text.
// No document detail route exists in this app yet, so titles stay plain,
// non-clickable text rather than dead/guessed links.
export function SourceFooter({ sources }: SourceFooterProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="font-medium">Sources</span>
      <ul className="flex flex-col gap-0.5">
        {sources.map((source) => (
          <li key={source.documentId} className="flex items-center gap-1.5">
            <FileText className="size-3 shrink-0" aria-hidden="true" />
            <span>{source.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
