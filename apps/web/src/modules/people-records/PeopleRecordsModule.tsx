import { GrowthTrajectorySettings, PersonGrowthTrajectory } from "./GrowthTrajectory";
import { PersonTagAppearance, PersonTagLabel } from "./PersonTagAppearance";
import { groupFromPeopleNavigation, isPeopleTagLookup, tagFromPeopleNavigation } from "../../people-group-navigation";
import { GroupMembershipImport } from "./GroupMembershipImport";
import { readCsvRows } from "./csv-import";
import { PeopleMeetingFilter } from "./PeopleMeetingFilter";
import { PersonServiceWorkload } from "./PersonServiceWorkload";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Download, RefreshCw, UserRoundPlus } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { PersonPrivateNotes } from "./PersonPrivateNotes";
import { PersonAttachments } from "./PersonAttachments";
import { PersonHistoryTimeline } from "./PersonHistoryTimeline";
import { MailingRecipientsExport, PersonHousehold } from "./PersonHousehold";
import { postalAddressFields, type PostalAddress } from "./postal-address";
type Person={id:string;firstName:string;lastName:string;email:string|null;phone:string|null;status:string;postalAddress?:PostalAddress;archivedAt?:string|null;fields:Record<string,unknown>};
type FieldVisibility = "private_people" | "people_managers";
type Field={id:string;label:string;fieldKey:string;type:"text"|"date"|"boolean"|"select";options:string[];required:boolean;active:boolean;visibility?:FieldVisibility;tagColor?:string|null};
type RelationshipType={id:string;label:string;reverseLabel:string;active:boolean};
type Candidate={personId:string;firstName:string;lastName:string;email:string|null;matchId:string;matchFirstName:string;matchLastName:string;matchEmail:string|null;reason:string};
type MergePreview={keeper:{id:string;firstName:string;lastName:string;email:string|null;phone:string|null;status:string};source:{id:string;firstName:string;lastName:string;email:string|null;phone:string|null;status:string};profileConflicts:Array<{field:string;keepValue:string;sourceValue:string}>;customFieldConflicts:Array<{field:string;keeperValue:unknown;sourceValue:unknown}>;dateConflicts:Array<{kind:string;keeperValue:string;sourceValue:string}>;blockers:string[]};
type Extra={id:string;purpose?:string;status?:string;notes?:string;relationship?:string;relationshipTypeId?:string|null;isReciprocal?:boolean;relatedPersonId?:string;firstName?:string;lastName?:string;action?:string;subject?:string;createdAt?:string;capturedAt?:string;actorName?:string|null;source?:string;expiresAt?:string|null};
type ImportRow={row:number;person:{firstName:string;lastName:string;email?:string;phone?:string;postalAddress?:PostalAddress;archivedAt?:string|null;fields?:Record<string,unknown>};match:null|{id:string;firstName:string;lastName:string;email:string|null};decision:"new"|"review"|"invalid";validationError?:string};
type ImportPreview={rows:ImportRow[];counts:{new:number;review:number;invalid?:number;imported:number};message:string};
type DirectoryFieldFilter={field:string;value:string;operator?:"equals"|"contains"|"before"|"after"|"on"|"last_7_days"|"last_30_days"|"last_90_days"|"next_7_days"|"next_30_days"|"next_90_days"};
type RelationshipFilter={relationshipTypeId?:string;legacyRelationship?:string;exclude:boolean};
type DirectoryStatistics = { total: number; members: number; visitors: number; withEmail: number; withPhone: number };
type DirectoryGroup = { id: string; name: string; groupType: string | null; isLocal: boolean };
type DirectorySort = "lastName" | "firstName" | "nameDescending" | "status";
type SavedView={sort?:DirectorySort|null;groupRole?:string|null;groupType?:string|null;groupId?:string|null;groupJoinedFrom?:string|null;groupJoinedThrough?:string|null;formerGroupId?:string|null;attendedMeetingId?:string|null;id:string;name:string;q:string|null;status:string|null;field?:string|null;value?:string|null;filters?:DirectoryFieldFilter[]|null;relationshipFilters?:RelationshipFilter[]|null;columns?:string[]|null};
const defaultDirectoryColumns=["firstName","lastName","email","phone","status"];
const relativeDateOperators=["last_7_days","last_30_days","last_90_days","next_7_days","next_30_days","next_90_days"];
const isRelativeDateFilter=(item:DirectoryFieldFilter)=>relativeDateOperators.includes(item.operator??"");

type MembershipValues = { role: string | null; status: string | null; joinedOn: string | null };
type MembershipGroup = { groupId: string; groupName: string };
type PersonMemberships = {
  current: Array<MembershipGroup & MembershipValues & { groupStatus: string }>;
  history: Array<MembershipGroup & MembershipValues & {
    action: "created" | "updated" | "deleted";
    createdAt: string;
    previousRole: string | null;
    previousStatus: string | null;
    previousJoinedOn: string | null;
  }>;
  historyAvailable: boolean;
  historyTruncated?: boolean;
};

function membershipSummary({ role, status, joinedOn }: MembershipValues) {
  return [role, status, joinedOn ? `Joined ${joinedOn.slice(0, 10)}` : null].filter(Boolean).join(" · ") || "No membership details";
}

function PersonGroupMemberships({ contactId, request, onNavigateEntity }: {
  contactId: string;
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
  onNavigateEntity: ModuleContext["onNavigateEntity"];
}) {
  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState<PersonMemberships | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setMemberships(null);
    setLoadError("");
    void request<PersonMemberships>(`/api/people-records/${contactId}/group-memberships`).then(
      (result) => { if (active) setMemberships(result); },
      (error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "Could not load group memberships."); },
    );
    return () => { active = false; };
  }, [contactId, open, request]);

  const groupLink = ({ groupId, groupName }: MembershipGroup) => onNavigateEntity
    ? <button type="button" onClick={() => onNavigateEntity("group", groupId)}>{groupName}</button>
    : <strong>{groupName}</strong>;
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Group memberships</summary>
    {open && <div>
      {loadError && <p role="alert">{loadError}</p>}
      {!loadError && !memberships && <p role="status">Loading group memberships…</p>}
      {memberships && <>
        <h3>Current memberships</h3>
        {memberships.current.length
          ? <ul>{memberships.current.map((member) => <li key={member.groupId}>{groupLink(member)} · {membershipSummary(member)}{member.groupStatus !== "active" ? ` · Group ${member.groupStatus}` : ""}</li>)}</ul>
          : <p>No current memberships in groups you manage.</p>}
        <h3>Membership history</h3>
        {memberships.history.length > 0 && <ul>{memberships.history.map((change) => {
          const previous = membershipSummary({ role: change.previousRole, status: change.previousStatus, joinedOn: change.previousJoinedOn });
          const current = membershipSummary(change);
          const description = change.action === "created" ? `Added · ${current}` : change.action === "deleted" ? `Removed · ${previous}` : `Changed from ${previous} to ${current}`;
          return <li key={JSON.stringify(change)}>{groupLink(change)} · {description} · <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time></li>;
        })}</ul>}
        {!memberships.historyAvailable && <p>Membership history is unavailable for this location.</p>}
        {memberships.historyAvailable && !memberships.history.length && <p>No recorded membership changes in groups you manage.</p>}
        {memberships.historyTruncated && <p>Showing the 300 most recent changes.</p>}
      </>}
    </div>}
  </details>;
}

export function PeopleRecordsModule({departmentId,csrfToken,department,canManageSite,state,onStateChange,onNavigateEntity,realtime}:ModuleContext){
  const canManage=canManageSite||department.role==="site_admin"||(department.permissions??[]).includes("people_manage")||(department.modulePermissions?.["people-records"]??[]).includes("manage");
  const [directoryPeople,setPeople]=useState<Person[]>([]),[fields,setFields]=useState<Field[]>([]),[selected,setSelected]=useState<Person|null>(null),[extras,setExtras]=useState<Extra[]>([]),[detailsSection,setDetailsSection]=useState("history"),[duplicates,setDuplicates]=useState<Candidate[]>([]),[status,setStatus]=useState(""),[customFilters,setCustomFilters]=useState<DirectoryFieldFilter[]>([]),[relationshipFilters,setRelationshipFilters]=useState<RelationshipFilter[]>([]),[columns,setColumns]=useState<string[]>(defaultDirectoryColumns),[tab,setTab]=useState("directory"),[label,setLabel]=useState(""),[key,setKey]=useState(""),[fieldType,setFieldType]=useState<Field["type"]>("text"),[options,setOptions]=useState(""),[consentPurpose,setConsentPurpose]=useState(""),[consentStatus,setConsentStatus]=useState("granted"),[relatedId,setRelatedId]=useState(""),[relationshipTypeId,setRelationshipTypeId]=useState(""),[relationshipTypes,setRelationshipTypes]=useState<RelationshipType[]>([]),[legacyRelationshipLabels,setLegacyRelationshipLabels]=useState<string[]>([]),[newRelationshipLabel,setNewRelationshipLabel]=useState(""),[newRelationshipReverseLabel,setNewRelationshipReverseLabel]=useState(""),[preview,setPreview]=useState<ImportPreview|null>(null),[selectedRows,setSelectedRows]=useState<number[]>([]),[importResult,setImportResult]=useState<unknown>(null),[dates,setDates]=useState<{birthDate:string|null;weddingAnniversary:string|null}>({birthDate:null,weddingAnniversary:null}),[error,setError]=useState(""),[message,setMessage]=useState(""),[mergePreview,setMergePreview]=useState<MergePreview|null>(null),[mergeConflictsConfirmed,setMergeConflictsConfirmed]=useState(false);
  const [search, setSearch] = useState(() => ({ text: tagFromPeopleNavigation(state) ?? "", departmentId }));
  const filter = search.departmentId === departmentId || !isPeopleTagLookup(search.text) ? search.text : "";
  const setFilter = useCallback((text: string) => setSearch({ text, departmentId }), [departmentId]);
  const [fieldVisibility, setFieldVisibility] = useState<FieldVisibility>("private_people");
  const canViewServiceWorkload = department.role === "site_admin" || (department.permissions ?? []).includes("events_manage");
  const canManagePeopleRecords = canManageSite || department.role === "site_admin" || department.permissions?.includes("people_manage") === true;
  const [pageSelection,setSelectedPeople]=useState<string[]>([]),[bulkStatus,setBulkStatus]=useState<"member"|"visitor">("member"),[bulkFieldId,setBulkFieldId]=useState(""),[bulkFieldValue,setBulkFieldValue]=useState("");
  const [savedViews,setSavedViews]=useState<SavedView[]>([]),[viewName,setViewName]=useState(""),[activeSavedView,setActiveSavedView]=useState("");
  const [csvHeaders,setCsvHeaders]=useState<string[]>([]),[csvRows,setCsvRows]=useState<string[][]>([]),[csvMapping,setCsvMapping]=useState<Record<string,string>>({});
  const [showArchived,setShowArchived]=useState(false);
  const [bulkArchivePending, setBulkArchivePending] = useState(false);
  const canAssignGroups = canManageSite || department.role === "site_admin" ||
    ((department.permissions ?? []).includes("people_manage") && (department.permissions ?? []).includes("groups_manage"));
  const [assignmentGroupId, setAssignmentGroupId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("Member");
  const [assignmentStatus, setAssignmentStatus] = useState<"active" | "paused" | "waitlist">("active");
  const [assignmentPending, setAssignmentPending] = useState(false);
  const columnOptions=[{key:"id",label:"Record ID"},{key:"firstName",label:"First name"},{key:"lastName",label:"Last name"},{key:"email",label:"Email"},{key:"phone",label:"Phone"},{key:"status",label:"Status"},...postalAddressFields.map(({key,label})=>({key:"address:"+key,label})),...fields.filter(field=>field.active).map(field=>({key:`custom:${field.fieldKey}`,label:field.label}))];
  const [tagLabel, setTagLabel] = useState("");
  const [tagForBulkEdit, setTagForBulkEdit] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const tags = fields.filter(field => field.active && field.type === "boolean" && !field.required && /^tag_[a-z0-9_]+$/.test(field.fieldKey));
  const selectedTag = tags.find(tag => tag.id === tagForBulkEdit);
  const selectedBulkField=fields.find(item=>item.id===bulkFieldId&&item.active);
  function directoryColumnValue(person:Person,column:string){if(column.startsWith("custom:"))return person.fields[column.slice(7)]??"";if(column.startsWith("address:"))return person.postalAddress?.[column.slice(8) as keyof PostalAddress]??"";return (person as unknown as Record<string,unknown>)[column]??""}
  const request=useCallback(async<T,>(url:string,init:RequestInit={}):Promise<T>=>{const r=await fetch(url,{...init,headers:{"x-department-id":departmentId,...(init.body?{"content-type":"application/json"}:{}),...((init.body||init.method?.toUpperCase()==="DELETE")?{"x-csrf-token":csrfToken}:{}),...init.headers},cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error??"Request failed.");return data as T},[departmentId,csrfToken]);
  useEffect(()=>{void request<SavedView[]>("/api/people-records/saved-views").then(setSavedViews).catch(e=>setError(e instanceof Error?e.message:"Could not load saved views."))},[request]);
  const [directoryGroups, setDirectoryGroups] = useState<DirectoryGroup[]>([]);
  const [groupId, setGroupId] = useState(() => groupFromPeopleNavigation(state) ?? "");
  const [groupType, setGroupType] = useState("");
  const [groupRole, setGroupRole] = useState("");
  const [groupJoinedFrom, setGroupJoinedFrom] = useState("");
  const [groupJoinedThrough, setGroupJoinedThrough] = useState("");
  const [formerGroupId, setFormerGroupId] = useState("");
  const [attendedMeetingId, setAttendedMeetingId] = useState("");
  const [historyGroups, setHistoryGroups] = useState<{ id: string; name: string; status: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryGroups([]);
    void request<{ groups: typeof historyGroups }>("/api/people-records/directory-history-groups", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setHistoryGroups(result.groups); })
      .catch(() => { if (!controller.signal.aborted) setHistoryGroups([]); });
    return () => controller.abort();
  }, [request]);
  const [sort, setSort] = useState<DirectorySort>("lastName");
  const groupTypes = [...new Set(directoryGroups.flatMap(group => group.groupType ? [group.groupType] : []))].sort((a,b) => a.localeCompare(b));
  const previousGroupFilterDepartment = useRef(departmentId);
  useEffect(() => {
    if (previousGroupFilterDepartment.current !== departmentId) {
      previousGroupFilterDepartment.current = departmentId;
      setSearch(current => current.departmentId !== departmentId && isPeopleTagLookup(current.text) ? { text: "", departmentId } : current);
      setGroupId("");
      setFormerGroupId("");
      setAttendedMeetingId("");
    }
  }, [departmentId]);
  useEffect(() => {
    const group = groupFromPeopleNavigation(state);
    const tag = tagFromPeopleNavigation(state);
    if (!group && !tag) return;
    setTab("directory");
    setSelected(null);
    setSelectedPeople([]);
    setFilter(tag ?? "");
    setStatus("");
    setCustomFilters([]);
    setRelationshipFilters([]);
    setGroupType("");
    setGroupRole("");
    setGroupJoinedFrom("");
    setGroupJoinedThrough("");
    setFormerGroupId("");
    setAttendedMeetingId("");
    setShowArchived(false);
    setActiveSavedView("");
    setGroupId(group ?? "");
    onStateChange("");
  }, [state, onStateChange, setFilter]);
  useEffect(() => {
    let active = true;
    setDirectoryGroups([]);
    void request<DirectoryGroup[]>("/api/people-records/directory-groups").then(groups => { if (active) setDirectoryGroups(groups); }).catch(() => { if (active) setError("Could not load directory groups."); });
    return () => { active = false; };
  }, [request]);
  const [statistics, setStatistics] = useState<DirectoryStatistics | null>(null);
  const latestDirectoryLoad = useRef(0);
  const pageSize = 100;
  const criteriaKey = JSON.stringify([departmentId, filter, status, customFilters, relationshipFilters, groupId, groupType, groupRole, groupJoinedFrom, groupJoinedThrough, formerGroupId, attendedMeetingId, sort, showArchived]);
  const [paging, setPaging] = useState({ criteriaKey: "", page: 1 });
  const page = paging.criteriaKey === criteriaKey ? paging.page : 1;
  const pageKey = JSON.stringify([criteriaKey, page]);
  const [loadedPageKey, setLoadedPageKey] = useState("");
  const people = loadedPageKey === pageKey ? directoryPeople : [];
  const pageCount = Math.max(1, Math.ceil((statistics?.total ?? 0) / pageSize));
  const pageReady = loadedPageKey === pageKey && statistics !== null;
  const selectedPeople = pageReady ? pageSelection : [];
  const visibleArchiveSelection = people.filter(person => Boolean(person.archivedAt) === showArchived && selectedPeople.includes(person.id));
  useEffect(() => {
    setPaging(current => current.criteriaKey === criteriaKey ? current : { criteriaKey, page: 1 });
  }, [criteriaKey]);
  useEffect(() => { setSelectedPeople([]); }, [pageKey]);
  const load = useCallback(async () => {
    const loadId = ++latestDirectoryLoad.current;
    setStatistics(null);
    const qs = new URLSearchParams({ includeStatistics: "true", sort, page: String(page), pageSize: String(pageSize) });
    if (showArchived) qs.set("archived", "true");
    if (filter) qs.set("q", filter);
    if (status) qs.set("status", status);
    if (groupId) qs.set("groupId", groupId);
    if (groupType) qs.set("groupType", groupType);
    if (groupRole.trim()) qs.set("groupRole", groupRole.trim());
    if (groupJoinedFrom) qs.set("groupJoinedFrom", groupJoinedFrom);
    if (groupJoinedThrough) qs.set("groupJoinedThrough", groupJoinedThrough);
    if (formerGroupId) qs.set("formerGroupId", formerGroupId);
    if (attendedMeetingId) qs.set("attendedMeetingId", attendedMeetingId);
    const completeFilters = customFilters.filter(item => item.field && (item.value || isRelativeDateFilter(item)));
    if (completeFilters.length) qs.set("filters", JSON.stringify(completeFilters));
    const completeRelationshipFilters = relationshipFilters.filter(item => item.relationshipTypeId || item.legacyRelationship);
    if (completeRelationshipFilters.length) qs.set("relationshipFilters", JSON.stringify(completeRelationshipFilters));
    try {
      const [directory, fieldList, types, legacyLabels] = await Promise.all([
        request<{ people: Person[]; statistics: DirectoryStatistics }>(`/api/people-records/directory?${qs}`),
        request<Field[]>("/api/people-records/fields"),
        request<RelationshipType[]>("/api/people-records/relationship-types"),
        request<string[]>("/api/people-records/relationship-labels"),
      ]);
      if (loadId !== latestDirectoryLoad.current) return;
      const lastPage = Math.max(1, Math.ceil(directory.statistics.total / pageSize));
      if (page > lastPage) {
        setPaging({ criteriaKey, page: lastPage });
        return;
      }
      setPeople(directory.people);
      setLoadedPageKey(pageKey);
      setSelectedPeople(current => current.filter(id => directory.people.some(person => person.id === id)));
      setStatistics(directory.statistics);
      setFields(fieldList);
      setRelationshipTypes(types);
      setLegacyRelationshipLabels(legacyLabels);
    } catch (reason) {
      if (loadId === latestDirectoryLoad.current) setError(reason instanceof Error ? reason.message : "Could not load People Records.");
    }
  }, [request, filter, status, customFilters, relationshipFilters, groupId, groupType, groupRole, groupJoinedFrom, groupJoinedThrough, formerGroupId, attendedMeetingId, sort, showArchived, criteriaKey, page, pageKey]);
  useEffect(()=>{void load()},[load]);
  const [relationshipSearch, setRelationshipSearch] = useState("");
  const [relationshipPeople, setRelationshipPeople] = useState<Person[]>([]);
  useEffect(() => {
    setRelationshipSearch("");
    setRelatedId("");
  }, [selected?.id, departmentId]);
  useEffect(() => {
    setRelationshipPeople([]);
    if (!selected?.id || detailsSection !== "relationships" || !canManage) return;
    let current = true;
    const qs = new URLSearchParams({ q: relationshipSearch, pageSize: "100" });
    void request<Person[]>(`/api/people-records/directory?${qs}`)
      .then(rows => { if (current) setRelationshipPeople(rows); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not search people."); });
    return () => { current = false; };
  }, [departmentId, selected?.id, detailsSection, canManage, relationshipSearch, request]);
  const loadPerson=useCallback(async(p:Person,section="history")=>{setSelected(p);setDetailsSection(section);try{const [items,personDates]=await Promise.all([(section==="history"||section==="workload")?Promise.resolve<Extra[]>([]):request<Extra[]>(`/api/people-records/${p.id}/${section}`),request<{birthDate:string|null;weddingAnniversary:string|null}>(`/api/people-records/${p.id}/dates`)]);setExtras(items);setDates(personDates)}catch(e){setError(e instanceof Error?e.message:"Could not load person details.")}},[request]);
  useEffect(()=>{
    const match=state.match(/^person:([a-z0-9-]{1,80})(?::\d+)?$/i);
    if(!match)return;
    void request<Person>(`/api/people-records/${match[1]}`).then(person=>loadPerson(person)).catch(error=>setError(error instanceof Error?error.message:"Could not open the linked person."));
  },[state,request,loadPerson]);
  async function act(run:()=>Promise<unknown>,done:string){setError("");setMessage("");try{await run();setMessage(done);await load()}catch(e){setError(e instanceof Error?e.message:"Action failed.")}}
  async function createTag(event: FormEvent) {
    event.preventDefault();
    const trimmedLabel = tagLabel.trim();
    const slug = trimmedLabel.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36);
    if (!canManage || !trimmedLabel || tagBusy) return;
    if (!slug) {
      setError("Include letters A–Z or digits in the tag name.");
      return;
    }
    setTagBusy(true);
    setError("");
    try {
      await request("/api/people-records/fields", {
        method: "POST",
        body: JSON.stringify({ label: trimmedLabel, fieldKey: "tag_" + slug, type: "boolean" }),
      });
      setTagLabel("");
      setMessage("Tag created.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the tag.");
    } finally {
      setTagBusy(false);
    }
  }

  async function applyTag(add: boolean) {
    if (!canManage || !selectedTag || !selectedPeople.length || showArchived || tagBusy) return;
    const action = add ? "Add" : "Remove";
    if (!window.confirm(`${action} “${selectedTag.label}” ${add ? "for" : "from"} ${selectedPeople.length} selected people?`)) return;
    setTagBusy(true);
    setError("");
    try {
      const result = await request<{ updated: number; unchanged: number }>("/api/people-records/bulk-field", {
        method: "POST",
        body: JSON.stringify({ contactIds: selectedPeople, fieldId: selectedTag.id, value: add ? true : null }),
      });
      setMessage(`${result.updated} people updated; ${result.unchanged} unchanged.`);
      setSelectedPeople([]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the tag.");
    } finally {
      setTagBusy(false);
    }
  }
  async function createField(e:FormEvent){e.preventDefault();await act(()=>request("/api/people-records/fields",{method:"POST",body:JSON.stringify({label,fieldKey:key,type:fieldType,options:options.split(",").map(x=>x.trim()).filter(Boolean),visibility:fieldVisibility})}),"Custom field created.");setLabel("");setKey("");setFieldVisibility("private_people")}

  async function updateFieldVisibility(event: FormEvent<HTMLFormElement>, field: Field) {
    event.preventDefault();
    const visibility = new FormData(event.currentTarget).get("visibility");
    if ((visibility !== "private_people" && visibility !== "people_managers") || visibility === (field.visibility ?? "private_people")) return;
    if (visibility === "private_people" && !window.confirm(`Allow all users with private People access at this location to view “${field.label}” and its history?`)) return;
    await act(() => request(`/api/people-records/fields/${field.id}`, { method: "PATCH", body: JSON.stringify({ visibility }) }), "Field visibility updated.");
  }
  async function addConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const element = event.currentTarget;
    const values = new FormData(element);
    await act(async () => {
      await request(`/api/people-records/${selected.id}/consents`, {
        method: "POST",
        body: JSON.stringify({
          purpose: consentPurpose,
          status: consentStatus,
          source: String(values.get("source") ?? ""),
          expiresAt: String(values.get("expiresAt") ?? "") || null,
          notes: String(values.get("notes") ?? ""),
        }),
      });
      element.reset();
      setConsentPurpose("");
      setConsentStatus("granted");
      await loadPerson(selected, "consents");
    }, "Consent entry recorded.");
  }
  async function addRelationship(e:FormEvent){e.preventDefault();if(!selected||!relationshipTypeId)return;await act(()=>request(`/api/people-records/${selected.id}/relationships`,{method:"POST",body:JSON.stringify({relatedPersonId:relatedId,relationshipTypeId})}),"Relationship added.");setRelatedId("");setRelationshipTypeId("");await loadPerson(selected,"relationships")}
  async function removeRelationship(item:Extra){if(!selected||!item.id)return;if(!window.confirm(`Remove relationship with ${item.firstName??"this person"}?`))return;await act(()=>request(`/api/people-records/${selected.id}/relationships/${item.id}`,{method:"DELETE"}),"Relationship removed.");await loadPerson(selected,"relationships")}
  async function createRelationshipType(e:FormEvent){e.preventDefault();try{const created=await request<RelationshipType>("/api/people-records/relationship-types",{method:"POST",body:JSON.stringify({label:newRelationshipLabel,reverseLabel:newRelationshipReverseLabel})});setRelationshipTypes(items=>[...items,created].sort((a,b)=>a.label.localeCompare(b.label)));setNewRelationshipLabel("");setNewRelationshipReverseLabel("");setMessage("Relationship type created.");setError("")}catch(e){setError(e instanceof Error?e.message:"Could not create relationship type.")}}
  async function updateRelationshipType(item:RelationshipType,values:{label:string;reverseLabel:string;active:boolean}){try{const updated=await request<RelationshipType>(`/api/people-records/relationship-types/${item.id}`,{method:"PATCH",body:JSON.stringify(values)});setRelationshipTypes(items=>items.map(type=>type.id===updated.id?updated:type).sort((a,b)=>a.label.localeCompare(b.label)));setMessage("Relationship type updated.");setError("")}catch(e){setError(e instanceof Error?e.message:"Could not update relationship type.")}}
  async function saveField(field:Field,value:unknown){if(!selected)return;try{await request(`/api/people-records/${selected.id}/fields/${field.id}`,{method:"PUT",body:JSON.stringify({value})});setSelected({...selected,fields:{...selected.fields,[field.fieldKey]:value}});setMessage(`${field.label} saved.`);setError("")}catch(e){setError(e instanceof Error?e.message:"Could not save field value.")}}
  async function exportCsv(){try{const qs=new URLSearchParams({q:filter,...(status?{status}:{})});if(showArchived)qs.set("archived","true");if(groupId)qs.set("groupId",groupId);if(groupType)qs.set("groupType",groupType);if(groupRole.trim())qs.set("groupRole",groupRole.trim());if(groupJoinedFrom)qs.set("groupJoinedFrom",groupJoinedFrom);if(groupJoinedThrough)qs.set("groupJoinedThrough",groupJoinedThrough);if(formerGroupId)qs.set("formerGroupId",formerGroupId);if(attendedMeetingId)qs.set("attendedMeetingId",attendedMeetingId);qs.set("sort",sort);const completeFilters=customFilters.filter(item=>item.field&&(item.value||isRelativeDateFilter(item)));if(completeFilters.length)qs.set("filters",JSON.stringify(completeFilters));const completeRelationshipFilters=relationshipFilters.filter(item=>item.relationshipTypeId||item.legacyRelationship);if(completeRelationshipFilters.length)qs.set("relationshipFilters",JSON.stringify(completeRelationshipFilters));if(columns.length)qs.set("columns",JSON.stringify(columns));const r=await fetch(`/api/people-records/export.csv?${qs}`,{headers:{"x-department-id":departmentId},cache:"no-store"});if(!r.ok)throw new Error("Could not export the directory.");const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="people-directory.csv";a.click();URL.revokeObjectURL(url)}catch(e){setError(e instanceof Error?e.message:"Could not export directory.")}}
  async function exportVCard(person:Person){try{const r=await fetch(`/api/people-records/${person.id}/vcard`,{headers:{"x-department-id":departmentId},cache:"no-store"});if(!r.ok)throw new Error("Could not export this contact.");const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${person.firstName}-${person.lastName}.vcf`;a.click();URL.revokeObjectURL(url)}catch(e){setError(e instanceof Error?e.message:"Could not export contact.")}}
  async function bulkUpdateStatus(){if(!canManage||!selectedPeople.length)return;if(!window.confirm(`Change the status of ${selectedPeople.length} selected people to ${bulkStatus}?`))return;try{const result=await request<{updated:number;unchanged:number}>("/api/people-records/bulk-status",{method:"POST",body:JSON.stringify({contactIds:selectedPeople,status:bulkStatus})});setMessage(`${result.updated} people updated; ${result.unchanged} unchanged.`);setSelectedPeople([]);await load()}catch(e){setError(e instanceof Error?e.message:"Could not update selected people.")}}
  async function bulkUpdateField(){if(!canManage||!selectedPeople.length)return;const field=fields.find(item=>item.id===bulkFieldId&&item.active);if(!field){setError("Choose an active custom field.");return}let value:unknown=bulkFieldValue;if(field.type==="boolean")value=bulkFieldValue===""?null:bulkFieldValue==="true";else if(field.type==="select")value=bulkFieldValue||null;else value=bulkFieldValue.trim()===""?null:bulkFieldValue;if(field.required&&value===null){setError("This field is required and cannot be cleared.");return}const description=value===null?"clear":"set";if(!window.confirm(`${description} ${field.label} for ${selectedPeople.length} selected people?`))return;try{const result=await request<{updated:number;unchanged:number}>("/api/people-records/bulk-field",{method:"POST",body:JSON.stringify({contactIds:selectedPeople,fieldId:field.id,value})});setMessage(`${result.updated} people updated; ${result.unchanged} unchanged.`);setSelectedPeople([]);setBulkFieldValue("");await load()}catch(e){setError(e instanceof Error?e.message:"Could not update this field for selected people.")}}
  async function reviewMerge(keeperId:string,sourceId:string){try{setError("");setMergeConflictsConfirmed(false);setMergePreview(await request<MergePreview>("/api/people-records/merge-preview",{method:"POST",body:JSON.stringify({keeperId,sourceId})}))}catch(e){setError(e instanceof Error?e.message:"Could not inspect this merge.")}}
  async function applyMerge(){if(!mergePreview||!canManage)return;const {keeper,source}=mergePreview;if(!window.confirm(`Merge ${source.firstName} ${source.lastName} into ${keeper.firstName} ${keeper.lastName}? The source record will be removed and linked records moved to the keeper.`))return;try{await request("/api/people-records/merge",{method:"POST",body:JSON.stringify({keeperId:keeper.id,sourceId:source.id,confirmProfileConflicts:mergeConflictsConfirmed})});setMessage(`${source.firstName} ${source.lastName} merged into ${keeper.firstName} ${keeper.lastName}.`);setMergePreview(null);setSelectedPeople(current=>current.filter(id=>id!==keeper.id&&id!==source.id));if(selected?.id===source.id)setSelected(null);await load();const r=await request<{candidates:Candidate[]}>("/api/people-records/duplicates");setDuplicates(r.candidates)}catch(e){setError(e instanceof Error?e.message:"Could not merge these records.")}}
  async function csvPreview(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;const parsed=readCsvRows(await file.text());const headers=(parsed.shift()??[]).map((h,i)=>h.trim()||`Column ${i+1}`);if(parsed.length>501){setCsvHeaders([]);setCsvRows([]);setCsvMapping({});setPreview(null);setSelectedRows([]);setError("CSV files can contain at most 500 data rows. Split the file and import each part.");return}const rows=parsed.slice(0,500);const normalized=headers.map(h=>h.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""));const mapping:Record<string,string>={};for(const [dest,aliases] of [["firstName",["first_name","firstname","first"]],["lastName",["last_name","lastname","last"]],["email",["email","email_address"]],["phone",["phone","telephone","mobile"]]] as Array<[string,string[]]>){const idx=normalized.findIndex(h=>aliases.includes(h));if(idx>=0)mapping[dest]=String(idx)}for(const {key,label} of postalAddressFields){const names=["address_"+key.toLowerCase(),key.replace(/[A-Z]/g,c=>"_"+c.toLowerCase()),label.toLowerCase().replace(/[^a-z0-9]+/g,"_")];const idx=normalized.findIndex(header=>names.includes(header));if(idx>=0)mapping["address:"+key]=String(idx)}for(const f of fields.filter(item=>item.active)){const idx=normalized.findIndex(h=>h===f.fieldKey.toLowerCase()||h===f.label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""));if(idx>=0)mapping[`custom:${f.fieldKey}`]=String(idx)}setCsvHeaders(headers);setCsvRows(rows);setCsvMapping(mapping);setPreview(null);setSelectedRows([]);setImportResult(null);setError("")}
  async function runCsvImportPreview(){const rows=csvRows.map(cells=>{const value=(key:string)=>{const index=csvMapping[key];return index===undefined?"":(cells[Number(index)]??"").trim()};const importedFields:Record<string,string>={};for(const f of fields.filter(item=>item.active)){const index=csvMapping[`custom:${f.fieldKey}`];if(index!==undefined)importedFields[f.fieldKey]=(cells[Number(index)]??"").trim()}return{firstName:value("firstName"),lastName:value("lastName"),email:value("email")||undefined,phone:value("phone")||undefined,postalAddress:Object.fromEntries(postalAddressFields.flatMap(({key})=>{const field=value("address:"+key);return field?[[key,field]]:[]})),...(Object.keys(importedFields).length?{fields:importedFields}:{})}});await act(async()=>{const result=await request<ImportPreview>("/api/people-records/import-preview",{method:"POST",body:JSON.stringify({rows})});setPreview(result);setSelectedRows(result.rows.filter(x=>x.decision==="new").map(x=>x.row));setImportResult(null)},"Import preview ready; no records changed.")}
  async function applyImport(){if(!preview)return;const chosen=preview.rows.filter(r=>selectedRows.includes(r.row));if(!chosen.length){setError("Select at least one row marked new.");return}if(!window.confirm(`Create ${chosen.length} selected people? Duplicate matches will be rechecked and skipped. This cannot be undone here.`))return;await act(async()=>{setImportResult(await request("/api/people-records/import-apply",{method:"POST",body:JSON.stringify({rows:chosen.map(r=>({row:r.row,...r.person,status:"visitor"}))})}));setPreview(null);setSelectedRows([])},"Selected CSV rows processed.")}
  async function savePersonDates(e:FormEvent){e.preventDefault();if(!selected)return;await act(()=>request(`/api/people-records/${selected.id}/dates`,{method:"PUT",body:JSON.stringify(dates)}),"Person dates saved.");}
  async function saveDirectoryView(action:"new"|"update"|"rename"){
    const name=viewName.trim();
    if(!name){setError("Enter a name for this view.");return}
    if(action!=="new"&&!activeSavedView)return;
    const criteria={q:filter,status,groupId:groupId||null,groupType:groupType||null,groupRole:groupRole.trim()||null,groupJoinedFrom:groupJoinedFrom||null,groupJoinedThrough:groupJoinedThrough||null,formerGroupId:formerGroupId||null,attendedMeetingId:attendedMeetingId||null,sort,filters:customFilters.filter(item=>item.field&&(item.value||isRelativeDateFilter(item))),relationshipFilters:relationshipFilters.filter(item=>item.relationshipTypeId||item.legacyRelationship),columns};
    const base="/api/people-records/saved-views";
    try{
      const saved=await request<SavedView>(action==="new"?base:base+"/"+activeSavedView,{
        method:action==="new"?"POST":"PATCH",
        body:JSON.stringify(action==="rename"?{name}:{name,...criteria}),
      });
      setSavedViews(items=>[...items.filter(item=>item.id!==saved.id),saved].sort((a,b)=>a.name.localeCompare(b.name)));
      setActiveSavedView(saved.id);
      setViewName(saved.name);
      setMessage(action==="rename"?"Directory view renamed.":"Directory view saved.");
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"Could not save directory view.")}
  }
  async function removeDirectoryView(){const view=savedViews.find(item=>item.id===activeSavedView);if(!view)return;if(!window.confirm(`Delete saved view “${view.name}”?`))return;try{await request(`/api/people-records/saved-views/${view.id}`,{method:"DELETE"});setSavedViews(items=>items.filter(item=>item.id!==view.id));setActiveSavedView("");setViewName("");setMessage("Saved view deleted.")}catch(e){setError(e instanceof Error?e.message:"Could not delete saved view.")}}
  async function assignSelectedPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAssignGroups || showArchived || assignmentPending || !selectedPeople.length) return;
    const group = directoryGroups.find(item => item.id === assignmentGroupId && item.isLocal);
    const role = assignmentRole.trim();
    if (!group || !role) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const operation = submitter?.getAttribute("value") === "update" ? "update" : "add";
    const confirmation = operation === "update"
      ? `Set the role and status for existing memberships among ${selectedPeople.length} selected people in ${group.name}?`
      : `Add ${selectedPeople.length} selected people to ${group.name}? Existing memberships will be kept.`;
    if (!window.confirm(confirmation)) return;
    setAssignmentPending(true);
    setError("");
    setMessage("");
    try {
      const result = await request<{ added?: number; updated?: number; unchanged: number }>("/api/people-records/bulk-group-membership", {
        method: "POST",
        body: JSON.stringify({ groupId: group.id, contactIds: selectedPeople, role, status: assignmentStatus, operation }),
      });
      setMessage(operation === "update"
        ? `${result.updated} memberships updated; ${result.unchanged} unchanged or not in the group.`
        : `${result.added} added; ${result.unchanged} already in the group.`);
      setSelectedPeople([]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change memberships for selected people.");
    } finally {
      setAssignmentPending(false);
    }
  }

  async function bulkUpdateArchive() {
    if (!canManage || bulkArchivePending || !visibleArchiveSelection.length) return;
    const contactIds = visibleArchiveSelection.map(person => person.id);
    const archived = !showArchived;
    const verb = archived ? "Archive" : "Restore";
    if (!window.confirm(`${verb} ${contactIds.length} selected people? Their history, memberships, and assignments are kept.`)) return;
    setBulkArchivePending(true);
    setError("");
    setMessage("");
    try {
      const result = await request<{ updated: number }>("/api/people-records/bulk-archive", { method: "POST", body: JSON.stringify({ contactIds, archived }) });
      setSelected(current => current && contactIds.includes(current.id) ? null : current);
      setSelectedPeople(current => current.filter(id => !contactIds.includes(id)));
      setMessage(result.updated === 0 ? "No archive statuses changed." : `${result.updated} people ${archived ? "archived" : "restored"}.`);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the selected people's archive status.");
    } finally {
      setBulkArchivePending(false);
    }
  }
  async function setPersonArchived(person:Person, archived:boolean){
    if(!canManage)return;
    if(archived&&!window.confirm("Archive this person? Their history, memberships, and assignments are kept."))return;
    try{
      await request(`/api/people-records/${person.id}/archive`,{method:"PUT",body:JSON.stringify({archived})});
      setSelected(current=>current?.id===person.id?null:current);
      setSelectedPeople(current=>current.filter(id=>id!==person.id));
      setError("");
      setMessage(archived?"Person archived.":"Person restored.");
      await load();
    }catch(error){
      setError(error instanceof Error?error.message:"Could not change the person's archive status.");
    }
  }
  async function saveProfile(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selected)return;const form=new FormData(e.currentTarget);try{const updated=await request<Omit<Person,"fields">>(`/api/people-records/${selected.id}/profile`,{method:"PUT",body:JSON.stringify({firstName:String(form.get("firstName")??""),lastName:String(form.get("lastName")??""),email:String(form.get("email")??"")||null,phone:String(form.get("phone")??"")||null,status:String(form.get("status")??"visitor"),postalAddress:Object.fromEntries(postalAddressFields.map(({key})=>[key,String(form.get(key)??"")]))})});setSelected({...selected,...updated});setMessage("Person profile saved.");setError("");await load()}catch(reason){setError(reason instanceof Error?reason.message:"Could not save person profile.")}}
  return <main className="module-page"><header className="module-header"><div><p className="eyebrow">PEOPLE ADMINISTRATION</p><h1>People Records</h1><p>Location-scoped directory extensions, consent records, relationships, and review tools.</p></div><button onClick={()=>void load()}><RefreshCw size={16}/> Refresh</button></header>
    <nav className="module-tabs">{[["directory","Directory"],["fields","Custom fields"],["duplicates","Duplicate review"],...(canManage?[["import","Import preview"]]:[])].map(([id,name])=><button key={id} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    {error&&<p role="alert" className="module-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {tab==="directory"&&<><div className="module-toolbar"><label><input type="checkbox" checked={showArchived} onChange={e=>{setShowArchived(e.target.checked);setSelected(null);setSelectedPeople([])}}/> Show archived people</label><input aria-label="Search directory" placeholder="Search names, exact nickname, email, phone" value={filter} onChange={e=>{setFilter(e.target.value)}}/><select aria-label="Filter status" value={status} onChange={e=>{setStatus(e.target.value)}}><option value="">All statuses</option><option value="member">Member</option><option value="visitor">Visitor</option></select>{customFilters.map((item,index)=>{const currentField=fields.find(f=>f.fieldKey===item.field&&f.active);return <div className="people-custom-filter" key={index}><select aria-label={`Custom field filter ${index+1}`} value={item.field} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,field:e.target.value,value:"",operator:undefined}:entry))}}><option value="">Choose custom field</option>{fields.filter(f=>f.active&&(!customFilters.some((entry,entryIndex)=>entryIndex!==index&&entry.field===f.fieldKey)||f.fieldKey===item.field)).map(f=><option key={f.id} value={f.fieldKey}>{f.label}</option>)}</select>{currentField?.type==="select"&&<select aria-label={`Custom field value ${index+1}`} value={item.value} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,value:e.target.value}:entry))}}><option value="">Any value</option>{currentField.options.map(option=><option key={option} value={option}>{option}</option>)}</select>}{currentField?.type==="boolean"&&<select aria-label={`Custom field value ${index+1}`} value={item.value} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,value:e.target.value}:entry))}}><option value="">Any value</option><option value="true">Yes</option><option value="false">No</option></select>}{currentField?.type==="date"&&<select aria-label={`Date filter operator ${index+1}`} value={item.operator??"on"} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,operator:e.target.value as DirectoryFieldFilter["operator"],value:relativeDateOperators.includes(e.target.value)?"":entry.value}:entry))}}><option value="on">On</option><option value="before">Before</option><option value="after">After</option><option value="last_7_days">Within last 7 days</option><option value="last_30_days">Within last 30 days</option><option value="last_90_days">Within last 90 days</option><option value="next_7_days">Within next 7 days</option><option value="next_30_days">Within next 30 days</option><option value="next_90_days">Within next 90 days</option></select>}{currentField?.type==="date"&&!isRelativeDateFilter(item)&&<input aria-label={`Custom field value ${index+1}`} type="date" value={item.value} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,value:e.target.value}:entry))}}/>}{currentField?.type==="text"&&<select aria-label={`Text filter operator ${index+1}`} value={item.operator??"equals"} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,operator:e.target.value as DirectoryFieldFilter["operator"]}:entry))}}><option value="equals">Exact</option><option value="contains">Contains</option></select>}{currentField?.type==="text"&&<input aria-label={`Custom field value ${index+1}`} type="search" maxLength={200} placeholder={item.operator==="contains"?"Contains text":"Exact value"} value={item.value} onChange={e=>{setCustomFilters(current=>current.map((entry,i)=>i===index?{...entry,value:e.target.value}:entry))}}/>}<button type="button" aria-label={`Remove custom field filter ${index+1}`} onClick={()=>{setCustomFilters(current=>current.filter((_,i)=>i!==index))}}>Remove</button></div>})}
{tags.length > 0 && <details className="people-directory-statistics">
  <summary>Tags</summary>
  <fieldset>
    <legend>Require tags</legend>
    {tags.map(tag => {
      const checked = customFilters.some(item => item.field === tag.fieldKey && item.value === "true");
      const atLimit = customFilters.length >= 10 && !customFilters.some(item => item.field === tag.fieldKey);
      return <label key={tag.id}><input type="checkbox" checked={checked} disabled={!checked && atLimit}
        onChange={event => {
          const include = event.target.checked;
          setCustomFilters(current => [
            ...current.filter(item => item.field !== tag.fieldKey),
            ...(include ? [{ field: tag.fieldKey, value: "true" }] : []),
          ]);
        }} /><PersonTagLabel label={tag.label} color={tag.tagColor} /></label>;
    })}
  </fieldset>
  {canManage && !showArchived && <div className="module-toolbar">
    <label>Tag for selected people<select value={tagForBulkEdit} onChange={event => setTagForBulkEdit(event.target.value)}>
      <option value="">Choose a tag</option>
      {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
    </select></label>
    <button type="button" disabled={!selectedTag || !selectedPeople.length || tagBusy} onClick={() => void applyTag(true)}>Add tag</button>
    <button type="button" disabled={!selectedTag || !selectedPeople.length || tagBusy} onClick={() => void applyTag(false)}>Remove tag</button>
  </div>}
</details>}
{customFilters.length<10&&<button type="button" onClick={()=>setCustomFilters(current=>[...current,{field:"",value:""}])}>Add custom field filter</button>}{relationshipFilters.map((item,index)=>{const selected=item.relationshipTypeId?`type:${item.relationshipTypeId}`:item.legacyRelationship?`legacy:${item.legacyRelationship}`:"";return <div className="people-custom-filter" key={`relationship-${index}`}><select aria-label={`Relationship filter ${index+1}`} value={selected} onChange={e=>{const value=e.target.value;const next:Partial<RelationshipFilter>=value.startsWith("type:")?{relationshipTypeId:value.slice(5)}:value.startsWith("legacy:")?{legacyRelationship:value.slice(7)}:{};setRelationshipFilters(current=>current.map((entry,i)=>i===index?{...entry,relationshipTypeId:next.relationshipTypeId,legacyRelationship:next.legacyRelationship}:entry))}}><option value="">Choose relationship type or legacy label</option><optgroup label="Relationship types">{relationshipTypes.filter(type=>!relationshipFilters.some((entry,entryIndex)=>entryIndex!==index&&entry.relationshipTypeId===type.id)||type.id===item.relationshipTypeId).map(type=><option key={`type:${type.id}`} value={`type:${type.id}`}>{type.label} / {type.reverseLabel}{type.active?"":" (inactive)"}</option>)}</optgroup><optgroup label="Legacy labels">{legacyRelationshipLabels.filter(value=>!relationshipFilters.some((entry,entryIndex)=>entryIndex!==index&&entry.legacyRelationship?.toLowerCase()===value.toLowerCase())||value.toLowerCase()===item.legacyRelationship?.toLowerCase()).map(value=><option key={`legacy:${value}`} value={`legacy:${value}`}>{value} (legacy)</option>)}</optgroup></select><select aria-label={`Relationship condition ${index+1}`} value={item.exclude?"exclude":"include"} onChange={e=>{setRelationshipFilters(current=>current.map((entry,i)=>i===index?{...entry,exclude:e.target.value==="exclude"}:entry))}}><option value="include">Has this relationship</option><option value="exclude">Does not have this relationship</option></select><button type="button" onClick={()=>{setRelationshipFilters(current=>current.filter((_,i)=>i!==index))}}>Remove relationship filter</button></div>})}{relationshipFilters.length<10&&<button type="button" onClick={()=>{setRelationshipFilters(current=>[...current,{exclude:false}])}}>Add relationship filter</button>}<select aria-label="Filter by active group type" value={groupType} onChange={e=>{setGroupType(e.target.value)}}><option value="">All group types</option>{groupType&&!groupTypes.includes(groupType)&&<option value={groupType}>Unavailable group type</option>}{groupTypes.map(type=><option key={type} value={type}>{type}</option>)}</select><select aria-label="Filter by active group membership" value={groupId} onChange={e=>{setGroupId(e.target.value)}}><option value="">All groups</option>{groupId&&!directoryGroups.some(group=>group.id===groupId)&&<option value={groupId}>Unavailable group</option>}{directoryGroups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select><input aria-label="Filter by active group membership role" placeholder="Group role (exact match)" maxLength={80} value={groupRole} onChange={e=>{setGroupRole(e.target.value)}}/><label>Group joined from<input type="date" value={groupJoinedFrom} max={groupJoinedThrough || undefined} onChange={event=>setGroupJoinedFrom(event.target.value)}/></label><label>Group joined through<input type="date" value={groupJoinedThrough} min={groupJoinedFrom || undefined} onChange={event=>setGroupJoinedThrough(event.target.value)}/></label>{(historyGroups.length>0||formerGroupId)&&<label>Former group membership<select value={formerGroupId} onChange={event=>setFormerGroupId(event.target.value)}><option value="">No former group filter</option>{formerGroupId&&!historyGroups.some(group=>group.id===formerGroupId)&&<option value={formerGroupId}>Unavailable group</option>}{historyGroups.map(group=><option key={group.id} value={group.id}>{group.name}{group.status==="active"?"":" ("+group.status+")"}</option>)}</select></label>}<PeopleMeetingFilter key={departmentId} value={attendedMeetingId} onChange={setAttendedMeetingId} request={request}/><select aria-label="Sort directory" value={sort} onChange={e=>{setSort(e.target.value as DirectorySort)}}><option value="lastName">Last name (A–Z)</option><option value="nameDescending">Last name (Z–A)</option><option value="firstName">First name (A–Z)</option><option value="status">Status, then last name</option></select><details className="people-column-picker"><summary>Columns ({columns.length})</summary><div>{columnOptions.map(option=><label key={option.key}><input type="checkbox" checked={columns.includes(option.key)} disabled={(columns.length===1&&columns.includes(option.key))||(!columns.includes(option.key)&&columns.length>=20)} onChange={e=>{setColumns(current=>e.target.checked?[...current,option.key]:current.filter(column=>column!==option.key))}}/>{option.label}</label>)}</div></details><select aria-label="Saved directory views" value={activeSavedView} onChange={e=>{const id=e.target.value;setActiveSavedView(id);const view=savedViews.find(item=>item.id===id);setViewName(view?.name??"");if(view){setFilter(view.q??"");setStatus(view.status??"");setGroupId(view.groupId??"");setGroupType(view.groupType??"");setGroupRole(view.groupRole??"");setGroupJoinedFrom(view.groupJoinedFrom??"");setGroupJoinedThrough(view.groupJoinedThrough??"");setFormerGroupId(view.formerGroupId??"");setAttendedMeetingId(view.attendedMeetingId??"");setSort(view.sort??"lastName");setCustomFilters(view.filters?.length?view.filters:(view.field? [{field:view.field,value:view.value??""}]:[]));setRelationshipFilters(view.relationshipFilters??[]);const nextColumns=(view.columns?.length?view.columns:defaultDirectoryColumns).filter(column=>!column.startsWith("custom:")||fields.some(field=>field.active&&`custom:${field.fieldKey}`===column));setColumns(nextColumns.length?nextColumns:defaultDirectoryColumns)}}}><option value="">Saved views…</option>{savedViews.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}</select><input aria-label="Saved view name" placeholder="Name this view" maxLength={80} value={viewName} onChange={e=>setViewName(e.target.value)}/><button type="button" onClick={()=>void saveDirectoryView("new")}>Save as new view</button>{activeSavedView&&<><button type="button" onClick={()=>void saveDirectoryView("update")}>Update saved view</button><button type="button" onClick={()=>void saveDirectoryView("rename")}>Rename saved view</button><button type="button" onClick={()=>void removeDirectoryView()}>Delete view</button></>}<button onClick={()=>void exportCsv()}><Download size={16}/> Export CSV</button>{selectedPeople.length>0&&!showArchived&&<MailingRecipientsExport key={departmentId} contactIds={selectedPeople} departmentId={departmentId}/>}{canManage&&selectedPeople.length>0&&<><select aria-label="New status for selected people" value={bulkStatus} onChange={e=>setBulkStatus(e.target.value as "member"|"visitor")}><option value="member">Set as member</option><option value="visitor">Set as visitor</option></select><button type="button" onClick={()=>void bulkUpdateStatus()}>Update {selectedPeople.length} selected</button><select aria-label="Custom field to update" value={bulkFieldId} onChange={e=>{setBulkFieldId(e.target.value);setBulkFieldValue("")}}><option value="">Choose custom field…</option>{fields.filter(field=>field.active).map(field=><option key={field.id} value={field.id}>{field.label}</option>)}</select>{selectedBulkField?.type==="boolean"?<select aria-label={`Value for ${selectedBulkField.label}`} value={bulkFieldValue} onChange={e=>setBulkFieldValue(e.target.value)}><option value="">Clear value</option><option value="true">Yes</option><option value="false">No</option></select>:selectedBulkField?.type==="select"?<select aria-label={`Value for ${selectedBulkField.label}`} value={bulkFieldValue} onChange={e=>setBulkFieldValue(e.target.value)}><option value="">Clear value</option>{selectedBulkField.options.map(option=><option key={option} value={option}>{option}</option>)}</select>:selectedBulkField&&<input aria-label={`Value for ${selectedBulkField.label}`} type={selectedBulkField.type==="date"?"date":"text"} maxLength={selectedBulkField.type==="text"?2000:undefined} value={bulkFieldValue} onChange={e=>setBulkFieldValue(e.target.value)} placeholder={selectedBulkField.required?"Value is required":"Blank clears the value"}/>}<button type="button" disabled={!selectedBulkField} onClick={()=>void bulkUpdateField()}>Update custom field for {selectedPeople.length} selected</button>{visibleArchiveSelection.length>0&&<button type="button" disabled={bulkArchivePending} onClick={()=>void bulkUpdateArchive()}>{showArchived?"Restore":"Archive"} {visibleArchiveSelection.length} visible selected</button>}<button type="button" onClick={()=>setSelectedPeople([])}>Clear selection</button></>}</div><div className="module-grid"><section className="module-card"><h2>Directory</h2>{canAssignGroups && !showArchived && selectedPeople.length > 0 && <form className="module-toolbar" onSubmit={assignSelectedPeople}>
  <label>Group to assign<select required value={assignmentGroupId} onChange={event => setAssignmentGroupId(event.target.value)}>
    <option value="">Choose an active local group</option>
    {directoryGroups.filter(group => group.isLocal).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
  </select></label>
  <label>Membership role<input required maxLength={80} value={assignmentRole} onChange={event => setAssignmentRole(event.target.value)} /></label>
  <label>Membership status<select value={assignmentStatus} onChange={event => setAssignmentStatus(event.target.value as typeof assignmentStatus)}>
    <option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option>
  </select></label>
  <button disabled={assignmentPending || !assignmentGroupId || !assignmentRole.trim()} type="submit">Add {selectedPeople.length} selected to group</button>
  <button disabled={assignmentPending || !assignmentGroupId || !assignmentRole.trim()} type="submit" value="update">Update existing memberships</button>
</form>}{pageReady&&<nav aria-label="Directory pages" className="module-toolbar"><button type="button" disabled={page<=1} onClick={()=>setPaging({criteriaKey,page:page-1})}>Previous page</button><span>Page {page} of {pageCount} · {statistics.total.toLocaleString()} matching people</span><button type="button" disabled={page>=pageCount} onClick={()=>setPaging({criteriaKey,page:page+1})}>Next page</button></nav>}{pageReady&&<details className="people-directory-statistics"><summary>Directory statistics</summary><p>Showing {people.length.toLocaleString()} of {statistics.total.toLocaleString()} matching {showArchived?"archived":"active"} people.</p><dl><div><dt>Members</dt><dd>{statistics.members.toLocaleString()}</dd></div><div><dt>Visitors</dt><dd>{statistics.visitors.toLocaleString()}</dd></div><div><dt>With email</dt><dd>{statistics.withEmail.toLocaleString()}</dd></div><div><dt>With phone</dt><dd>{statistics.withPhone.toLocaleString()}</dd></div></dl></details>}{canManage&&<label><input type="checkbox" aria-label="Select this page people" checked={people.length>0&&people.every(p=>selectedPeople.includes(p.id))} onChange={e=>setSelectedPeople(current=>e.target.checked?[...new Set([...current,...people.map(p=>p.id)])]:current.filter(id=>!people.some(p=>p.id===id)))}/> Select all visible</label>}{people.map(p=><div className="people-record-row" key={p.id}>{canManage&&<input type="checkbox" aria-label={`Select ${p.firstName} ${p.lastName}`} checked={selectedPeople.includes(p.id)} onChange={e=>setSelectedPeople(current=>e.target.checked?[...new Set([...current,p.id])]:current.filter(id=>id!==p.id))}/>}<button type="button" onClick={()=>void loadPerson(p)}><strong>{p.firstName} {p.lastName}</strong><span className="people-directory-values">{columns.filter(column=>column!=="firstName"&&column!=="lastName").map(column=><span key={column}><b>{columnOptions.find(option=>option.key===column)?.label??column}:</b> {String(directoryColumnValue(p,column))}</span>)}</span></button></div>)}</section>{selected&&<section className="module-card"><h2>{selected.firstName} {selected.lastName}</h2>{selected.archivedAt&&<p>Archived</p>}{canManage&&<button type="button" onClick={()=>void setPersonArchived(selected,!selected.archivedAt)}>{selected.archivedAt?"Restore person":"Archive person"}</button>}<button type="button" onClick={()=>void exportVCard(selected)}><Download size={16}/> Export vCard</button><p>{selected.email} · {selected.phone}</p>{(dates.birthDate||dates.weddingAnniversary)&&<p>Private dates: {dates.birthDate?`Birth date ${dates.birthDate}`:""}{dates.birthDate&&dates.weddingAnniversary?" · ":""}{dates.weddingAnniversary?`Wedding anniversary ${dates.weddingAnniversary}`:""}</p>}{!canManage && selected.postalAddress && Object.keys(selected.postalAddress).length > 0 && <dl>{postalAddressFields.map(({key,label}) => selected.postalAddress?.[key] && <div key={key}><dt>{label}</dt><dd>{selected.postalAddress[key]}</dd></div>)}</dl>}{canManage&&<form key={selected.id} onSubmit={saveProfile}><h3>Contact profile</h3><label>First name<input name="firstName" required maxLength={100} defaultValue={selected.firstName}/></label><label>Last name<input name="lastName" required maxLength={100} defaultValue={selected.lastName}/></label><label>Email<input name="email" type="email" maxLength={254} defaultValue={selected.email??""}/></label><label>Phone<input name="phone" type="tel" maxLength={60} defaultValue={selected.phone??""}/></label><label>Status<select name="status" defaultValue={selected.status}><option value="member">Member</option><option value="visitor">Visitor</option></select></label><fieldset><legend>Postal address</legend>{postalAddressFields.map(({key,label,limit,autoComplete}) => <label key={key}>{label}<input name={key} maxLength={limit} autoComplete={autoComplete} defaultValue={selected.postalAddress?.[key] ?? ""}/></label>)}</fieldset><button>Save contact profile</button></form>}<PersonGroupMemberships key={`${departmentId}:${selected.id}`} contactId={selected.id} request={request} onNavigateEntity={onNavigateEntity}/><PersonAttachments key={`attachments:${departmentId}:${selected.id}`} contactId={selected.id} departmentId={departmentId} csrfToken={csrfToken} canManage={canManageSite || department.role==="site_admin" || department.permissions?.includes("people_manage")===true} archived={Boolean(selected.archivedAt)}/>{canManagePeopleRecords && !selected.archivedAt && <PersonGrowthTrajectory key={`growth:${departmentId}:${selected.id}`} contactId={selected.id} request={request} realtime={realtime}/>}
{canManagePeopleRecords && <PersonPrivateNotes key={`notes:${departmentId}:${selected.id}`} contactId={selected.id} archived={Boolean(selected.archivedAt)} request={request}/>}<PersonHousehold key={`household:${departmentId}:${selected.id}`} contactId={selected.id} personalAddress={selected.postalAddress} archived={Boolean(selected.archivedAt)} canManage={canManagePeopleRecords} request={request} onNavigateEntity={onNavigateEntity}/><div className="module-tabs">{[["history","History"],["consents","Consents"],["relationships","Relationships"], ...(canViewServiceWorkload ? [["workload","Workload"]] : [])].map(([section,label])=><button key={section} type="button" aria-current={detailsSection===section?"page":undefined} onClick={()=>void loadPerson(selected,section)}>{label}</button>)}</div>{detailsSection==="workload"&&canViewServiceWorkload?<PersonServiceWorkload key={departmentId+":"+selected.id} contactId={selected.id} departmentId={departmentId} onNavigateEntity={onNavigateEntity}/>:detailsSection==="history"?<PersonHistoryTimeline key={`${departmentId}:${selected.id}`} contactId={selected.id} departmentId={departmentId} onNavigateEntity={onNavigateEntity}/>:extras.map(x=><article className="people-record-detail" key={`${x.id}-${x.isReciprocal?"reverse":"forward"}`}><strong>{detailsSection==="relationships"?x.relationship:x.action??x.purpose}</strong><span>{detailsSection==="relationships"?`${x.firstName??""} ${x.lastName??""}`:x.subject??x.status??`${x.firstName??""} ${x.lastName??""}`} {x.createdAt?new Date(x.createdAt).toLocaleString():""}</span>{detailsSection==="consents"&&<dl><dt>Recorded</dt><dd>{x.capturedAt?new Date(x.capturedAt).toLocaleString():"Unknown"}</dd><dt>Recorded by</dt><dd>{x.actorName??"Unknown"}</dd>{x.source&&<><dt>Source</dt><dd>{x.source}</dd></>}{x.expiresAt&&<><dt>Expires</dt><dd>{x.expiresAt.slice(0,10)}</dd></>}{x.notes&&<><dt>Notes</dt><dd>{x.notes}</dd></>}</dl>}{detailsSection==="relationships"&&canManage&&<button type="button" onClick={()=>void removeRelationship(x)}>Remove</button>}</article>)}{canManage&&<><form onSubmit={savePersonDates}><h3>Birth and anniversary dates</h3><label>Date of birth<input type="date" value={dates.birthDate??""} onChange={e=>setDates({...dates,birthDate:e.target.value||null})}/></label><label>Wedding anniversary<input type="date" value={dates.weddingAnniversary??""} onChange={e=>setDates({...dates,weddingAnniversary:e.target.value||null})}/></label><button>Save dates</button></form><div><h3>Custom field values</h3>{fields.filter(f=>f.active).map(f=><label key={f.id}>{f.label}{f.type==="select"?<select defaultValue={String(selected.fields[f.fieldKey]??"")} onChange={e=>void saveField(f,e.target.value)}><option value="">Not set</option>{f.options.map(o=><option key={o}>{o}</option>)}</select>:f.type==="boolean"?<input type="checkbox" defaultChecked={selected.fields[f.fieldKey]===true} onChange={e=>void saveField(f,e.target.checked)}/>:<input type={f.type} defaultValue={String(selected.fields[f.fieldKey]??"")} onBlur={e=>{if(e.target.value!==String(selected.fields[f.fieldKey]??""))void saveField(f,e.target.value)}}/>}</label>)}</div><form onSubmit={addConsent}><h3>Record consent</h3><input required placeholder="Purpose" value={consentPurpose} onChange={e=>setConsentPurpose(e.target.value)}/><select value={consentStatus} onChange={e=>setConsentStatus(e.target.value)}><option value="granted">Granted</option><option value="pending">Pending</option><option value="withdrawn">Withdrawn</option></select><label>Source<input name="source" maxLength={120}/></label><label>Expiry date<input name="expiresAt" type="date"/></label><label>Notes<textarea name="notes" maxLength={1000}/></label><button>Save consent</button></form><form onSubmit={addRelationship}><h3>Add relationship</h3><input aria-label="Search for related person" placeholder="Search people by name" maxLength={120} value={relationshipSearch} onChange={e=>{setRelationshipSearch(e.target.value);setRelatedId("")}}/><select required value={relatedId} onChange={e=>setRelatedId(e.target.value)}><option value="">Choose person</option>{relationshipPeople.filter(p=>p.id!==selected.id).map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select><select required aria-label="Relationship type" value={relationshipTypeId} onChange={e=>setRelationshipTypeId(e.target.value)}><option value="">Choose relationship type</option>{relationshipTypes.filter(type=>type.active).map(type=><option key={type.id} value={type.id}>{type.label} / {type.reverseLabel}</option>)}</select><button disabled={!relationshipTypes.some(type=>type.active)}>Add relationship</button></form></>}</section>}</div></>}
    {tab==="fields"&&<>{canManagePeopleRecords && (department.role === "site_admin" || department.permissions?.includes("groups_manage")) && <GrowthTrajectorySettings key={departmentId} request={request}/>}<section className="module-card"><h2>Location custom fields</h2>{canManage && <form onSubmit={createTag}>
  <h3>Person tags</h3>
  <label>Tag name<input required maxLength={60} value={tagLabel} onChange={event => setTagLabel(event.target.value)} /></label>
  <button type="submit" disabled={!tagLabel.trim() || tagBusy}>Create tag</button>
</form>}{canManage && tags.length > 0 && <details>
  <summary>Edit tag names and colors</summary>
  {tags.map(tag => <PersonTagAppearance
    key={JSON.stringify([departmentId, tag.id, tag.label, tag.tagColor])}
    label={tag.label} color={tag.tagColor ?? null}
    save={async (appearance) => {
      await request(`/api/people-records/tags/${tag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...appearance, expected: { label: tag.label, color: tag.tagColor ?? null } }),
      });
      setMessage("Tag updated.");
      await load();
    }}
  />)}
</details>}{canManage&&<div><h3>Optional profile fields</h3><p>Add these fields when you need them at this location. They can be edited on profiles and used in filters and CSV.</p>{[
      { key: "nickname", label: "Nickname" },
      { key: "first_contact_date", label: "First contact date" },
      { key: "nationality", label: "Nationality" },
      { key: "marital_status", label: "Marital status" },
    ].map(preset=><button key={preset.key} type="button" disabled={fields.some(field=>field.fieldKey===preset.key)} onClick={()=>void act(()=>request("/api/people-records/fields/preset",{method:"POST",body:JSON.stringify({key:preset.key})}),`${preset.label} field added.`)}>Add {preset.label.toLowerCase()}</button>)}</div>}{fields.map(field => <div key={field.id}>
      <p><strong>{field.label}</strong> · {field.fieldKey} · {field.type}{field.required ? " · required" : ""}</p>
      {canManagePeopleRecords && <form className="module-toolbar" key={field.visibility} onSubmit={(event) => void updateFieldVisibility(event, field)}>
        <label>Visibility<select name="visibility" aria-label={`Visibility of ${field.label}`} defaultValue={field.visibility ?? "private_people"}>
          <option value="private_people">Private People readers</option><option value="people_managers">People managers only</option>
        </select></label><button type="submit">Save visibility</button>
      </form>}
    </div>)}{canManagePeopleRecords&&<form onSubmit={createField}><h3>Add a field</h3><input required placeholder="Label" value={label} onChange={e=>setLabel(e.target.value)}/><input required placeholder="field_key" pattern="[a-z][a-z0-9_]{0,39}" value={key} onChange={e=>setKey(e.target.value)}/><select value={fieldType} onChange={e=>setFieldType(e.target.value as Field["type"])}><option value="text">Text</option><option value="date">Date</option><option value="boolean">Yes/no</option><option value="select">Choice list</option></select>{fieldType==="select"&&<input placeholder="Choices, comma separated" value={options} onChange={e=>setOptions(e.target.value)}/>}<label>Visibility<select value={fieldVisibility} onChange={(event) => setFieldVisibility(event.target.value as FieldVisibility)}><option value="private_people">Private People readers</option><option value="people_managers">People managers only</option></select></label><button><UserRoundPlus size={16}/> Create field</button></form>}</section><section className="module-card"><h2>Relationship types</h2><p>Each type defines the label shown from both profiles. Inactive types remain visible on existing relationships.</p>{relationshipTypes.map(type=><form key={type.id} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void updateRelationshipType(type,{label:String(form.get("label")??""),reverseLabel:String(form.get("reverseLabel")??""),active:form.get("active")==="on"})}}><label>Forward label<input name="label" required maxLength={60} readOnly={!canManage} defaultValue={type.label}/></label><label>Reverse label<input name="reverseLabel" required maxLength={60} readOnly={!canManage} defaultValue={type.reverseLabel}/></label><label><input name="active" type="checkbox" disabled={!canManage} defaultChecked={type.active}/> Active</label>{canManage&&<button>Save type</button>}</form>)}{relationshipTypes.length===0&&<p>No relationship types are configured for this location.</p>}{canManage&&<form onSubmit={createRelationshipType}><h3>Add relationship type</h3><label>Forward label<input required maxLength={60} value={newRelationshipLabel} onChange={e=>setNewRelationshipLabel(e.target.value)}/></label><label>Reverse label<input required maxLength={60} value={newRelationshipReverseLabel} onChange={e=>setNewRelationshipReverseLabel(e.target.value)}/></label><button><UserRoundPlus size={16}/> Create relationship type</button></form>}</section><section className="module-card"><h2>Person field values</h2><p>Select a person in Directory, then enter values in the corresponding profile workflows. Value storage and audit are available through the module API.</p></section></>}
    {tab==="duplicates"&&<section className="module-card"><h2>Potential duplicate people</h2><button onClick={()=>void act(async()=>{const r=await request<{candidates:Candidate[]}>('/api/people-records/duplicates');setDuplicates(r.candidates)},"Duplicate candidates refreshed.")}>Find duplicates</button>{duplicates.map(d=><article className="people-record-detail" key={d.personId+d.matchId}><strong>{d.firstName} {d.lastName} ↔ {d.matchFirstName} {d.matchLastName}</strong><span>{d.reason} match · {d.email??d.matchEmail??""}</span><div>{canManage&&<><button type="button" onClick={()=>void reviewMerge(d.personId,d.matchId)}>Review merge keeping {d.firstName}</button><button type="button" onClick={()=>void reviewMerge(d.matchId,d.personId)}>Review merge keeping {d.matchFirstName}</button></>}</div></article>)}{mergePreview&&<section className="module-card" aria-label="Merge review"><h3>Merge review</h3><p><strong>Keeper:</strong> {mergePreview.keeper.firstName} {mergePreview.keeper.lastName} · {mergePreview.keeper.email??mergePreview.keeper.phone??"no contact details"} · {mergePreview.keeper.status}</p><p><strong>Source to remove:</strong> {mergePreview.source.firstName} {mergePreview.source.lastName} · {mergePreview.source.email??mergePreview.source.phone??"no contact details"} · {mergePreview.source.status}</p><p>Non-empty keeper values are retained. An email or phone from the source fills the keeper only when that field is blank. Linked records will be moved.</p>{mergePreview.profileConflicts.length>0&&<><h4>Profile conflicts</h4><ul>{mergePreview.profileConflicts.map(c=><li key={c.field}>{c.field}: keep “{c.keepValue}”; source has “{c.sourceValue}”</li>)}</ul><label><input type="checkbox" checked={mergeConflictsConfirmed} onChange={e=>setMergeConflictsConfirmed(e.target.checked)}/> I reviewed these conflicts and want to keep the selected keeper’s values.</label></>}{mergePreview.customFieldConflicts.length>0&&<><h4>Custom field conflicts</h4><ul>{mergePreview.customFieldConflicts.map((c,i)=><li key={`${c.field}-${i}`}>{c.field}: keeper {JSON.stringify(c.keeperValue)}; source {JSON.stringify(c.sourceValue)}</li>)}</ul></>}{mergePreview.dateConflicts.length>0&&<><h4>Date conflicts</h4><ul>{mergePreview.dateConflicts.map(c=><li key={c.kind}>{c.kind}: keeper {c.keeperValue}; source {c.sourceValue}</li>)}</ul></>}{mergePreview.blockers.length>0&&<><h4>Linked record conflicts</h4><ul>{mergePreview.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul></>}{(mergePreview.customFieldConflicts.length>0||mergePreview.dateConflicts.length>0||mergePreview.blockers.length>0)&&<p>Resolve these conflicts before merging.</p>}<button type="button" onClick={()=>void applyMerge()} disabled={!canManage||(mergePreview.profileConflicts.length>0&&!mergeConflictsConfirmed)||mergePreview.customFieldConflicts.length>0||mergePreview.dateConflicts.length>0||mergePreview.blockers.length>0}>Merge source into keeper</button><button type="button" onClick={()=>setMergePreview(null)}>Cancel</button></section>}</section>}
    {tab==="import"&&canAssignGroups&&<GroupMembershipImport key={departmentId} groups={directoryGroups} request={request} onAdded={()=>void load()}/>}
    {tab==="import"&&<section className="module-card"><h2>CSV import preview</h2><p>Upload up to 500 CSV rows, map columns to contact details and active custom fields, then review validation and likely matches. Only explicitly selected new rows are created. Files with more than 500 data rows are limited to the first 500.</p><input type="file" accept=".csv,text/csv" onChange={e=>void csvPreview(e)}/>{csvHeaders.length>0&&<><h3>Map CSV columns</h3>{[{key:"firstName",label:"First name",required:true},{key:"lastName",label:"Last name",required:true},{key:"email",label:"Email"},{key:"phone",label:"Phone"},...postalAddressFields.map(({key,label})=>({key:"address:"+key,label,required:false})),...fields.filter(field=>field.active).map(field=>({key:`custom:${field.fieldKey}`,label:field.label}))].map(target=><label key={target.key}>{target.label}{target.required?" (required)":""}<select value={csvMapping[target.key]??""} onChange={e=>{const value=e.target.value;setCsvMapping(current=>{const next={...current};if(value)next[target.key]=value;else delete next[target.key];return next});setPreview(null);setSelectedRows([])}}><option value="">Do not import</option>{csvHeaders.map((header,index)=><option key={`${index}:${header}`} value={String(index)}>{header}</option>)}</select></label>)}<button type="button" disabled={csvMapping.firstName===undefined||csvMapping.lastName===undefined} onClick={()=>void runCsvImportPreview()}>Preview mapped rows</button></>}{preview&&<><p>{preview.counts.new} new · {preview.counts.review} match candidates · {preview.counts.invalid??0} invalid</p><div>{preview.rows.map(r=><label className="people-record-row" key={r.row}><input type="checkbox" disabled={r.decision!=="new"} checked={selectedRows.includes(r.row)} onChange={e=>setSelectedRows(e.target.checked?[...selectedRows,r.row]:selectedRows.filter(n=>n!==r.row))}/><span>CSV row {r.row}: {r.person.firstName} {r.person.lastName} · {r.person.email??r.person.phone??"no contact detail"}{r.match?` · Review match: ${r.match.firstName} ${r.match.lastName}`:r.validationError?` · Invalid: ${r.validationError}`:" · New"}{postalAddressFields.map(({key,label})=>r.person.postalAddress?.[key]&&<span key={key}> · {label}: {r.person.postalAddress[key]}</span>)}{Object.entries(r.person.fields??{}).map(([key,value])=><span key={key}> · {fields.find(field=>field.fieldKey===key)?.label??key}: {String(value)}</span>)}</span></label>)}</div><button disabled={!selectedRows.length} onClick={()=>void applyImport()}>Confirm create for {selectedRows.length} selected rows</button></>}{importResult!==null&&<pre>{JSON.stringify(importResult,null,2)}</pre>}</section>}
  </main>
}
