export function isPastorServiceRole(name: string) { return /^(?:pastor(?:in|e|a)?|pfarrer(?:in)?|pasteur(?:e)?|ministre)$/iu.test(name.trim()); }

export { isWikiAttachmentDownloadPath, wikiAttachmentDownloadPath, wikiAttachmentSignInLocation } from "./wiki-download.js";

export type ContactStatus = "member" | "visitor";

export interface ContactRelationship {
  sourceRelationshipId?: string;
  relatedContactId: string;
  relatedFirstName: string;
  relatedLastName: string;
  relationshipName?: string;
  degreeOfRelationship?: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  status: ContactStatus;
  archivedAt?: string;
  importedFrom?: "churchtools" | "elvanto";
  elvantoProfile?: Record<string, unknown>;
  churchtoolsProfile?: Record<string, unknown>;
  churchtoolsRelationships?: ContactRelationship[];
}

export type CreateContact = Omit<Contact, "id" | "archivedAt">;

export type ServiceEventKind = "service" | "meeting" | "community" | "other";

export interface ServicePosition {
  sourcePastorName?: string;
  name: string;
  swapAllowed?: boolean;
  category?: string;
  contactId?: string;
  qualificationIds?: string[];
  responseStatus?: "pending" | "accepted" | "declined";
  canRespond?: boolean;
}

export interface ServiceEventFactDefinition {
  id: string;
  label: string;
  kind: "number" | "select";
  unit: string | null;
  options: string[];
  archivedAt: string | null;
}

export type ServiceEventCustomFactTotal =
  | { id: string; total: string }
  | { id: string; counts: Array<{ value: string; count: string }> };

export interface ServiceEventFacts {
  visitors?: number;
  firstTimeVisitors?: number;
  collection?: { amount: string; currency: string };
  custom?: Record<string, string>;
}

export interface ServiceEventFactsPeriod {
  period: string;
  visitors: string | null;
  firstTimeVisitors: string | null;
  collections: Array<{ amount: string; currency: string }>;
  custom?: ServiceEventCustomFactTotal[];
}


export type LiveRunSheetAction = "start" | "previous" | "next" | "pause" | "resume" | "stop";
export type LiveRunSheetStatus = {
  revision: string | null;
  active: {
    mode: "running" | "paused";
    index: number;
    title: string;
    previous: boolean;
    nextTitle: string | null;
    remainingMs: number | null;
  } | null;
};

export interface ServicePlanItem {
  agendaItemId?: string;
  section?: string;
  title: string;
  startTime?: string;
  durationMinutes?: number;
  notes?: string;
  songId?: string;
  arrangementId?: string;
  position?: string;
}

export interface WorshipSongArrangement {
  id: string;
  name: string;
  key?: string;
  chartUrl?: string;
  audioUrl?: string;
  active: boolean;
}

export interface WorshipSong {
  id: string;
  title: string;
  authors?: string;
  defaultKey?: string;
  bpm?: number;
  timeSignature?: string;
  notes?: string;
  arrangements: WorshipSongArrangement[];
  active: boolean;
}

export interface ServicePlanTemplate {
  id: string;
  name: string;
  description?: string;
  positions: Array<Pick<ServicePosition, "name" | "category" | "qualificationIds" | "swapAllowed">>;
  items: ServicePlanItem[];
  active: boolean;
}

export interface ServiceEvent {
  pastorNames?: string[];
  canManageAttachments?: boolean;
  responsibleContactId?: string | null;
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
  sharedAgendaSourceId?: string;
  attendanceAdults?: number;
  attendanceChildren?: number;
  attendanceRecordedAt?: string;
  registrationEnabled?: boolean;
  registrationCapacity?: number;
  registrationToken?: string;
  registrationCount?: number;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
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
  partyId?: string | null;
  additionalAttendee?: boolean;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "registered" | "waitlisted";
  registeredAt: string;
  checkedInAt?: string;
}

export interface RegistrationQuestion {
  id: string;
  label: string;
  type: "text" | "choice";
  required: boolean;
  options?: string[];
}

export interface PublicRegistrationEvent {
  formRevision?: string;
  questions?: RegistrationQuestion[];
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

export interface PublicRegistrationReceiptStatus extends Pick<PublicRegistrationEvent, "title" | "eventDate" | "isAllDay" | "startTime" | "endTime" | "location"> {
  status: "registered" | "waitlisted" | "cancelled";
  eventCancelled: boolean;
  canCancel: boolean;
}

export interface ChurchGroup {
  id: string;
  name: string;
  description: string;
  groupType?: string;
  status: GroupLifecycleStatus;
  startsOn: string | null;
  endsOn: string | null;
  memberCount: number;
  memberIds: string[];
  memberDetails?: ChurchGroupMembership[];
  createdAt: string;
  publicSignupEnabled?: boolean;
  publicSignupToken?: string;
  meetingPin?: { latitude: number; longitude: number };
  meetingPlace?: GroupMeetingPlace;
  publicMeetingPlace?: boolean;
  importedFrom?: "churchtools" | "elvanto";
}

export type GroupMeetingPlace = {
  name: string;
  street: string;
  postalCode: string;
  locality: string;
  country: string;
  visibility: "managers" | "members";
};

export type GroupLifecycleStatus = "active" | "draft" | "ended" | "archived";

export interface ChurchGroupMembership {
  contactId: string;
  role: string;
  status: "active" | "paused" | "waitlist";
  joinedOn?: string;
}

export interface CreateChurchGroup {
  name: string;
  description?: string;
  status?: GroupLifecycleStatus;
  startsOn?: string | null;
  endsOn?: string | null;
}

export interface StoredFile {
  id: string;
  title: string;
  category: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  folderId?: string | null;
}

export interface StoredFolder {
  id: string;
  name: string;
  parentId: string | null;
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
  requestedBy: string | null;
  requesterName: string;
  purpose: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "approved" | "declined" | "cancelled";
  isIntakeRequest?: boolean;
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
export type ServerPermission = "server_view" | "server_troubleshoot" | "server_manage" | "server_api";

export type UpdateDepartmentProfile = Omit<DepartmentProfile, "id">;

export type CreateDepartment = Omit<DepartmentProfile, "id">;

export interface AuthenticatedUser {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  role: "server_admin" | "user";
  mustChangePassword: boolean;
  canChangePassword?: boolean;
  dateTimeFormat: DateTimeFormat;
  language: UserLanguage;
  languageIsCustom: boolean;
  menuPreferences?: UserMenuPreferences | null;
  serverPermissions: ServerPermission[];
  isServiceUser?: boolean;
}

export interface UserMenuPreferences {
  order: string[];
  hidden: string[];
  sections: Array<{ id: string; name: string; itemIds: string[] }>;
  hiddenSections: string[];
  duplicates: Array<{ id: string; targetId: string; parentId?: string | null }>;
  startPageId?: string | null;
}

export type DateTimeFormat = "DD.MM.YYYY HH:MM" | "DD/MM/YYYY HH:MM" | "MM/DD/YYYY h:mm AM/PM" | "YYYY-MM-DD HH:MM";
export type UserLanguage = "en" | "de" | "fr" | "it";

export interface SiteUser {
  id: string;
  lastActiveAt: string | null;
  email?: string;
  username?: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  birthday?: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  phoneNumbers: UserPhoneNumber[];
  relationships: UserRelationship[];
  accountRole: "server_admin" | "user";
  serverPermissions: ServerPermission[];
  isServiceUser: boolean;
  apiKeyEnabled?: boolean;
  serviceUserOwnerId?: string;
  serviceUserOwnerName?: string;
  adminNote?: string;
  isEnabled: boolean;
  canChangePassword: boolean;
  memberships: Array<{ departmentId: string; role: "site_admin" | "member"; contactId?: string; permissions?: LocationPermission[]; videoPermissions?: VideoPermission[]; presenterPermissions?: PresenterPermission[]; modulePermissions?: Record<string, string[]> }>;
}

export interface CreateSiteUser {
  email?: string;
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  birthday?: string;
  street?: string;
  streetNumber?: string;
  postalCode?: string;
  city?: string;
  phoneNumbers?: UserPhoneNumber[];
  relationships?: UserRelationshipInput[];
  password?: string;
  accountRole: "server_admin" | "user";
  serverPermissions?: ServerPermission[];
  isServiceUser?: boolean;
  serviceUserOwnerId?: string;
  adminNote?: string;
  isEnabled?: boolean;
  canChangePassword?: boolean;
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
  selfSignupSites?: Array<{ id: string; name: string }>;
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

export * from "./check-in-label-templates.js";
