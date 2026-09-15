"use client";

import { Bot, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ChatMode = "chat" | "agent";

interface ModeToggleProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

// A small two-option toggle rather than a full tablist/tabpanel widget -
// there's no separate content panel per mode (it only changes how the next
// message is generated), so a toggle-button group (aria-pressed) is a more
// accurate semantic fit than the ARIA tabs pattern.
export function ModeToggle({ mode, onModeChange, disabled }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Response mode"
      className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1"
    >
      <Button
        type="button"
        size="sm"
        variant={mode === "chat" ? "default" : "ghost"}
        aria-pressed={mode === "chat"}
        disabled={disabled}
        onClick={() => onModeChange("chat")}
        className="gap-1.5"
      >
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Chat
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "agent" ? "default" : "ghost"}
        aria-pressed={mode === "agent"}
        disabled={disabled}
        onClick={() => onModeChange("agent")}
        className="gap-1.5"
      >
        <Bot className="size-3.5" aria-hidden="true" />
        Agent
      </Button>
    </div>
  );
}
