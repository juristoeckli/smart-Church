import { lazy } from "react";
import { Video } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import { videoTabs, type VideoTab } from "./VideoModule";

const VideoWorkspace = lazy(() => import("./VideoModule").then(({ VideoModule }) => ({ default: VideoModule })));

function capabilities(context: ModuleContext) {
  const grants = new Set(context.department.modulePermissions?.video ?? context.department.videoPermissions ?? []);
  const admin = context.canManageSite;
  return {
    canOperateStreaming: admin || grants.has("streaming_operator") || grants.has("stream_admin"),
    canManageEncoders: admin || grants.has("stream_admin"),
    canManageRouting: admin || grants.has("routing_user") || grants.has("routing_admin"),
    canAdminRouting: admin || grants.has("routing_admin"),
  };
}

function VideoWorkspacePage(context: ModuleContext) {
  const tab = videoTabs.includes(context.state as VideoTab) ? context.state as VideoTab : "Overview";
  return <VideoWorkspace departmentId={context.departmentId} csrfToken={context.csrfToken} capabilities={capabilities(context)} tab={tab} onTabChange={context.onStateChange} />;
}

function VideoNavigation({ context }: { context: ModuleContext }) {
  const caps = capabilities(context);
  const tab = videoTabs.includes(context.state as VideoTab) ? context.state as VideoTab : "Overview";
  return <div className="nav-submenu" aria-label="Video sections">{videoTabs.filter((section) => section !== "Names & locks").flatMap((section) => {
    const active = tab === section || (section === "Routing" && tab === "Names & locks");
    const items = [<button className={`nav-item nav-sub-item ${active && tab !== "Names & locks" ? "nav-item-active" : ""}`} type="button" key={section} aria-current={tab === section ? "page" : undefined} onClick={() => context.onStateChange(section)}><span>{section}</span>{active && tab !== "Names & locks" && <span className="nav-indicator" />}</button>];
    if (section === "Routing" && caps.canAdminRouting) items.push(<button className={`nav-item nav-sub-item nav-sub-item-child ${tab === "Names & locks" ? "nav-item-active" : ""}`} type="button" key="Names & locks" aria-current={tab === "Names & locks" ? "page" : undefined} onClick={() => context.onStateChange("Names & locks")}><span>Names &amp; locks</span>{tab === "Names & locks" && <span className="nav-indicator" />}</button>);
    return items;
  })}</div>;
}

export const moduleRegistration: ModuleRegistration = {
  id: "video",
  name: "Video & streaming",
  icon: Video,
  initialState: "Overview",
  accessLabel: "Video & streaming",
  accessLevels: [
    { value: "video_basic", label: "View status, streams, routes and history" },
    { value: "streaming_operator", label: "Operate streaming" },
    { value: "stream_admin", label: "Manage stream settings" },
    { value: "routing_user", label: "Use routing" },
    { value: "routing_admin", label: "Manage routing and locks" },
  ],
  pageClassName: "page-wrap-video",
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("video") && (canManageSite || (department.videoPermissions ?? []).length > 0),
  component: VideoWorkspacePage,
  navigation: VideoNavigation,
};
