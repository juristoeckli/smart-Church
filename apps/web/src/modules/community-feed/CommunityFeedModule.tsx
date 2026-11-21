import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, Link2, MessageCircle, Newspaper, Send, Trash2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { translateModuleText } from "../../module-registry";
import { formatUserDate } from "../../date-format";
import { translationsForModule } from "../translations";
import { PostBody, PostBodyEditor, type PostBodyFormat } from "./PostBody";
import { DigestPreferences } from "./DigestPreferences";
import { EmailHistory } from "./EmailHistory";
import "./community-feed.css";
import "./community-feed-details.css";

type FeedComment = { id: string; body: string; authorId: string; authorName: string; createdAt: string };
type FeedGroup = { id: string; name: string; isSubscribed: boolean };
type FeedAttachment = { id: string; filename: string; contentType: string; url: string };
type FeedLink = { type: "person" | "group" | "wiki" | "song"; id: string; label: string };
type EntityOption = { id: string; label: string };
type FeedNotification = { id: string; postId: string; kind: "post" | "reaction" | "comment" | "mention"; createdAt: string; readAt: string | null; actorName: string | null; postTitle: string; summary: string };
type FeedReport = { id: string; postId: string; title: string; body: string; authorName: string; reporterName: string; reason: "spam" | "inappropriate" | "harmful" | "other"; details: string; status: "open" | "dismissed" | "actioned"; createdAt: string };
type FeedNotificationPreferences = { posts: boolean; reactions: boolean; comments: boolean; emailPosts: boolean; emailReactions: boolean; emailComments: boolean };
type FeedPost = {
  id: string;
  title: string;
  body: string;
  bodyFormat?: PostBodyFormat;
  authorId: string;
  authorName: string;
  createdAt: string;
  publishAt: string | null;
  expiresAt: string | null;
  expiredAt: string | null;
  commentsEnabled: boolean;
  groupId: string | null;
  groupName: string | null;
  visibility: "location" | "members";
  myReaction: "like" | "love" | "pray" | "celebrate" | null;
  reactions: Partial<Record<"like" | "love" | "pray" | "celebrate", number>>;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  comments: FeedComment[];
  attachments: FeedAttachment[];
  links: FeedLink[];
};

function formatPostDate(value: string) {
  return formatUserDate(value, true);
}

function isScheduled(post: FeedPost) {
  return Boolean(post.publishAt && new Date(post.publishAt).getTime() > Date.now());
}

export function CommunityFeedModule({ department, departmentId, csrfToken, language, canManageSite, onNavigateEntity }: ModuleContext) {
  const t = (message: string) => translateModuleText(message, translationsForModule("community-feed"), language);
  const canReviewReports = canManageSite || (department.modulePermissions?.["community-feed"] ?? []).includes("moderate");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [feedScope, setFeedScope] = useState<"all" | "mine" | "groups" | "following" | "hidden" | "expired">("all");
  const [visibility, setVisibility] = useState<"location" | "members">("location");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [bodyFormat, setBodyFormat] = useState<PostBodyFormat>("plain");
  const [mentionedPeople, setMentionedPeople] = useState<EntityOption[]>([]);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentMentionOpen, setCommentMentionOpen] = useState<Record<string, boolean>>({});
  const [commentMentionQueries, setCommentMentionQueries] = useState<Record<string, string>>({});
  const [commentMentionOptions, setCommentMentionOptions] = useState<Record<string, EntityOption[]>>({});
  const [commentMentionPeople, setCommentMentionPeople] = useState<Record<string, EntityOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [detailsPost, setDetailsPost] = useState<FeedPost | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBodyFormat, setEditBodyFormat] = useState<PostBodyFormat>("plain");
  const [files, setFiles] = useState<File[]>([]);
  const [linkType, setLinkType] = useState<FeedLink["type"]>("person");
  const [linkQuery, setLinkQuery] = useState("");
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [postLinks, setPostLinks] = useState<FeedLink[]>([]);
  const canMentionPeople = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("people_view_private") || (department.permissions ?? []).includes("people_manage");
  const [notifications, setNotifications] = useState<FeedNotification[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<FeedNotificationPreferences>({ posts: true, reactions: true, comments: true, emailPosts: true, emailReactions: true, emailComments: true });
  const [notificationPreferencesLoaded, setNotificationPreferencesLoaded] = useState(false);
  const [savingNotificationPreferences, setSavingNotificationPreferences] = useState(false);
  const [reportTarget, setReportTarget] = useState<FeedPost | null>(null);
  const [reportReason, setReportReason] = useState<FeedReport["reason"]>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [showReports, setShowReports] = useState(false);
  const [reportStatus, setReportStatus] = useState<FeedReport["status"]>("open");

  useEffect(() => { if (!canMentionPeople && linkType === "person") setLinkType("group"); }, [canMentionPeople, linkType]);

  useEffect(() => {
    if (!detailsPost) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsPost(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailsPost]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const parameters = new URLSearchParams({ scope: feedScope });
      if (groupFilter) parameters.set("groupId", groupFilter);
      const sharedPostId = new URLSearchParams(window.location.search).get("communityPost");
      if (sharedPostId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sharedPostId)) parameters.set("postId", sharedPostId);
      const response = await fetch(`/api/modules/community-feed/posts?${parameters}`, { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as FeedPost[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? t("Could not load community posts.") : t("Could not load community posts."));
      setPosts(result);
      const sharedPost = sharedPostId ? result.find((post) => post.id === sharedPostId) : null;
      if (sharedPost) setDetailsPost(sharedPost);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? t(reason.message) : t("Could not load the community feed."));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [departmentId, feedScope, groupFilter, language]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/community-feed/groups", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as FeedGroup[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error("Could not load groups for posting.");
        setGroups(result);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? t(reason.message) : t("Could not load groups for posting."));
      });
    return () => controller.abort();
  }, [departmentId, language]);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/community-feed/notifications", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as { items?: FeedNotification[] };
      if (response.ok && Array.isArray(result.items)) setNotifications(result.items);
    } catch { /* Keep the feed available if the inbox request fails. */ }
  }, [departmentId]);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  const loadNotificationPreferences = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/community-feed/notification-preferences", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as FeedNotificationPreferences;
      if (response.ok && typeof result.posts === "boolean" && typeof result.reactions === "boolean" && typeof result.comments === "boolean" && typeof result.emailPosts === "boolean" && typeof result.emailReactions === "boolean" && typeof result.emailComments === "boolean") { setNotificationPreferences(result); setNotificationPreferencesLoaded(true); }
    } catch { /* Leave preference controls disabled if loading fails, so a save cannot overwrite unseen settings. */ }
  }, [departmentId]);

  useEffect(() => { void loadNotificationPreferences(); }, [loadNotificationPreferences]);

  async function sendMutation(path: string, method: string, payload?: object): Promise<Record<string, unknown>> {
    const response = await fetch(path, {
      method,
      headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const result = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(result.error ? t(result.error) : t("The request could not be completed."));
    return result;
  }

  useEffect(() => {
    if (!linkQuery.trim() || (linkType === "person" && !canMentionPeople)) { setEntityOptions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void fetch(`/api/modules/community-feed/entities?${new URLSearchParams({ type: linkType, q: linkQuery })}`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => response.json() as Promise<EntityOption[]>).then(setEntityOptions).catch(() => undefined), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [departmentId, linkType, linkQuery, canMentionPeople]);

  useEffect(() => {
    if (!canMentionPeople) { setCommentMentionOptions({}); return; }
    const controllers: AbortController[] = [];
    const timers = Object.entries(commentMentionQueries).map(([postId, query]) => {
      if (!commentMentionOpen[postId] || !query.trim()) {
        setCommentMentionOptions((current) => ({ ...current, [postId]: [] }));
        return undefined;
      }
      const controller = new AbortController();
      controllers.push(controller);
      return window.setTimeout(() => void fetch(`/api/modules/community-feed/entities?${new URLSearchParams({ type: "person", q: query })}`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
        .then((response) => response.json() as Promise<EntityOption[]>).then((options) => setCommentMentionOptions((current) => ({ ...current, [postId]: options }))).catch(() => undefined), 180);
    });
    return () => { controllers.forEach((controller) => controller.abort()); timers.forEach((timer) => { if (timer !== undefined) window.clearTimeout(timer); }); };
  }, [departmentId, commentMentionOpen, commentMentionQueries, canMentionPeople]);

  function addLink(option: EntityOption) {
    if (linkType === "person") {
      if (canMentionPeople && !mentionedPeople.some((person) => person.id === option.id)) {
        setMentionedPeople((current) => [...current, option]);
        setBody((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${option.label}`);
      }
    } else if (!postLinks.some((link) => link.type === linkType && link.id === option.id)) setPostLinks((current) => [...current, { type: linkType, ...option }]);
    setLinkQuery(""); setEntityOptions([]);
  }

  async function uploadAttachment(postId: string, file: File) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read the attachment.")); reader.readAsDataURL(file);
    });
    await sendMutation(`/api/modules/community-feed/posts/${postId}/attachments`, "POST", { filename: file.name, contentType: file.type, data });
  }

  async function publish(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSaving(true); setError(""); setFeedback("");
    try {
      const validMentions = mentionedPeople.filter((person) => body.includes(`@${person.label}`));
      const result = await sendMutation("/api/modules/community-feed/posts", "POST", { title: title.trim(), body: body.trim(), bodyFormat, mentions: validMentions.map((person) => person.id), publishAt: publishAt ? new Date(publishAt).toISOString() : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, commentsEnabled, groupId: groupId || null, visibility });
      const postId = String(result.id);
      if (!postId || postId === "undefined") throw new Error("The post was created, but its attachments could not be saved. Refresh the feed and edit the post.");
      for (const file of files) await uploadAttachment(postId, file);
      for (const link of postLinks) await sendMutation(`/api/modules/community-feed/posts/${postId}/links`, "POST", { type: link.type, entityId: link.id });
      setTitle(""); setBody(""); setBodyFormat("plain"); setFiles([]); setPostLinks([]); setMentionedPeople([]); setPublishAt(""); setExpiresAt(""); setCommentsEnabled(true); setGroupId(""); setVisibility("location");
      setFeedback(publishAt ? t("Your post was scheduled.") : t("Your post was published."));
      await load();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not publish the post.")); }
    finally { setSaving(false); }
  }

  async function setReaction(post: FeedPost, reaction: "like" | "love" | "pray" | "celebrate") {
    try {
      const removing = post.myReaction === reaction;
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/reactions`, removing ? "DELETE" : "POST", removing ? undefined : { reaction });
      await load();
      await loadNotifications();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update your reaction.")); }
  }

  async function toggleComments(post: FeedPost) {
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/comments`, "PATCH", { commentsEnabled: !post.commentsEnabled });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update comments.")); }
  }

  async function publishNow(post: FeedPost) {
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/publish`, "POST");
      setFeedback(t("Your scheduled post was published."));
      await load();
      await loadNotifications();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not publish the scheduled post.")); }
  }

  async function toggleHidden(post: FeedPost) {
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/hide`, feedScope === "hidden" ? "DELETE" : "POST");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update your hidden posts.")); }
  }

  async function toggleSubscription(group: FeedGroup) {
    try {
      await sendMutation(`/api/modules/community-feed/groups/${group.id}/subscription`, group.isSubscribed ? "DELETE" : "POST");
      setGroups((current) => current.map((item) => item.id === group.id ? { ...item, isSubscribed: !item.isSubscribed } : item));
      if (feedScope === "following") await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update group subscription.")); }
  }

  async function openNotification(notification: FeedNotification) {
    try {
      await sendMutation(`/api/modules/community-feed/notifications/${notification.id}/read`, "POST");
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      const response = await fetch(`/api/modules/community-feed/posts?${new URLSearchParams({ scope: "all" })}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as FeedPost[];
      const post = Array.isArray(result) ? result.find((item) => item.id === notification.postId) : null;
      if (post) setDetailsPost(post);
      else setFeedback(t("This post is no longer available to you."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not open this notification.")); }
  }

  async function markNotificationsRead() {
    try {
      await sendMutation("/api/modules/community-feed/notifications/read-all", "POST");
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update notifications.")); }
  }

  async function saveNotificationPreferences() {
    setSavingNotificationPreferences(true); setError(""); setFeedback("");
    try {
      const saved = await sendMutation("/api/modules/community-feed/notification-preferences", "PUT", notificationPreferences) as FeedNotificationPreferences;
      setNotificationPreferences(saved);
      setFeedback(t("Notification preferences saved."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not save notification preferences.")); }
    finally { setSavingNotificationPreferences(false); }
  }

  async function sharePost(post: FeedPost) {
    const url = new URL(window.location.href);
    url.searchParams.set("communityPost", post.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setFeedback(t("Post link copied."));
    } catch {
      window.prompt(t("Copy this post link"), url.toString());
    }
  }

  function beginEdit(post: FeedPost) {
    setDetailsPost(post);
    setEditTitle(post.title);
    setEditBody(post.body);
    setEditBodyFormat(post.bodyFormat ?? "plain");
    setEditingDetails(true);
  }

  async function savePostEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailsPost) return;
    try {
      await sendMutation(`/api/modules/community-feed/posts/${detailsPost.id}`, "PATCH", { title: editTitle.trim(), body: editBody.trim(), bodyFormat: editBodyFormat });
      setEditingDetails(false);
      setDetailsPost(null);
      setFeedback(t("Your post was updated."));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update your post.")); }
  }

  async function comment(post: FeedPost, formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const commentBody = (commentDrafts[post.id] ?? "").trim();
    if (!commentBody) return;
    try {
      const mentions = (commentMentionPeople[post.id] ?? []).filter((person) => commentBody.includes(`@${person.label}`));
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/comments`, "POST", { body: commentBody, mentions: mentions.map((person) => person.id) });
      setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
      setCommentMentionPeople((current) => ({ ...current, [post.id]: [] }));
      setCommentMentionQueries((current) => ({ ...current, [post.id]: "" }));
      setCommentMentionOptions((current) => ({ ...current, [post.id]: [] }));
      await load();
      await loadNotifications();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not add your comment.")); }
  }

  async function deletePost(post: FeedPost) {
    if (!window.confirm(t("Delete this post and its comments?"))) return;
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}`, "DELETE");
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setFeedback(t("The post was deleted."));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not delete the post.")); }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget) return;
    try {
      await sendMutation(`/api/modules/community-feed/posts/${reportTarget.id}/reports`, "POST", { reason: reportReason, details: reportDetails });
      setReportTarget(null); setReportDetails(""); setFeedback(t("The report was sent to the site administrators for review."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not submit this report.")); }
  }

  async function loadReports(status = reportStatus) {
    try {
      const response = await fetch(`/api/modules/community-feed/reports?status=${status}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as FeedReport[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? t("Could not load post reports.") : t("Could not load post reports."));
      setReports(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not load post reports.")); }
  }

  async function reviewReport(report: FeedReport, status: "dismissed" | "actioned") {
    try {
      await sendMutation(`/api/modules/community-feed/reports/${report.id}`, "PATCH", { status });
      await loadReports();
      setFeedback(status === "dismissed" ? t("The report was dismissed.") : t("The report was marked as actioned."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Could not update this report.")); }
  }

  return <main className="community-feed-page">
    <header className="page-heading"><div><div className="eyebrow">{t("CHURCH LIFE")}</div><h1>{t("Community")}</h1><p className="page-subtitle">{t("Share news, encouragement, and updates with your church.")}</p></div></header>
    <form className="community-post-composer" onSubmit={(event) => void publish(event)}>
      <div className="community-feed-card-heading"><span className="community-feed-icon"><Newspaper size={18} /></span><div><strong>{t("Share an update")}</strong><small>{t("Your post will be visible to signed-in members of this location.")}</small></div></div>
      <input aria-label={t("Post title")} maxLength={120} placeholder={t("Title (optional)")} value={title} onChange={(event) => setTitle(event.target.value)} />
      <PostBodyEditor label={t("Post text")} placeholder={t("What would you like the church to know?")} value={body} onChange={setBody} format={bodyFormat} onFormatChange={setBodyFormat} t={t} />
      <label>{t("Photos and files (up to five, 1 MiB each)")}<input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain" onChange={(event) => { const chosen = Array.from(event.target.files ?? []).slice(0, 5); const invalid = chosen.find((file) => file.size > 1_048_576); if (invalid) { setError(t("Each attachment must be 1 MiB or smaller.")); setFiles([]); } else { setError(""); setFiles(chosen); } }} /></label>{files.length > 0 && <small>{files.map((file) => file.name).join(" · ")}</small>}
      <div className="community-post-composer-options"><label>{t("Link or mention")}<select value={linkType} onChange={(event) => setLinkType(event.target.value as FeedLink["type"])}><option value="person" disabled={!canMentionPeople}>{t("Mention a person")}</option><option value="group">{t("Group")}</option><option value="wiki">{t("Wiki page")}</option><option value="song">{t("Song")}</option></select></label><label>{t("Search this location")}<input value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder={t("Type a name…")} /></label>{entityOptions.length > 0 && <div role="listbox" className="community-entity-options">{entityOptions.map((option) => <button type="button" key={option.id} onClick={() => addLink(option)}>{option.label}</button>)}</div>}</div>{mentionedPeople.length > 0 && <div className="community-post-link-chips">{mentionedPeople.map((person) => <button type="button" key={`mention:${person.id}`} onClick={() => { setMentionedPeople((current) => current.filter((item) => item.id !== person.id)); setBody((current) => current.replace(`@${person.label}`, "").replace(/\s{2,}/g, " ")); }}>@{person.label} ×</button>)}</div>}{postLinks.length > 0 && <div className="community-post-link-chips">{postLinks.map((link) => <button type="button" key={`${link.type}:${link.id}`} onClick={() => setPostLinks((current) => current.filter((item) => item.id !== link.id || item.type !== link.type))}>{link.type}: {link.label} ×</button>)}</div>}
      <div className="community-post-composer-options"><label>{t("Post to group (optional)")}<select value={groupId} onChange={(event) => { setGroupId(event.target.value); if (!event.target.value) setVisibility("location"); }}><option value="">{t("Everyone in this location")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{groupId && <><label>{t("Who can see this post?")}<select value={visibility} onChange={(event) => setVisibility(event.target.value as "location" | "members")}><option value="location">{t("Everyone in this location")}</option><option value="members">{t("Group members only")}</option></select></label>{(() => { const group = groups.find((item) => item.id === groupId); return group ? <button className="community-post-details" type="button" onClick={() => void toggleSubscription(group)}>{group.isSubscribed ? t("Unfollow group") : t("Follow group")}</button> : null; })()}</>}</div>
      <div className="community-post-composer-options"><label>{t("Schedule publication")}<input type="datetime-local" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label><label>{t("Automatically remove after")}<input type="datetime-local" min={publishAt || new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label className="community-post-checkbox"><input type="checkbox" checked={commentsEnabled} onChange={(event) => setCommentsEnabled(event.target.checked)} />{t("Allow comments")}</label></div>
      <div className="community-post-composer-footer"><small>{body.length}/4000</small><button className="button button-primary" type="submit" disabled={saving || !body.trim()}><Send size={15} />{saving ? t("Saving…") : publishAt ? t("Schedule post") : t("Publish")}</button></div>
    </form>
    {error && <p className="community-feed-error" role="alert">{error}</p>}
    {feedback && <p className="community-feed-feedback" role="status">{feedback}</p>}
    <section className="community-feed-notifications" aria-label={t("Community notifications")}>
      <div className="community-feed-notifications-heading"><strong><Bell size={16} /> {t("Notifications")}{notifications.some((item) => !item.readAt) ? ` · ${notifications.filter((item) => !item.readAt).length}` : ""}</strong>{notifications.some((item) => !item.readAt) && <button type="button" className="community-post-details" onClick={() => void markNotificationsRead()}>{t("Mark all read")}</button>}</div>
      <details className="community-notification-preferences"><summary>{t("Notification preferences")}</summary><div className="community-notification-preference-group"><strong>{t("In-app alerts")}</strong><div className="community-notification-preference-options"><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.posts} onChange={(event) => setNotificationPreferences((current) => ({ ...current, posts: event.target.checked }))} />{t("New post notifications")}</label><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.reactions} onChange={(event) => setNotificationPreferences((current) => ({ ...current, reactions: event.target.checked }))} />{t("Reaction notifications")}</label><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.comments} onChange={(event) => setNotificationPreferences((current) => ({ ...current, comments: event.target.checked }))} />{t("Comment notifications")}</label></div></div><div className="community-notification-preference-group"><strong>{t("Email alerts")}</strong><p>{t("Email alerts also require Email notifications to be enabled in Notifications for this location.")}</p><div className="community-notification-preference-options"><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.emailPosts} onChange={(event) => setNotificationPreferences((current) => ({ ...current, emailPosts: event.target.checked }))} />{t("New post email alerts")}</label><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.emailReactions} onChange={(event) => setNotificationPreferences((current) => ({ ...current, emailReactions: event.target.checked }))} />{t("Reaction email alerts")}</label><label><input type="checkbox" disabled={!notificationPreferencesLoaded} checked={notificationPreferences.emailComments} onChange={(event) => setNotificationPreferences((current) => ({ ...current, emailComments: event.target.checked }))} />{t("Comment email alerts")}</label><button type="button" className="community-post-details" disabled={!notificationPreferencesLoaded || savingNotificationPreferences} onClick={() => void saveNotificationPreferences()}>{savingNotificationPreferences ? t("Saving…") : t("Save preferences")}</button></div></div><DigestPreferences key={departmentId} departmentId={departmentId} language={language} t={t} sendMutation={sendMutation} /></details>
      {notifications.length ? <ul>{notifications.slice(0, 8).map((item) => <li key={item.id} className={item.readAt ? "is-read" : "is-unread"}><button type="button" onClick={() => void openNotification(item)}><span>{item.actorName ? `${item.actorName} ${t(item.summary)}` : item.summary}{item.postTitle ? ` · ${item.postTitle}` : ""}</span><time dateTime={item.createdAt}>{formatPostDate(item.createdAt)}</time></button></li>)}</ul> : <p>{t("You have no community notifications yet.")}</p>}
      <EmailHistory key={departmentId} departmentId={departmentId} t={t} />
    </section>
    <div className="community-feed-filters"><label>{t("Show")}<select value={feedScope} onChange={(event) => setFeedScope(event.target.value as "all" | "mine" | "groups" | "following" | "hidden" | "expired")}><option value="all">{t("All posts")}</option><option value="groups">{t("Group posts")}</option><option value="following">{t("Following")}</option><option value="mine">{t("My posts")}</option><option value="hidden">{t("Hidden posts")}</option>{canReviewReports && <option value="expired">{t("Expired posts")}</option>}</select></label>{feedScope === "groups" && <label>{t("Group")}<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">{t("All my groups")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}{canReviewReports && <button type="button" className="community-post-details" onClick={() => { const next = !showReports; setShowReports(next); if (next) void loadReports(); }}>{showReports ? t("Hide reports") : t("Review reports")}</button>}</div>
    {showReports && <section className="community-post-list" aria-label={t("Post reports")}><div className="community-feed-filters"><label>{t("Report status")}<select value={reportStatus} onChange={(event) => { const next = event.target.value as FeedReport["status"]; setReportStatus(next); void loadReports(next); }}><option value="open">{t("Open")}</option><option value="dismissed">{t("Dismissed")}</option><option value="actioned">{t("Actioned")}</option></select></label></div>{reports.length ? reports.map((report) => <article className="community-post-card" key={report.id}><header className="community-post-header"><div className="community-post-author"><strong>{report.title || t("Community update")}</strong><time>{t("Reported by")} {report.reporterName} · {formatPostDate(report.createdAt)}</time></div></header><p>{t("Post by")} {report.authorName} · {t(report.reason)}{report.details ? ` — ${report.details}` : ""}</p><p className="community-post-body">{report.body}</p>{report.status === "open" && <div className="community-post-actions"><button type="button" className="community-post-details" onClick={() => void reviewReport(report, "dismissed")}>{t("Dismiss report")}</button><button type="button" className="community-post-details" onClick={() => void reviewReport(report, "actioned")}>{t("Mark actioned")}</button></div>}</article>) : <p className="community-feed-empty">{t("There are no reports in this status.")}</p>}</section>}
    <section className="community-post-list" aria-label={t("Community posts")}>
      {loading ? <p className="community-feed-empty">{t("Loading posts…")}</p> : posts.length ? posts.map((post) => <article className="community-post-card" key={post.id}>
        <header className="community-post-header"><span className="community-post-avatar">{post.authorName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div className="community-post-author"><strong>{post.authorName}</strong><time dateTime={post.publishAt ?? post.createdAt}>{isScheduled(post) ? `${t("Scheduled for")} ${formatPostDate(post.publishAt!)}` : formatPostDate(post.createdAt)}</time></div>{post.canDelete && <div className="community-post-owner-actions">{isScheduled(post) && <button type="button" className="community-post-details" onClick={() => void publishNow(post)}>{t("Publish now")}</button>}<button className="community-post-delete" type="button" aria-label={t("Delete post")} title={t("Delete post")} onClick={() => void deletePost(post)}><Trash2 size={16} /></button></div>}</header>
        {post.groupName && <span className="community-post-group">{post.groupName}{post.visibility === "members" ? ` · ${t("Group members")}` : ""}</span>}{post.title && <h2>{post.title}</h2>}<PostBody value={post.body} format={post.bodyFormat} />{post.links?.length > 0 && <div className="community-post-link-chips">{post.links.map((link) => {
          const navigable = link.type === "person" || link.type === "group" || link.type === "wiki" || link.type === "song";
          return navigable && onNavigateEntity
            ? <button type="button" className="community-post-link-chip community-post-link-chip-button" key={`${link.type}:${link.id}`} aria-label={t("Open linked record")} onClick={() => onNavigateEntity(link.type, link.id)}>{link.type}: {link.label}</button>
            : <span className="community-post-link-chip" key={`${link.type}:${link.id}`}>{link.type}: {link.label}</span>;
        })}</div>}{post.attachments?.length > 0 && <div className="community-post-attachments">{post.attachments.map((file) => file.contentType.startsWith("image/") ? <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.filename} loading="lazy" /></a> : <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.filename}</a>)}</div>}
        <div className="community-post-actions">{(["like", "love", "pray", "celebrate"] as const).map((reaction) => { const labels = { like: "Like", love: "Love", pray: "Pray", celebrate: "Celebrate" }; const icons = { like: "👍", love: "❤️", pray: "🙏", celebrate: "🎉" }; return <button key={reaction} type="button" className={post.myReaction === reaction ? "community-post-like is-liked" : "community-post-like"} onClick={() => void setReaction(post, reaction)} aria-pressed={post.myReaction === reaction} aria-label={t(labels[reaction])} title={t(labels[reaction])}>{icons[reaction]} {post.reactions?.[reaction] ?? 0}</button>; })}<span><MessageCircle size={16} />{post.comments.length} {t(post.comments.length === 1 ? "comment" : "comments")}</span><button type="button" className="community-post-details" onClick={() => { setDetailsPost(post); setEditingDetails(false); }}>{t("View details")}</button><button type="button" className="community-post-details" onClick={() => void sharePost(post)}><Link2 size={14} /> {t("Share")}</button><button type="button" className="community-post-details" onClick={() => void toggleHidden(post)}>{feedScope === "hidden" ? t("Show again") : t("Hide post")}</button>{!post.canDelete && feedScope !== "hidden" && <button type="button" className="community-post-details" onClick={() => { setReportTarget(post); setReportReason("inappropriate"); setReportDetails(""); }}>{t("Report post")}</button>}{post.canDelete && <><button type="button" className="community-post-details" onClick={() => void toggleComments(post)}>{post.commentsEnabled ? t("Turn comments off") : t("Turn comments on")}</button><button type="button" className="community-post-details" onClick={() => beginEdit(post)}>{t("Edit")}</button></>}</div>
        {post.comments.length > 0 && <div className="community-post-comments">{post.comments.map((item) => <div className="community-post-comment" key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p><time dateTime={item.createdAt}>{formatPostDate(item.createdAt)}</time></div>)}</div>}
        {post.commentsEnabled && !isScheduled(post) && <><form className="community-comment-form" onSubmit={(event) => void comment(post, event)}><input aria-label={t("Write a comment…")} maxLength={1000} placeholder={t("Write a comment…")} value={commentDrafts[post.id] ?? ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} /><button type="submit" className="community-comment-submit" disabled={!(commentDrafts[post.id] ?? "").trim()} aria-label={t("Post comment")}><Send size={16} /></button></form>{canMentionPeople && <div className="community-comment-mention-editor"><button type="button" className="community-post-details" aria-expanded={Boolean(commentMentionOpen[post.id])} onClick={() => setCommentMentionOpen((current) => ({ ...current, [post.id]: !current[post.id] }))}>{t("Mention a person")}</button>{commentMentionOpen[post.id] && <><input aria-label={t("Search this location")} placeholder={t("Search this location")} value={commentMentionQueries[post.id] ?? ""} onChange={(event) => setCommentMentionQueries((current) => ({ ...current, [post.id]: event.target.value }))} />{(commentMentionOptions[post.id] ?? []).length > 0 && <div role="listbox" className="community-entity-options">{commentMentionOptions[post.id]!.map((person) => <button type="button" key={person.id} onClick={() => { setCommentMentionPeople((current) => ({ ...current, [post.id]: [...(current[post.id] ?? []).filter((item) => item.id !== person.id), person] })); setCommentDrafts((current) => ({ ...current, [post.id]: `${current[post.id] ?? ""}${current[post.id]?.trim() ? " " : ""}@${person.label}`.slice(0, 1000) })); setCommentMentionQueries((current) => ({ ...current, [post.id]: "" })); setCommentMentionOptions((current) => ({ ...current, [post.id]: [] })); }}>{person.label}</button>)}</div>}{(commentMentionPeople[post.id] ?? []).length > 0 && <div className="community-post-link-chips">{commentMentionPeople[post.id]!.map((person) => <button type="button" key={person.id} onClick={() => { setCommentMentionPeople((current) => ({ ...current, [post.id]: current[post.id]?.filter((item) => item.id !== person.id) ?? [] })); setCommentDrafts((current) => ({ ...current, [post.id]: (current[post.id] ?? "").replace(`@${person.label}`, "").replace(/\s{2,}/g, " ") })); }}>@{person.label} ×</button>)}</div>}</>}</div>}</>}
      </article>) : <p className="community-feed-empty">{t("There are no posts yet. Share the first update with your church.")}</p>}
    </section>
    {detailsPost && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsPost(null)}><section className="modal community-post-details-modal" role="dialog" aria-modal="true" aria-labelledby="community-post-details-title"><div className="modal-heading"><div><span className="eyebrow">{t("Church life")}</span><h2 id="community-post-details-title">{editingDetails ? t("Edit post") : detailsPost.title || t("Community update")}</h2><p>{detailsPost.authorName} · {formatPostDate(detailsPost.createdAt)}</p></div><button className="icon-button" type="button" aria-label={t("Close dialog")} onClick={() => { setDetailsPost(null); setEditingDetails(false); }}><span aria-hidden="true">×</span></button></div>{editingDetails ? <form className="community-post-edit-form" onSubmit={(event) => void savePostEdit(event)}><input aria-label={t("Post title")} maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /><PostBodyEditor label={t("Post text")} value={editBody} onChange={setEditBody} format={editBodyFormat} onFormatChange={setEditBodyFormat} t={t} /><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingDetails(false)}>{t("Cancel")}</button><button className="button button-primary" type="submit" disabled={!editBody.trim()}>{t("Save changes")}</button></div></form> : <><PostBody value={detailsPost.body} format={detailsPost.bodyFormat} className="community-post-details-body" /><section className="community-post-details-comments"><h3>{t("Comments ({count})").replace("{count}", String(detailsPost.comments.length))}</h3>{detailsPost.comments.length ? <ul>{detailsPost.comments.map((item) => <li key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p><time dateTime={item.createdAt}>{formatPostDate(item.createdAt)}</time></li>)}</ul> : <p>{t("No comments yet.")}</p>}</section><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsPost(null)}>{t("Close")}</button></div></>}</section></div>}
    {reportTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReportTarget(null)}><section className="modal community-post-details-modal" role="dialog" aria-modal="true" aria-labelledby="community-report-title"><div className="modal-heading"><div><span className="eyebrow">{t("Community moderation")}</span><h2 id="community-report-title">{t("Report post")}</h2><p>{reportTarget.title || t("Community update")}</p></div><button className="icon-button" type="button" aria-label={t("Close dialog")} onClick={() => setReportTarget(null)}><span aria-hidden="true">×</span></button></div><form className="community-post-edit-form" onSubmit={(event) => void submitReport(event)}><label>{t("Reason")}<select value={reportReason} onChange={(event) => setReportReason(event.target.value as FeedReport["reason"])}><option value="inappropriate">{t("Inappropriate")}</option><option value="spam">{t("Spam")}</option><option value="harmful">{t("Harmful")}</option><option value="other">{t("Other")}</option></select></label><label>{t("Details (optional)")}<textarea maxLength={500} rows={4} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setReportTarget(null)}>{t("Cancel")}</button><button className="button button-primary" type="submit">{t("Send report")}</button></div></form></section></div>}
  </main>;
}
