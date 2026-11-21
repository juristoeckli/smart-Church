import { lazy } from "react";
import { Newspaper } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";

export const moduleRegistration: ModuleRegistration = {
  id: "community-feed",
  name: "Community",
  translations: mergeModuleTranslationOverrides("community-feed", translationsForModule("community-feed")),
  icon: Newspaper,
  enabledByDefault: true,
  accessLabel: "Community Feed moderation",
  accessLevels: [{ value: "moderate", label: "Review post reports", description: "View and resolve Community Feed reports for posts you can access at this location." }],
  component: lazy(() => import("./CommunityFeedModule").then(({ CommunityFeedModule }) => ({ default: CommunityFeedModule }))),
};
