import { lazy } from "react";
import { Newspaper } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";

export const moduleRegistration: ModuleRegistration = {
  id: "community-feed",
  name: "Community",
  translations: translationsForModule("community-feed"),
  icon: Newspaper,
  enabledByDefault: true,
  component: lazy(() => import("./CommunityFeedModule").then(({ CommunityFeedModule }) => ({ default: CommunityFeedModule }))),
};
