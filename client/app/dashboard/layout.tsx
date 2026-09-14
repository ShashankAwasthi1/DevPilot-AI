import type { Metadata } from "next";

// The dashboard is a private, authenticated app screen - keep it out of
// search results without touching the client-component page.tsx itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return children;
}
