import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeader } from "@/components/marketing/section-header";

const STEPS = [
  {
    title: "Create a project",
    description: "Set up a project and invite the people who need to see it.",
  },
  {
    title: "Add docs and structure",
    description: "Capture project knowledge so context lives in one place, not in someone's head.",
  },
  {
    title: "Collaborate as you work",
    description: "Comment, get notified, and see a real activity feed of what happened and when.",
  },
  {
    title: "Bring in the AI teammate",
    description: "As the AI assistant ships, it plugs into the same project context - no separate tool to manage.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <Container className="flex flex-col gap-12">
        <SectionHeader eyebrow="How it works" title="One workspace, from project setup to daily collaboration" />

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.06}>
              <div className="flex flex-col gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <h3 className="text-base font-medium text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
