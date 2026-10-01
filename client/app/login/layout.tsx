import type { Metadata } from "next";
import type { ReactNode } from "react";

// Login is an app screen, not a public marketing page - keep it out of
// search results without touching the client-component page.tsx itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
