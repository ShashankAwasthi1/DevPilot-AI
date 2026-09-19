import type { Metadata } from "next";

// Same reasoning and pattern as app/login/layout.tsx - an app screen, not
// a public marketing page.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: LayoutProps<"/signup">) {
  return children;
}
