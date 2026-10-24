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
  role: "site_admin" | "member";
}

export type UpdateDepartmentProfile = Omit<DepartmentProfile, "id">;

export type CreateDepartment = Omit<DepartmentProfile, "id">;

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  role: "server_admin" | "user";
  mustChangePassword: boolean;
}

export interface SiteUser {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  birthday?: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  phoneNumbers: UserPhoneNumber[];
  relationships: UserRelationship[];
  accountRole: "server_admin" | "user";
  memberships: Array<{ departmentId: string; role: "site_admin" | "member" }>;
}

export interface CreateSiteUser {
  email?: string;
  username: string;
  displayName: string;
  birthday?: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  phoneNumbers?: UserPhoneNumber[];
  relationships?: UserRelationshipInput[];
  password: string;
  accountRole: "server_admin" | "user";
  memberships: Array<{ departmentId: string; role: "site_admin" | "member" }>;
}

export type UserPhoneLabel = "home" | "mobile" | "work" | "work_mobile";

export interface UserPhoneNumber {
  label: UserPhoneLabel;
  number: string;
}

export type UserRelationshipKind = "spouse" | "parent" | "child" | "sibling" | "guardian" | "ward" | "other";

export interface UserRelationship {
  relatedUserId: string;
  relatedUserName: string;
  relationship: UserRelationshipKind;
}

export interface UserRelationshipInput {
  relatedUserId: string;
  relationship: UserRelationshipKind;
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
  username: string;
  displayName: string;
  password: string;
}

export interface LoginCredentials {
  identifier: string;
  password: string;
}
