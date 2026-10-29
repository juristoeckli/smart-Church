import { lazy } from "react";
import { Newspaper } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "community-feed",
  name: "Community",
  icon: Newspaper,
  enabledByDefault: true,
  component: lazy(() => import("./CommunityFeedModule").then(({ CommunityFeedModule }) => ({ default: CommunityFeedModule }))),
};
