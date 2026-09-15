import { Component, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessageRole } from "@/lib/types";

interface MessageBubbleProps {
  role: ChatMessageRole;
  content: string;
}

// Only http:/https:/mailto: links are ever rendered as a real, clickable
// anchor - javascript:, data:, vbscript:, file:, and any other scheme
// degrade to inert text. A fixed placeholder base is used purely so
// relative/scheme-less hrefs can still be parsed for their protocol
// without needing `window` (this component may render on the server).
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isSafeHref(href: string): boolean {
  if (href.length === 0) return false;
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(href, "http://localhost").protocol);
  } catch {
    return false;
  }
}

// react-markdown passes an extra `node` (hast) prop to every custom
// component override, which is not a valid DOM attribute - this strips it
// before the rest of the props are spread onto a real element, without
// creating an unused-but-destructured binding at every call site.
function omitNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest: Partial<T> = { ...props };
  delete rest.node;
  return rest as Omit<T, "node">;
}

type MarkdownAnchorProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function SafeLink(allProps: MarkdownAnchorProps) {
  const { href, children, ...props } = omitNode(allProps);
  if (typeof href !== "string" || !isSafeHref(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-primary"
    >
      {children}
    </a>
  );
}

// Renders a fenced code block as its own <pre><code>, or plain inline code
// otherwise - the default `pre` element is neutralized below (rendered as
// a no-op passthrough) so this is the only place that decides whether a
// <pre> wrapper is added, avoiding a doubled-up <pre><pre>...</pre></pre>.
// Fenced blocks are detected via the `language-*` className remark/rehype
// attaches when the fence specifies a language (e.g. ```js) - an
// unlabeled fence (bare ```) is treated as inline styling instead, a
// known, accepted minor limitation rather than added detection complexity.
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & { node?: unknown };

function CodeBlock(allProps: MarkdownCodeProps) {
  const { className, children, ...props } = omitNode(allProps);
  const isFenced = typeof className === "string" && className.includes("language-");

  if (isFenced) {
    return (
      <pre className="my-2 overflow-x-auto rounded-md bg-muted/70 p-3 font-mono text-xs">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  }

  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
      {children}
    </code>
  );
}

// Kept intentionally small - just enough spacing/sizing so paragraphs,
// lists, headings, blockquotes, and GFM tables read cleanly inside a
// text-sm chat bubble, without pulling in a full typography plugin.
const MARKDOWN_COMPONENTS: Components = {
  pre: ({ children }) => <>{children}</>,
  code: CodeBlock,
  a: SafeLink,
  p: (props) => <p className="mb-2 last:mb-0" {...omitNode(props)} />,
  ul: (props) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...omitNode(props)} />,
  ol: (props) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...omitNode(props)} />,
  li: (props) => <li className="mb-0.5" {...omitNode(props)} />,
  h1: (props) => <h1 className="mb-2 text-base font-semibold" {...omitNode(props)} />,
  h2: (props) => <h2 className="mb-2 text-sm font-semibold" {...omitNode(props)} />,
  h3: (props) => <h3 className="mb-2 text-sm font-semibold" {...omitNode(props)} />,
  blockquote: (props) => (
    <blockquote
      className="mb-2 border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground last:mb-0"
      {...omitNode(props)}
    />
  ),
  table: (props) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs" {...omitNode(props)} />
    </div>
  ),
  th: (props) => <th className="border border-border px-2 py-1 text-left font-medium" {...omitNode(props)} />,
  td: (props) => <td className="border border-border px-2 py-1" {...omitNode(props)} />,
};

interface MarkdownErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface MarkdownErrorBoundaryState {
  failed: boolean;
}

// Smallest possible local safety net: if react-markdown ever throws during
// render for an unanticipated reason, fall back to the exact plain-text
// representation rather than breaking the whole chat panel. A functional
// try/catch cannot catch render errors thrown by a child component, so a
// component-local error boundary is the minimum viable mechanism here -
// not a new global error-boundary architecture.
class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  state: MarkdownErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// User messages stay exactly as before: plain text, never parsed.
// Assistant messages render through react-markdown (GFM enabled via
// remark-gfm) - raw HTML is never parsed (rehype-raw is never added) and
// dangerouslySetInnerHTML is never used anywhere in this file; React's
// normal escaping applies to every text node exactly as it always has.
export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "USER";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <MarkdownErrorBoundary fallback={<div className="whitespace-pre-wrap">{content}</div>}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
              // react-markdown ships its own default `urlTransform` that
              // silently blanks unsafe-looking hrefs to "" before any `a`
              // override even runs - disabled here (identity passthrough)
              // so SafeLink's own explicit protocol check above is the
              // one, single, auditable authority over which links are
              // safe, rather than two independent mechanisms that could
              // otherwise interact in a surprising way.
              urlTransform={(url) => url}
            >
              {content}
            </ReactMarkdown>
          </MarkdownErrorBoundary>
        )}
      </div>
    </div>
  );
}
