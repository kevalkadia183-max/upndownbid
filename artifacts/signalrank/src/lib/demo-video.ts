// Safe, allowlist-based resolver for turning a stored demo video URL into an
// embeddable player. Never builds an iframe `src` from the raw stored URL --
// only from a strictly-validated video id extracted from a recognized
// YouTube/YouTube Shorts/Vimeo link, reconstructed against a fixed,
// privacy-enhanced embed host. Anything else (including a malformed or
// unrecognized URL) is treated as "not embeddable" and should instead be
// rendered as a plain external link with rel="noopener noreferrer".
export type ResolvedDemoVideo =
  | { kind: "embed"; embedUrl: string; sourceUrl: string }
  | { kind: "link"; sourceUrl: string };

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_PATTERN = /^[0-9]{6,12}$/;

function tryParseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function resolveYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
    }
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shortsMatch && YOUTUBE_ID_PATTERN.test(shortsMatch[1])) return shortsMatch[1];
    const embedMatch = url.pathname.match(/^\/embed\/([^/]+)/);
    if (embedMatch && YOUTUBE_ID_PATTERN.test(embedMatch[1])) return embedMatch[1];
  }
  return null;
}

function resolveVimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const match = url.pathname.match(/\/(?:video\/)?([0-9]{6,12})(?:\/|$)/);
  return match && VIMEO_ID_PATTERN.test(match[1]) ? match[1] : null;
}

export function resolveDemoVideo(rawUrl: string | null | undefined): ResolvedDemoVideo | null {
  if (!rawUrl) return null;
  const url = tryParseUrl(rawUrl);
  if (!url) return null;

  const youTubeId = resolveYouTubeId(url);
  if (youTubeId) {
    return {
      kind: "embed",
      embedUrl: `https://www.youtube-nocookie.com/embed/${youTubeId}`,
      sourceUrl: url.toString(),
    };
  }

  const vimeoId = resolveVimeoId(url);
  if (vimeoId) {
    return {
      kind: "embed",
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
      sourceUrl: url.toString(),
    };
  }

  return { kind: "link", sourceUrl: url.toString() };
}
