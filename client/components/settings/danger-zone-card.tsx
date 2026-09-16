"use client";

import { useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";

interface DangerZoneCardProps {
  projectName: string;
  onArchive: () => Promise<void>;
}

// Same inline confirm-swap pattern as DocRow's archive confirm and
// MemberRow's remove confirm - reused rather than introducing a new
// confirmation primitive. The caller only ever renders this card when
// canArchiveProject(project.role) is true (see
// app/projects/[id]/settings/page.tsx) - this component does no
// permission checking of its own, and the server remains the actual
// authorization boundary regardless.
export function DangerZoneCard({ projectName, onArchive }: DangerZoneCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startConfirming(event: MouseEvent) {
    event.stopPropagation();
    setError(null);
    setConfirming(true);
  }

  function cancel(event: MouseEvent) {
    event.stopPropagation();
    setConfirming(false);
    setError(null);
  }

  async function confirmArchive(event: MouseEvent) {
    event.stopPropagation();
    if (archiving) return;
    setArchiving(true);
    setError(null);
    try {
      await onArchive();
      // On success the caller navigates away (see the page's
      // handleArchive) - nothing further to do here.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setArchiving(false);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent>
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Archive project?</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{projectName}</span> will be archived. This is a
              soft archive - the project and its data are kept, but it will no longer appear in your project
              list. The current DevPilot UI does not provide a way to restore or unarchive a project.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={confirmArchive} disabled={archiving}>
                {archiving ? "Archiving…" : "Archive project"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={archiving}>
                Cancel
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Archive project</p>
              <p className="text-sm text-muted-foreground">
                Hides this project from your project list. This cannot be undone from the UI.
              </p>
            </div>
            <Button type="button" variant="destructive" size="sm" className="shrink-0" onClick={startConfirming}>
              Archive project
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
