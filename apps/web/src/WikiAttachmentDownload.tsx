import { useEffect, useRef } from "react";

export function WikiAttachmentDownload({ path }: { path: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.location.assign(path);
  }, [path]);

  return <main className="auth-page"><section className="auth-card">
    <h1>Download Wiki file</h1>
    <p>If the download does not start automatically, use the link below.</p>
    <a className="button button-primary" href={path}>Download file</a>
    <a className="button button-secondary" href="/">Open workspace</a>
  </section></main>;
}
