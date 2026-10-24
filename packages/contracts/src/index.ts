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

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin";
}

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AuthenticatedUser;
}

export interface CreateAdminAccount {
  setupCode: string;
  location: string;
  email: string;
  displayName: string;
  password: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
