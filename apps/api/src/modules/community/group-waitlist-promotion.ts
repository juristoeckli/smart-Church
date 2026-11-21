import type { Pool, PoolClient } from "pg";
import { groupAdmissionSlots } from "./signup-capacity.js";
import { readSignupForm } from "./signup-form.js";
import type { groupWaitlist } from "./group-waitlist.js";

type Queue = Awaited<ReturnType<typeof groupWaitlist>>;
export const promotionBatchSize = 10;

export async function previewGroupWaitlistPromotion(db: Pool | PoolClient, departmentId: string, groupId: string, queue: Queue) {
  const { policy } = await readSignupForm(db, departmentId, groupId);
  const available = await groupAdmissionSlots(db, departmentId, groupId, "active", "Member", policy);
  const candidates: Queue = [];
  let stoppedBy: "capacity" | "role" | "archive" | "batch" | null = null;
  for (const entry of queue) {
    if (!entry.activeContact) { stoppedBy = "archive"; break; }
    if (entry.role.trim().toLowerCase() !== "member") { stoppedBy = "role"; break; }
    if (available !== null && candidates.length >= available) { stoppedBy = "capacity"; break; }
    if (candidates.length >= promotionBatchSize) { stoppedBy = "batch"; break; }
    candidates.push(entry);
  }
  return { candidates, stoppedBy, expectedOrder: queue.map(({ contactId }) => contactId) };
}
