"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ProjectSummary, SafeUser } from "@/lib/types";
import { CreateProjectDialog } from "./create-project-dialog";

function initials(user: SafeUser): string {
  const source = user.name?.trim() || user.email;
  return source.slice(0, 2).toUpperCase();
}

interface DashboardHeaderProps {
  user: SafeUser;
  onProjectCreated: (project: ProjectSummary) => void;
}

export function DashboardHeader({ user, onProjectCreated }: DashboardHeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.post("/auth/logout");
    } finally {
      router.push("/login");
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Avatar>
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback>{initials(user)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Welcome back{user.name ? `, ${user.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <CreateProjectDialog
          onCreated={onProjectCreated}
          trigger={
            <Button type="button" className="gap-1.5">
              <Plus className="size-4" aria-hidden="true" />
              Create Project
            </Button>
          }
        />
        <Button variant="outline" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
