import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  planned?: boolean;
}

export function FeatureCard({ icon: Icon, title, description, planned }: FeatureCardProps) {
  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4.5" aria-hidden="true" />
          </span>
          {planned && <Badge variant="secondary">Planned</Badge>}
        </div>
        {/* A real heading (not CardTitle's div) so screen-reader heading
            navigation surfaces each feature name. */}
        <h3 className="mt-2 font-heading text-base leading-snug font-medium text-foreground">
          {title}
        </h3>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
