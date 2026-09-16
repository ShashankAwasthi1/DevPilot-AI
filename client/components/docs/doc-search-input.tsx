"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DocSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

// Controlled, presentation-only - debouncing and the list/search-mode
// switch both live in the page that owns this input's value, same split
// as TaskFilters (a pure controls surface) vs. task-list.tsx's own logic.
export function DocSearchInput({ value, onChange }: DocSearchInputProps) {
  return (
    <div className="relative">
      <Label htmlFor="doc-search" className="sr-only">
        Search documents
      </Label>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id="doc-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search documents by title or content..."
        className="pl-8 pr-8"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
