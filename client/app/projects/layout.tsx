import type { Metadata } from "next";

// Project pages are authenticated app screens, not public marketing pages -
// same reasoning and pattern as app/login/layout.tsx and
// app/dashboard/layout.tsx.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ProjectsLayout({ children }: LayoutProps<"/projects">) {
  return children;
}
