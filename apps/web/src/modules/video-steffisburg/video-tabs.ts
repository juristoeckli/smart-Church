export const videoTabs = ["Overview", "Routing", "Names & locks", "Streaming", "XML tools"] as const;
export type VideoTab = typeof videoTabs[number];
