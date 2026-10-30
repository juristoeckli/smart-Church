import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, Check, CircleAlert, Plus, RefreshCw, Users } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./people-flows.css";

type Flow = { id: string; name: string; description: string; status: "active" | "archived"; stepCount: number; activeEnrollmentCount: number; createdAt: string; updatedAt: string };
type Step = { id: string; title: string; instructions: string; position: number; dueAfterDays: number | null; required: boolean; active: boolean };
type ProgressStep = { stepId: string; title: string; position: number; required: boolean; active: boolean; status: "pending" | "completed" | "skipped"; dueOn: string | null; completedAt: string | null };
type Assignment = { id: string; flowId: string; contactId: string; contactName: string; status: "active" | "completed" | "cancelled"; dueOn: string | null; startedAt: string; completedAt: string | null; steps: ProgressStep[] };
type Contact = { id: string; firstName: string; lastName: string; email?: string; status: "member" | "visitor"; importedFrom?: string };
type Audit = { id: string; actorUserId: string | null; action: string; flowId: string | null; enrollmentId: string | null; stepId: string | null; metadata: Record<string, unknown>; createdAt: string };

function statusLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function auditLabel(action: string) {
  const labels: Record<string, string> = {