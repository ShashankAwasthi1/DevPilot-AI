import { BarChart3, BookOpen, FolderKanban, MessagesSquare, Sparkles, SquareCheckBig } from "lucide-react";
import { Container } from "@/components/ui/container";
import { FeatureCard } from "@/components/marketing/feature-card";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeader } from "@/components/marketing/section-header";

const FEATURES = [
  {
    icon: FolderKanban,
    title: "Project management",
    description: "Create projects, invite members, and manage roles with real, enforced access control.",
  },
  {
    icon: SquareCheckBig,
    title: "Tasks & workflow",
    description: "A structured board for tracking work from idea to done, with status, priority, and assignment.",
    planned: true,
  },
  {
    icon: BookOpen,
    title: "Documentation & knowledge",
    description: "Write and organize project docs in one place, so context doesn't live only in someone's head.",
  },
  {
    icon: Sparkles,
    title: "Project-aware AI assistant",
    description: "An AI teammate that can answer questions and help plan work using your project's real context.",
    planned: true,
  },
  {
    icon: MessagesSquare,
    title: "Collaboration",
    description: "Comments, notifications, and an activity feed keep everyone aligned on what actually happened.",
  },
  {
    icon: BarChart3,
    title: "Developer analytics",
    description: "Understand throughput and where time actually goes across your projects.",
    planned: true,
  },
] as const;

export function Features() {
  return (
    <section id="features" className="py-20 sm:py-28">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow="Everything in one place"
          title="A workspace built for how developers actually work"
          subtitle="Some capabilities are live today; others are clearly marked as planned so you always know what you're getting."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 0.05}>
              <FeatureCard {...feature} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
