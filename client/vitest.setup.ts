import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmounts every rendered component after each test - without this,
// components rendered in one test would stay attached to the jsdom
// document and leak into the next test's queries.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these browser APIs. Both are exercised
// indirectly by components under test here (framer-motion's
// useReducedMotion reads matchMedia; next/link's viewport-prefetch
// behavior reads IntersectionObserver) - without a stub, rendering those
// components throws immediately, unrelated to anything the tests actually
// assert on.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof window.IntersectionObserver !== "function") {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
}
