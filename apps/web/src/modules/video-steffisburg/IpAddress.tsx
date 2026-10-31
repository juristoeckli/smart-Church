import { useState } from "react";
import type { UserLanguage } from "@smart-church/contracts";
import { ModuleTranslationHost } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";

const videoTranslations = mergeModuleTranslationOverrides("video-steffisburg", translationsForModule("video-steffisburg"));

export async function copyIpText(value: string) {
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch { /* Try the selection-based fallback for browsers without clipboard permission. */ }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { /* Clipboard access may be blocked. */ }
  input.remove();
  return copied;
}

export function IpAddress({ value, fallback = "Address not configured", language = "en" }: { value?: string | null; fallback?: string; language?: UserLanguage }) {
  const [copied, setCopied] = useState(false);
  const ip = value ?? "";
  if (!ip) return <ModuleTranslationHost translations={videoTranslations} language={language}><code className="video-ip-address video-ip-address-empty">{fallback}</code></ModuleTranslationHost>;

  async function copy() {
    const success = await copyIpText(ip);
    setCopied(success);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return <ModuleTranslationHost translations={videoTranslations} language={language}><code
    className="video-ip-address"
    role="button"
    tabIndex={0}
    title={copied ? "IP address copied" : "Double-click to copy IP address"}
    aria-label={`IP address ${ip}. Double-click to copy.`}
    onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); void copy(); }}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void copy(); } }}
  >{ip}</code></ModuleTranslationHost>;
}
