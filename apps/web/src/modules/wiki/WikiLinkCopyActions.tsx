import { useState } from "react";

function externalWebUrl(address: string) {
  try {
    const url = new URL(address);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== window.location.hostname ? url : null;
  } catch { return null; }
}

function markdownReference(title: string, url: URL) {
  const label = (title.trim().replace(/\s+/g, " ") || url.hostname).replace(/[\\[\]`*_<>&]/g, "\\$&");
  const destination = url.href.replace(/[<>\\]/g, (character) => encodeURIComponent(character));
  return "[" + label + "](<" + destination + ">)";
}

export function WikiLinkCopyActions({ url, title }: { url: string; title: string }) {
  const [feedback, setFeedback] = useState("");
  const target = externalWebUrl(url);
  if (!target) return null;

  const copy = async (kind: "url" | "markdown") => {
    setFeedback("");
    try {
      const text = kind === "url" ? url.trim() : markdownReference(title, target);
      await navigator.clipboard.writeText(text);
      setFeedback(kind === "url" ? "Link URL copied." : "Markdown reference copied.");
    } catch {
      setFeedback("Could not copy the link. Check your browser clipboard permissions.");
    }
  };

  const label = title.trim() || target.hostname;
  return <div className="wiki-actions">
    <button type="button" className="button button-quiet" aria-label={"Copy URL for " + label} onClick={() => void copy("url")}>Copy URL</button>
    <button type="button" className="button button-quiet" aria-label={"Copy Markdown for " + label} onClick={() => void copy("markdown")}>Copy Markdown</button>
    <small className="wiki-file-meta" role="status">{feedback}</small>
  </div>;
}
