export type ContactStatus = "member" | "visitor";

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status: ContactStatus;
  importedFrom?: "churchtools" | "elvanto";
  elvantoProfile?: Record<string, unknown>;
}

export type CreateContact = Omit<Contact, "id">;

export type ServiceEventKind = "service" | "meeting" | "community" | "other";

export interface ServicePosition {
  name: string;
  contactId?: string;
  responseStatus?: "pending" | "accepted" | "declined";
  canRespond?: boolean;
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
  isAllDay?: boolean;
  startTime: string;
  endTime?: string;
  location: string;
  description?: string;
  room?: string;
  assetIds?: string[];
  positions?: ServicePosition[];
  timePlan?: ServicePlanItem[];
  attendanceAdults?: number;
  attendanceChildren?: number;
  attendanceRecordedAt?: string;
  registrationEnabled?: boolean;
  registrationCapacity?: number;
  registrationToken?: string;
  registrationCount?: number;
  seriesId?: string;
  importedFrom?: "churchtools" | "elvanto";
}

export interface ServiceEventCheckIn {
  contactId: string;
  firstTimeVisitor: boolean;
  followUpStatus: "not_needed" | "needed" | "done";
  checkedInAt: string;
}

export interface VisitorFollowUp {
  eventId: string;
  contactId: string;
  firstName: string;
  lastName: string;
  eventTitle: string;
  eventDate: string;
  status: "needed" | "done" | "not_needed";
  assignedContactId?: string;
  assignedFirstName?: string;
  assignedLastName?: string;
  dueDate?: string;
  note: string;
  checkedInAt: string;
}

export interface EventRecurrence {
  interval: "weekly" | "biweekly" | "monthly";
  endDate: string;
}

export type CreateServiceEvent = Omit<ServiceEvent, "id" | "seriesId" | "registrationToken" | "registrationCount"> & { recurrence?: EventRecurrence };

export interface EventRegistration {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "registered" | "waitlisted";
  registeredAt: string;
  checkedInAt?: string;
}

export interface PublicRegistrationEvent {
  title: string;
  eventDate: string;
  isAllDay?: boolean;
  startTime: string;
  endTime?: string;
  location: string;
  description?: string;
  capacity?: number;
  registeredCount: number;
  waitlistCount: number;
  registrationOpen: boolean;
}

export interface ChurchGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  memberIds: string[];
  memberDetails?: ChurchGroupMembership[];
  createdAt: string;
  publicSignupEnabled?: boolean;
  publicSignupToken?: string;
  importedFrom?: "churchtools" | "elvanto";
}

export interface ChurchGroupMembership {
  contactId: string;
  role: string;
  status: "active" | "paused" | "waitlist";
  joinedOn?: string;
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
  enabledModules?: string[];
  permissions?: LocationPermission[];
  videoPermissions?: VideoPermission[];
  presenterPermissions?: PresenterPermission[];
  modulePermissions?: Record<string, string[]>;
}

export type VideoPermission = "video_basic" | "streaming_operator" | "stream_admin" | "routing_user" | "routing_admin";
export type PresenterPermission = "editor" | "operator" | "admin";
export type LocationPermission = "people_view_private" | "people_manage" | "events_manage" | "groups_manage" | "resources_manage";
export type ServerPermission = "server_view" | "server_troubleshoot" | "server_manage";

export type UpdateDepartmentProfile = Omit<DepartmentProfile, "id">;

export type CreateDepartment = Omit<DepartmentProfile, "id">;

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  role: "server_admin" | "user";
  mustChangePassword: boolean;
  dateTimeFormat: DateTimeFormat;
  language: UserLanguage;
  languageIsCustom: boolean;
  serverPermissions: ServerPermission[];
}

export type DateTimeFormat = "DD.MM.YYYY HH:MM" | "DD/MM/YYYY HH:MM" | "MM/DD/YYYY h:mm AM/PM" | "YYYY-MM-DD HH:MM";
export type UserLanguage = "en" | "de" | "fr" | "it";

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
  serverPermissions: ServerPermission[];
  memberships: Array<{ departmentId: string; role: "site_admin" | "member"; contactId?: string; permissions?: LocationPermission[]; videoPermissions?: VideoPermission[]; presenterPermissions?: PresenterPermission[]; modulePermissions?: Record<string, string[]> }>;
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
  serverPermissions?: ServerPermission[];
  memberships: Array<{ departmentId: string; role: "site_admin" | "member"; contactId?: string; permissions?: LocationPermission[]; videoPermissions?: VideoPermission[]; presenterPermissions?: PresenterPermission[]; modulePermissions?: Record<string, string[]> }>;
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
  selfSignupEnabled?: boolean;
  httpAccessMode?: HttpAccessMode;
  httpsOrigin?: string | null;
  setupLocation?: string;
  user?: AuthenticatedUser;
  csrfToken?: string;
}

export type HttpAccessMode = "none" | "warning" | "redirect";

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
