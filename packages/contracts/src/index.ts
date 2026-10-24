export type ContactStatus = "member" | "visitor";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status: ContactStatus;
}

export type CreateContact = Omit<Contact, "id">;

export type ServiceEventKind = "service" | "meeting" | "community" | "other";

export interface ServiceEvent {
  id: string;
  title: string;
  kind: ServiceEventKind;
  eventDate: string;
  startTime: string;
  endTime?: string;
  location: string;
  description?: string;
}

export type CreateServiceEvent = Omit<ServiceEvent, "id">;

export interface DepartmentProfile {
  id: string;
  location: string;
  timeZone: string;
}

export type UpdateDepartmentProfile = Omit<DepartmentProfile, "id">;
