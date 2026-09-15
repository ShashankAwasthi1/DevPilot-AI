"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { SendHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  // Renamed from the old boolean `disabled` prop - it now also decides
  // whether the Send button is replaced by Stop, not just whether input is
  // disabled, so a name describing *why* it's disabled is clearer here.
  streaming: boolean;
}

export function ChatInput({ onSend, onStop, streaming }: ChatInputProps) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setValue("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={streaming}
        placeholder="Ask about this project…"
        rows={2}
        className="resize-none"
        aria-label="Message"
      />
      {streaming ? (
        <Button type="button" variant="outline" size="sm" onClick={onStop} className="gap-1.5">
          <Square className="size-3.5" aria-hidden="true" fill="currentColor" />
          Stop
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={value.trim().length === 0}>
          <SendHorizontal className="size-4" aria-hidden="true" />
          <span className="sr-only">Send</span>
        </Button>
      )}
    </form>
  );
}
