import { lazy } from "react";
import { FolderOpen } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import "./file-storage.css";

const FileStoragePage = lazy(() => import("./FileStorageModule").then(({ FileStorageModule }) => ({ default: FileStorageModule })));

function FileStorageModule(context: ModuleContext) {
  return <FileStoragePage departmentId={context.departmentId} csrfToken={context.csrfToken} canManage={context.canManageSite || (context.department.modulePermissions?.["file-storage"] ?? []).includes("manage")} />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "file-storage",
  name: "File storage",
  icon: FolderOpen,
  enabledByDefault: true,
  accessLabel: "File storage",
  accessLevels: [{ value: "manage", label: "Manage files", description: "Upload, rename and delete shared files." }],
  pageClassName: "page-wrap-file-storage",
  component: FileStorageModule,
};
