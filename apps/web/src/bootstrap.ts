import type { HttpAccessMode } from "@smart-church/contracts";

type HttpAccessSettings = { mode: HttpAccessMode; httpsOrigin: string | null };

function secureUrl(httpsOrigin: string) {
  return new URL(`${window.location.pathname}${window.location.search}${window.location.hash}`, httpsOrigin).toString();
}

async function startWebApp() {
  if (window.location.protocol === "http:") {
    let settings: HttpAccessSettings | null = null;
    try {
      const response = await fetch("/api/public/http-access", { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(3000) });
      if (response.ok) settings = await response.json() as HttpAccessSettings;
    } catch { /* The sign-in page can still show the API's normal connection error. */ }

    if (settings?.mode === "redirect" && settings.httpsOrigin) {
      window.location.replace(secureUrl(settings.httpsOrigin));
      return;
    }

    if (settings?.mode === "warning") {
      const banner = document.getElementById("http-access-warning");
      if (banner) {
        banner.append(document.createTextNode("This connection is not encrypted. "));
        if (settings.httpsOrigin) {
          const link = document.createElement("a");
          link.href = secureUrl(settings.httpsOrigin);
          link.textContent = "Open the secure HTTPS version";
          banner.append(link);
        } else {
          banner.append(document.createTextNode("Use the secure HTTPS address provided by your administrator."));
        }
        banner.hidden = false;
      }
    }
  }

  await import("./main");
}

void startWebApp();
