export type AppointmentTemplateFields = {
  title: string;
  subtitle: string;
  description: string;
  place: string;
  url: string;
  internalOnly: boolean;
};
export type AppointmentTemplate = AppointmentTemplateFields & { id: string; name: string; tags: string[] };

export function applyAppointmentTemplate<T extends AppointmentTemplateFields & { tags: string }>(draft: T, template: AppointmentTemplate): T {
  const { title, subtitle, description, place, url, internalOnly, tags } = template;
  return {
    ...draft, title, subtitle, description, place, url,
    internalOnly: draft.internalOnly || internalOnly,
    tags: tags.join(", "),
  };
}
