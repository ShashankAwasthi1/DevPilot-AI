import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { ProductShowcase } from "@/components/marketing/product-showcase";

export function Hero() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* Static gradient glow only - never animated, per Phase 11 motion guardrails. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-10rem] -z-10 flex justify-center"
      >
        <div className="h-[28rem] w-[56rem] rounded-full bg-primary/20 blur-3xl dark:bg-primary/10" />
      </div>

      <Container className="flex flex-col items-center gap-8 text-center">
        <Reveal>
          <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            Built for developers who ship
          </span>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl md:text-6xl">
            Your projects, docs, and work — with an{" "}
            <span className="text-primary">AI teammate</span> built in
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            DevPilot AI keeps projects, documentation, and team collaboration in one
            workspace for solo developers, small teams, and technical founders — with a
            project-aware AI teammate on the way.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="h-11 w-full px-6 text-base sm:w-auto" asChild>
              <Link href="/login">
                Get started free
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-11 w-full px-6 text-base sm:w-auto" asChild>
              <a href="#features">See how it works</a>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.2} className="w-full">
          <ProductShowcase />
        </Reveal>
      </Container>
    </section>
  );
}
