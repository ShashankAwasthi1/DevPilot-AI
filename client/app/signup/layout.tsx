import type { Metadata } from "next";
import type { ReactNode } from "react";

// Same reasoning and pattern as app/login/layout.tsx - an app screen, not
// a public marketing page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
