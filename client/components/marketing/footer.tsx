import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Container } from "@/components/ui/container";

export function Footer() {
  return (
    <footer className="border-t border-border py-10">
      <Container className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
          </span>
          DevPilot AI
        </Link>
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} DevPilot AI. All rights reserved.
        </p>
      </Container>
    </footer>
  );
}
