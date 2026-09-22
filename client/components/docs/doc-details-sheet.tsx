"use client";

import { useState, type ReactNode } from "react";
import { CircleX, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/format";
import type { DocumentItem } from "@/lib/types";

interface DocDetailsSheetProps {
  doc: DocumentItem;
  trigger: ReactNode;
}

// The documents list already returns full content for every row, so
// there is no server-backed fetch/loading state needed here (unlike
// task-details-sheet.tsx) - this is purely a read-only presentation of
// data the caller already has.
export function DocDetailsSheet({ doc, trigger }: DocDetailsSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="break-words">{doc.title}</SheetTitle>
          <SheetDescription>
            Created {formatRelativeTime(doc.createdAt)} · Updated {formatRelativeTime(doc.updatedAt)}
          </SheetDescription>
          {doc.indexStatus === "PENDING" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              Indexing — this document isn&apos;t available to AI search yet.
            </p>
          )}
          {doc.indexStatus === "FAILED" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
              Indexing failed — this document couldn&apos;t be indexed and isn&apos;t available to AI search.
            </p>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{doc.content}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
