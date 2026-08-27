import type { ReactNode } from "react";

// Minimal, dependency-free renderer for the small subset of markdown used in
// seeded/admin-edited policy content: headings (#, ##, ###), bold (**text**),
// links ([text](url)), unordered lists (- item), ordered lists (1. item),
// and paragraphs separated by blank lines. Anything else is rendered as
// plain text, since policy content is admin-authored, not third-party HTML.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Matches **bold** or [label](url) tokens, left to right.
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      const href = match[3];
      const isInternal = href.startsWith("/");
      nodes.push(
        isInternal ? (
          <a key={`${keyPrefix}-l-${index}`} href={href} className="text-primary underline underline-offset-2 hover:text-primary/80">
            {match[2]}
          </a>
        ) : (
          <a
            key={`${keyPrefix}-l-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {match[2]}
          </a>
        ),
      );
    }
    lastIndex = match.index + match[0].length;
    index += 1;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function MarkdownLite({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let blockIndex = 0;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    if (text) {
      blockIndex += 1;
      blocks.push(
        <p key={`p-${blockIndex}`} className="text-sm leading-relaxed text-muted-foreground">
          {renderInline(text, `p-${blockIndex}`)}
        </p>,
      );
    }
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blockIndex += 1;
    const items = list.items.map((item, itemIndex) => (
      <li key={`li-${blockIndex}-${itemIndex}`} className="text-sm leading-relaxed text-muted-foreground">
        {renderInline(item, `li-${blockIndex}-${itemIndex}`)}
      </li>
    ));
    blocks.push(
      list.type === "ul" ? (
        <ul key={`list-${blockIndex}`} className="list-disc space-y-1.5 pl-5">
          {items}
        </ul>
      ) : (
        <ol key={`list-${blockIndex}`} className="list-decimal space-y-1.5 pl-5">
          {items}
        </ol>
      ),
    );
    list = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const unorderedItem = /^[-*]\s+(.*)$/.exec(line);
    const orderedItem = /^\d+\.\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      blockIndex += 1;
      const level = heading[1].length;
      const text = heading[2];
      // The page shell already renders the document title as the sole <h1>
      // (see PolicyPage), so a level-1 markdown heading here is the same
      // title repeated in the body -- skip it to avoid a duplicate <h1> and
      // keep the outline starting at <h2>.
      if (level === 1) {
        continue;
      } else if (level === 2) {
        blocks.push(
          <h2 key={`h-${blockIndex}`} className="mt-8 text-lg font-bold uppercase tracking-wider text-foreground">
            {renderInline(text, `h-${blockIndex}`)}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={`h-${blockIndex}`} className="mt-6 text-sm font-bold uppercase tracking-wider text-foreground">
            {renderInline(text, `h-${blockIndex}`)}
          </h3>,
        );
      }
      continue;
    }
    if (unorderedItem) {
      flushParagraph();
      if (list?.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unorderedItem[1]);
      continue;
    }
    if (orderedItem) {
      flushParagraph();
      if (list?.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(orderedItem[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return <div className="space-y-3 font-mono">{blocks}</div>;
}
