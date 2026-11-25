import type { ServicePlanItem } from "@smart-church/contracts";

export type RowSide = "before" | "after";

export function moveRunSheetItem(items: ServicePlanItem[], from: number, target: number, side: RowSide) {
  if (!items[from] || !items[target] || from === target) return items;
  const insertAt = target + (side === "after" ? 1 : 0);
  const destination = insertAt > from ? insertAt - 1 : insertAt;
  if (destination === from) return items;
  const next = [...items];
  next.splice(from, 1);
  next.splice(destination, 0, items[from]);
  return next;
}

export function insertRunSheetItem(items: ServicePlanItem[], index: number, side: RowSide) {
  const anchor = items[index];
  if (!anchor) return items;
  const blank: ServicePlanItem = { title: "", ...(anchor.section ? { section: anchor.section } : {}) };
  const at = index + (side === "after" ? 1 : 0);
  return [...items.slice(0, at), blank, ...items.slice(at)];
}
