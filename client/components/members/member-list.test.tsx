import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberList } from "./member-list";
import type { ProjectMember, ProjectRole } from "@/lib/types";

const MEMBER_ROW: ProjectMember = {
  userId: "user-2",
  name: "Jamie Chen",
  email: "jamie@example.com",
  role: "MEMBER",
};

function renderList(currentUserRole: ProjectRole) {
  return render(
    <MemberList
      members={[MEMBER_ROW]}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      currentUserRole={currentUserRole}
      onUpdateRole={vi.fn().mockResolvedValue(MEMBER_ROW)}
      onRemove={vi.fn().mockResolvedValue(MEMBER_ROW)}
    />,
  );
}

// UI gating only - as lib/permissions.ts's own comment states, this is
// never the actual security boundary (the server independently re-checks
// every one of these rules on every request). These tests protect against
// the UI *look* broken/inconsistent - e.g. a VIEWER seeing a button that
// would just 403 if clicked - never a claim that the UI is what prevents
// unauthorized access.
test("MemberList: a VIEWER sees no role-change select and no remove button for another member", () => {
  renderList("VIEWER");

  expect(screen.queryByLabelText(/change role for jamie chen/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /remove jamie chen/i })).not.toBeInTheDocument();
});

test("MemberList: a plain MEMBER sees no role-change select and no remove button for another member", () => {
  renderList("MEMBER");

  expect(screen.queryByLabelText(/change role for jamie chen/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /remove jamie chen/i })).not.toBeInTheDocument();
});

test("MemberList: an ADMIN sees both the role-change select and the remove button", () => {
  renderList("ADMIN");

  expect(screen.getByLabelText(/change role for jamie chen/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /remove jamie chen/i })).toBeInTheDocument();
});

test("MemberList: an OWNER sees both the role-change select and the remove button", () => {
  renderList("OWNER");

  expect(screen.getByLabelText(/change role for jamie chen/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /remove jamie chen/i })).toBeInTheDocument();
});

// The owner's own row is never editable/removable through this UI (or the
// API it calls), regardless of the viewer's own role - see
// project-member.service.ts's 409s.
test("MemberList: the OWNER's own row never shows a role-change select or remove button, even to another OWNER-level viewer", () => {
  render(
    <MemberList
      members={[{ userId: "user-1", name: "Alex Owner", email: "alex@example.com", role: "OWNER" }]}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      currentUserRole="OWNER"
      onUpdateRole={vi.fn()}
      onRemove={vi.fn()}
    />,
  );

  expect(screen.queryByLabelText(/change role for alex owner/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /remove alex owner/i })).not.toBeInTheDocument();
});
