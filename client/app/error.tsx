"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Next.js App Router error-boundary convention (must be a Client Component,
// must accept exactly { error, reset }): catches an otherwise-unhandled
// render exception anywhere under app/ and renders this in its place,
// rather than falling through to Next.js's own generic default error page.
// Deliberately never renders `error.message`/`error.stack`/`error.digest` -
// those are for server-side logs, not this page, and this step explicitly
// adds no logging of its own. Kept free of any data fetching or client
// state beyond the two required props, since a component that itself
// throws while trying to recover from an error would defeat the purpose.
export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="items-center text-center">
            <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
            <CardTitle className="text-xl">Something went wrong</CardTitle>
            <CardDescription>
              An unexpected error occurred. You can try again, or head back to your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
