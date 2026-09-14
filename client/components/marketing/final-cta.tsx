import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";

export function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <Card className="mx-auto max-w-3xl border-none bg-primary text-primary-foreground shadow-lg">
            <CardContent className="flex flex-col items-center gap-6 py-8 text-center">
              {/* Matches SectionHeader's h2 scale (text-3xl sm:text-4xl) for a
                  consistent type scale across the page. SectionHeader itself
                  isn't reused here because its heading/subtitle colors
                  (text-foreground/text-muted-foreground) are tuned for the
                  page background, not for this card's solid bg-primary. */}
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Bring your projects, docs, and team into one workspace
              </h2>
              <p className="max-w-md text-primary-foreground/80">
                Free to get started. No credit card required.
              </p>
              <Button size="lg" variant="secondary" className="h-11 w-full px-6 text-base sm:w-auto" asChild>
                <Link href="/login">
                  Get started free
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Reveal>
      </Container>
    </section>
  );
}
