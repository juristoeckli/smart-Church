export type ContactStatus = "member" | "visitor";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status: ContactStatus;
  importedFrom?: "churchtools";
}

export type CreateContact = Omit<Contact, "id">;

export type ServiceEventKind = "service" | "meeting" | "community" | "other";

export interface ServicePosition {
  name: string;
  contactId?: string;
}

export interface ServicePlanItem {
  title: string;
  startTime?: string;
  durationMinutes?: number;
  notes?: string;
}

export interface ServiceEvent {
  id: string;
  title: string;
  kind: ServiceEventKind;
  eventDate: string;
  startTime: string;
  endTime?: string;
  location: string;
  description?: string;
  room?: string;
  assetIds?: string[];
  positions?: ServicePosition[];
  timePlan?: ServicePlanItem[];
  importedFrom?: "churchtools";
}

export type CreateServiceEvent = Omit<ServiceEvent, "id">;

export interface ChurchGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  memberIds: string[];
  createdAt: string;
  importedFrom?: "churchtools";
}

export interface CreateChurchGroup {
  name: string;
  description?: string;
}

export interface StoredFile {
  id: string;
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
}

export interface BookableResource {
  id: string;
  name: string;
  category: "room" | "vehicle" | "equipment" | "other";
  description: string;
  location: string;
  capacity?: number;
  requiresApproval: boolean;
  active: boolean;
  importedFrom?: "churchtools";
}

export interface ResourceBooking {
  id: string;
  resourceId: string;
  resourceName: string;
  requestedBy: string;
  requesterName: string;
  purpose: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "approved" | "declined" | "cancelled";
  createdAt: string;
}

export interface CreateBookableResource {
  name: string;
  category: BookableResource["category"];
  description?: string;
  location?: string;
  capacity?: number;
  requiresApproval: boolean;
  active: boolean;
}

export interface UpdateStoredFile {
  title: string;
  category: string;
}

export interface DepartmentProfile {
  id: string;
  location: string;
  timeZone: string;
  role: "site_admin" | "member" | "unassigned";
  enabledModules?: Array<"video" | "presenter">;
  videoPermissions?: VideoPermission[];
  presenterPermissions?: PresenterPermission[];
}

export type VideoPermission = "video_basic" | "streaming_operator" | "stream_admin" | "routing_user" | "routing_admin";
export type PresenterPermission = "editor" | "operator" | "admin";

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
  memberships: Array<{ departmentId: string; role: "site_admin" | "member"; contactId?: string; videoPermissions?: VideoPermission[]; presenterPermissions?: PresenterPermission[] }>;
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
  memberships: Array<{ departmentId: string; role: "site_admin" | "member"; contactId?: string; videoPermissions?: VideoPermission[]; presenterPermissions?: PresenterPermission[] }>;
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
  csrfToken?: string;
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
