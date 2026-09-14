"use client";

import { useEffect, useState } from "react";
import { ApiError } from "./api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

// A small, dependency-free stand-in for a data-fetching library. Each
// dashboard section has its own independent loading/error/success
// lifecycle, and this is the one place that lifecycle is implemented so
// the three sections don't each repeat the same effect/state boilerplate.
// If this dashboard grows to need polling, cache invalidation across
// components, or request deduplication, that's the point to introduce
// React Query - not before.
export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    // No synchronous setState here on purpose (React now lints against it -
    // it causes an extra cascading render). The initial state above is
    // already {loading: true}, which covers every current call site (all
    // four dashboard fetches pass a static `[]` and fetch exactly once).
    // If a future caller needs deps that actually change and wants the
    // loading state to reset on each change, that's the point to revisit
    // this - not before.
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const apiError =
          err instanceof ApiError ? err : new ApiError(0, "Something went wrong.");
        setState({ data: null, loading: false, error: apiError });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
