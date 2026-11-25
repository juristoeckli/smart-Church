import { renderCheckInLabelTemplate, type CheckInLabelTemplates } from "@smart-church/contracts";

const formats = {
  a4: { label: "A4 / Letter sheet", page: "auto", height: null },
  "62x38": { label: "62 × 38 mm roll labels", page: "62mm 38mm", height: "38mm" },
  "89x36": { label: "89 × 36 mm roll labels", page: "89mm 36mm", height: "36mm" },
} as const;
export const checkInPrintFormats = Object.entries(formats);

export type CheckInPrintMode = "labels" | "pickup";
type PrintFormat = keyof typeof formats;
export type CheckInPrintOptions = {
  format: PrintFormat;
  surname: "full" | "initial";
  showGroup: boolean;
  showMeeting: boolean;
  stationOutput: CheckInPrintMode;
};
type Person = { firstName: string; lastName: string; groups: string[] };
type PrintItem = { heading: string; name: string; details: string[]; reference?: string; note?: string };

const defaults: CheckInPrintOptions = { format: "a4", surname: "full", showGroup: true, showMeeting: true, stationOutput: "labels" };

export function readCheckInPrintOptions(state: string): CheckInPrintOptions {
  if (!state) return defaults;
  try {
    const options: unknown = JSON.parse(state);
    if (!options || typeof options !== "object") return defaults;
    const value = options as Partial<CheckInPrintOptions>;
    return {
      format: value.format === "62x38" || value.format === "89x36" ? value.format : defaults.format,
      surname: value.surname === "initial" ? "initial" : defaults.surname,
      showGroup: typeof value.showGroup === "boolean" ? value.showGroup : defaults.showGroup,
      showMeeting: typeof value.showMeeting === "boolean" ? value.showMeeting : defaults.showMeeting,
      stationOutput: value.stationOutput === "pickup" ? "pickup" : defaults.stationOutput,
    };
  } catch { return defaults; }
}

function nameWithSurname(person: Person, initialOnly: boolean) {
  const lastName = person.lastName.trim();
  const initial = Array.from(lastName)[0];
  return [person.firstName.trim(), initialOnly && initial ? `${initial}.` : lastName].filter(Boolean).join(" ");
}

type TemplateContext = { templates?: CheckInLabelTemplates; date?: string; title?: string };

export function checkInPrintItems(person: Person, meeting: string, reference: string, mode: CheckInPrintMode, options: CheckInPrintOptions, context?: TemplateContext): PrintItem[] {
  const details = [options.showGroup && person.groups.join(" · "), options.showMeeting && meeting].filter((line): line is string => Boolean(line));
  const customize = (item: PrintItem, template: string | undefined, initialOnly: boolean) => {
    if (!template) return item;
    const lastName = person.lastName.trim();
    const initial = Array.from(lastName)[0];
    const abbreviated = initial ? initial + "." : "";
    const [name, ...lines] = renderCheckInLabelTemplate(template, {
      firstName: person.firstName.trim(), lastName: initialOnly ? abbreviated : lastName,
      "lastName.1": abbreviated, group: options.showGroup ? person.groups.join(" · ") : "",
      meeting: options.showMeeting ? context?.title ?? meeting : "", date: context?.date?.slice(0, 10) ?? "",
    });
    return name ? { ...item, name, details: lines } : item;
  };
  if (mode === "labels") {
    const initialOnly = options.surname === "initial";
    return [customize({ heading: "Name label", name: nameWithSurname(person, initialOnly), details }, context?.templates?.individual, initialOnly)];
  }
  const name = nameWithSurname(person, true);
  return [
    customize({ heading: "Child label", name, details, reference }, context?.templates?.child, true),
    customize({ heading: "Pickup slip", name, details: options.showMeeting && meeting ? [meeting] : [], reference,
      note: "Desk reference only. Staff verifies pickup identity." }, context?.templates?.parent, true),
  ];
}

export function writeCheckInPrintDocument(document: Document, title: string, items: PrintItem[], options: CheckInPrintOptions) {
  document.title = title;
  const format = formats[options.format];
  const printStyles = format.height
    ? `@page{size:${format.page};margin:0} main{display:block}article{height:${format.height};padding:2.5mm;overflow:hidden}strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}article:not(:last-child){break-after:page}`
    : "@page{size:auto;margin:12mm}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:4mm}article{min-height:28mm;padding:3mm;border:1px solid #888}";
  const sheet = document.createElement("style");
  sheet.textContent = "body{font:10pt system-ui,sans-serif;margin:0;color:#000}article{box-sizing:border-box;break-inside:avoid;overflow-wrap:anywhere}strong{font-size:13pt}span,small,strong{display:block}small{font-size:8pt}.checkin-reference{font-weight:700;margin-top:0.6mm}" + printStyles;
  document.head.append(sheet);
  const grid = document.createElement("main");
  for (const item of items) {
    const label = document.createElement("article");
    const append = (tag: "small" | "strong" | "span", value: string, className?: string) => {
      const element = document.createElement(tag);
      element.textContent = value;
      if (className) element.className = className;
      label.append(element);
    };
    append("small", item.heading);
    append("strong", item.name);
    if (item.reference) append("span", `Desk reference: ${item.reference}`, "checkin-reference");
    if (item.note) append("small", item.note);
    for (const detail of item.details) append("small", detail);
    grid.append(label);
  }
  document.body.replaceChildren(grid);
}
