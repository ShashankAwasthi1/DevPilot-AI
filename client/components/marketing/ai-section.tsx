import { FileSearch, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeader } from "@/components/marketing/section-header";

const AI_PRINCIPLES = [
  {
    icon: FileSearch,
    title: "Grounded in your project",
    description: "Answers are meant to draw on your actual project tasks and docs, remembered across the conversation.",
  },
  {
    icon: ShieldCheck,
    title: "Human-approved actions",
    description: "The AI will never silently change project data. Every write action is designed to require explicit confirmation.",
  },
] as const;

export function AISection() {
  return (
    <section id="ai" className="py-20 sm:py-28">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow="AI teammate"
          title={
            <>
              An AI that knows your project{" "}
              <Badge variant="secondary" className="align-middle text-xs">
                In development
              </Badge>
            </>
          }
          subtitle="DevPilot AI is being built around a project-aware assistant, not a bolted-on chat widget. Here's the concept - it isn't live yet."
        />

        <Reveal>
          <Card className="mx-auto max-w-3xl border-dashed">
            <CardContent className="flex flex-col gap-4 py-2">
              <p className="text-sm text-muted-foreground">Example of the intended experience:</p>
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-4 text-sm">
                <p className="font-medium text-foreground">You: &ldquo;What&apos;s the status of the marketing site rebuild?&rdquo;</p>
                <p className="text-muted-foreground">
                  AI: Looks at the project&apos;s real tasks and docs, then answers with links back to what it consulted.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                This is a concept illustration of planned behavior, not a live feature.
              </p>
            </CardContent>
          </Card>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2">
          {AI_PRINCIPLES.map((principle, index) => (
            <Reveal key={principle.title} delay={index * 0.05}>
              <Card className="h-full">
                <CardContent className="flex flex-col gap-3 py-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <principle.icon className="size-4.5" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-medium text-foreground">{principle.title}</h3>
                  <p className="text-sm text-muted-foreground">{principle.description}</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>

        <p className="mx-auto flex max-w-md items-center gap-2 text-center text-xs text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          The AI assistant is on our roadmap and not yet available in the product.
        </p>
      </Container>
    </section>
  );
}
