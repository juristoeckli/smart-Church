import packageInfo from "../../../package.json";

export const smartChurchBuildInfo = {
  release: import.meta.env.VITE_SMART_CHURCH_VERSION || packageInfo.version,
  buildNumber: import.meta.env.VITE_SMART_CHURCH_BUILD_NUMBER || "local",
};
