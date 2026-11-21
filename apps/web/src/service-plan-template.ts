import type { ServiceEvent, ServicePlanTemplate } from "@smart-church/contracts";

export function templateFromServiceAgenda(event: ServiceEvent): Omit<ServicePlanTemplate, "id"> {
  return {
    name: Array.from(event.title).slice(0, 160).join(""),
    positions: (event.positions ?? []).map(({ name, category, qualificationIds }) => ({
      name, category, qualificationIds: qualificationIds ? [...qualificationIds] : undefined,
    })),
    items: (event.timePlan ?? []).map(({ section, title, startTime, durationMinutes, notes, songId, arrangementId, position }) => ({
      section, title, startTime, durationMinutes, notes, songId, arrangementId, position,
    })),
    active: true,
  };
}
