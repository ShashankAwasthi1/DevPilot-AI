import { Bell, CheckCircle2, FileText, FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// A static, illustrative mock of the real dashboard UI (Phase 10) - not a
// screenshot, not live data. Content is clearly placeholder example copy so
// it never reads as an actual user's projects/tasks. Activity examples are
// limited to document events, since those are the only activity types that
// can genuinely occur end-to-end with the current backend (comments require
// a Task, and there is no Task-creation API yet).
const EXAMPLE_PROJECTS = [
  { name: "Marketing site rebuild", role: "Owner", updated: "2h ago" },
  { name: "Mobile app redesign", role: "Admin", updated: "1d ago" },
];

const EXAMPLE_ACTIVITY = [
  { icon: FileText, text: "Document \"API conventions\" created" },
  { icon: CheckCircle2, text: "Document \"Onboarding guide\" updated" },
];

export function ProductShowcase() {
  return (
    <div className="relative mx-auto max-w-4xl">
      <span className="sr-only">Example preview of the DevPilot AI dashboard</span>

      <Card className="overflow-hidden py-0 shadow-xl ring-1 ring-foreground/10">
        {/* Fake browser chrome - purely decorative framing. */}
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-4 py-2.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-foreground/20" />
          <span className="size-2.5 rounded-full bg-foreground/20" />
          <span className="size-2.5 rounded-full bg-foreground/20" />
        </div>

        <div className="grid gap-4 p-5 text-left sm:grid-cols-3" aria-hidden="true">
          <div className="flex flex-col gap-3 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Your projects</span>
              <Badge variant="outline" className="gap-1">
                <FolderKanban className="size-3" />
                Projects
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {EXAMPLE_PROJECTS.map((project) => (
                <Card key={project.name} size="sm">
                  <CardHeader>
                    <CardTitle className="text-sm">{project.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{project.role}</span>
                    <span>Updated {project.updated}</span>
                  </CardContent>
                </Card>
              ))}
            </div>

            <span className="mt-2 text-xs font-medium text-muted-foreground">Recent activity</span>
            <div className="flex flex-col gap-2">
              {EXAMPLE_ACTIVITY.map((item) => (
                <div
                  key={item.text}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground"
                >
                  <item.icon className="size-3.5 shrink-0 text-primary" />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Notifications</span>
              <Bell className="size-3.5 text-muted-foreground" />
            </div>
            <Card size="sm">
              <CardContent className="flex flex-col gap-2 text-xs text-foreground">
                <div className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  New comment on a task assigned to you
                </div>
              </CardContent>
            </Card>

            <Card size="sm" className="border-dashed">
              <CardContent className="flex flex-col gap-1.5 text-xs">
                <Badge variant="secondary" className="w-fit">
                  Concept preview
                </Badge>
                <p className="text-muted-foreground">
                  &ldquo;Summarize what changed in this project this week.&rdquo;
                </p>
                <p className="text-foreground">
                  An AI teammate that answers using your project&apos;s real data — in active development.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </Card>
    </div>
  );
}
