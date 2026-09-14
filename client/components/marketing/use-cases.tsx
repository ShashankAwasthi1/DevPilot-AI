import { Briefcase, Code2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeader } from "@/components/marketing/section-header";

const USE_CASES = [
  {
    icon: Code2,
    title: "Solo developers",
    description: "Run multiple side projects without losing track of what's where or what's next.",
  },
  {
    icon: Users,
    title: "Small dev teams",
    description: "Shared visibility into project status and docs, without the overhead of enterprise PM tools.",
  },
  {
    icon: Briefcase,
    title: "Technical founders",
    description: "Lightweight project tracking and a knowledge base in one place while you're still small.",
  },
] as const;

export function UseCases() {
  return (
    <section id="use-cases" className="py-20 sm:py-28">
      <Container className="flex flex-col gap-12">
        <SectionHeader eyebrow="Who it's for" title="Built for the way small teams actually work" />

        <div className="grid gap-4 sm:grid-cols-3">
          {USE_CASES.map((useCase, index) => (
            <Reveal key={useCase.title} delay={index * 0.06}>
              <Card className="h-full">
                <CardContent className="flex flex-col items-center gap-3 py-4 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <useCase.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-medium text-foreground">{useCase.title}</h3>
                  <p className="text-sm text-muted-foreground">{useCase.description}</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
