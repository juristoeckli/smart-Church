import { lazy } from "react";
import { BookOpenText } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";
import "./wiki.css";

const Page = lazy(() => import("./WikiModule").then(({ WikiModule }) => ({ default: WikiModule })));

export const moduleRegistration: ModuleRegistration = {
  id: "wiki",
  name: "Wiki",
  translations: mergeModuleTranslationOverrides("wiki", translationsForModule("wiki")),
  icon: BookOpenText,
  enabledByDefault: true,
  accessLabel: "Manage Wiki pages",
  accessLevels: [{ value: "manage", label: "Manage Wiki", description: "Create and edit pages, categories, links, and attachments." }],
  pageClassName: "page-wrap-wiki",
  component: Page,
};
