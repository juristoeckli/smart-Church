import type { UserLanguage } from "@smart-church/contracts";

export type NotificationEmailContent = { subject: string; text: string; html: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

function applicationUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

const emailCopy: Record<UserLanguage, { open: string; footer: string }> = {
  en: { open: "Open Smart Church", footer: "This notification was sent by Smart Church." },
  de: { open: "Smart Church öffnen", footer: "Diese Benachrichtigung wurde von Smart Church gesendet." },
  fr: { open: "Ouvrir Smart Church", footer: "Cette notification a été envoyée par Smart Church." },
  it: { open: "Apri Smart Church", footer: "Questa notifica è stata inviata da Smart Church." },
};

export function renderNotificationEmail(title: string, body: string, webOrigin?: string, language: UserLanguage = "en"): NotificationEmailContent {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body).replace(/\r?\n/g, "<br>");
  const url = applicationUrl(webOrigin);
  const copy = emailCopy[language];
  const text = `${body.trim()}${url ? `\n\n${copy.open}: ${url}` : ""}\n\n${copy.footer}`;
  const action = url
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2456a6;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px">${escapeHtml(copy.open)}</a></p><p style="margin:0;color:#536174;font-size:13px;word-break:break-all">${escapeHtml(url)}</p>`
    : "";
  const html = `<!doctype html><html lang="${language}"><body style="margin:0;background:#f2f5f9;color:#172033;font-family:Arial,Helvetica,sans-serif;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f5f9;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dce3ed;border-radius:14px;overflow:hidden"><tr><td style="background:#172b4d;padding:22px 28px;color:#fff;font-size:16px;font-weight:700">Smart Church</td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#172033">${safeTitle}</h1><p style="margin:0;color:#344256;white-space:normal">${safeBody}</p>${action}<hr style="border:0;border-top:1px solid #e5eaf1;margin:28px 0 16px"><p style="margin:0;color:#64748b;font-size:12px">${escapeHtml(copy.footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: title, text, html };
}
