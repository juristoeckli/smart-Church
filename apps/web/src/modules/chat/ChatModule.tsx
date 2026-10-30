import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CircleAlert, MessageCircle, Pencil, Plus, Search, Send, Shield, Trash2, UserPlus, Users, X } from "lucide-react";
import { translateModuleText, type ModuleContext } from "../../module-registry";
import { formatUserDate } from "../../date-format";
import { translationsForModule } from "../translations";
import "./chat.css";

type PresenceStatus = "offline" | "online" | "away";
type Contact = { id: string; displayName: string; online: boolean; presenceStatus?: PresenceStatus; isAdmin?: boolean; role?: "owner" | "admin" | "member" };
type Participant = Contact;
type Conversation = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  createdBy: string;
  titleSuffix: string | null;
  participants: Participant[];
  lastMessage: string | null;
  unreadCount: number;
  latestUnreadMessage?: { id: string; body: string; author: string } | null;
  updatedAt: string;
};
type ChatMessage = { id: string; userId: string; author: string; body: string; createdAt: string; seenBy: string[] };
type ConversationsResponse = { conversations: Conversation[]; currentUserId: string; canModerate: boolean };

function timeLabel(value: string) {
  return formatUserDate(value, true);
}

function presenceStatus(person: Contact): PresenceStatus {
  return person.presenceStatus ?? (person.online ? "online" : "offline");
}

function chatSuffixStorageKey(userId: string, conversationId: string) {
  return `smart-church-chat-suffix:${userId}:${conversationId}`;
}

function readChatSuffix(userId: string, conversationId: string) {
  try { return window.localStorage.getItem(chatSuffixStorageKey(userId, conversationId)) ?? ""; }
  catch { return ""; }
}

function presenceDot(status: PresenceStatus) {
  if (status === "offline") return null;
  return <i className={`chat-online-dot${status === "away" ? " chat-online-dot-away" : ""}`} title={status === "away" ? "Online; page unfocused and notifications disabled" : "Online"} aria-label={status === "away" ? "Online, page unfocused and notifications disabled" : "Online"} />;
}

function getPresenceSessionId() {
  const key = "smart-church-chat-presence-session";
  const stored = window.sessionStorage.getItem(key);
  if (stored) return stored;
  const id = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

function conversationTitle(conversation: Conversation, currentUserId: string) {
  const others = conversation.participants.filter((person) => person.id !== currentUserId).map((person) => person.displayName);
  if (conversation.kind === "group") return (conversation.name ?? others.join(", ")) || "Group chat";
  const suffix = conversation.titleSuffix?.trim();
  return `${others[0] ?? "Direct message"}${suffix ? ` · ${suffix}` : ""}`;
}

export function ChatModule({ department, departmentId, csrfToken, language, systemNotificationsEnabled = false, realtime, requestedChatConversationId, onChatConversationOpened, onActiveChatChange, refreshCsrfToken }: ModuleContext) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [canModerate, setCanModerate] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [managingConversation, setManagingConversation] = useState(false);
  const [conversationEditName, setConversationEditName] = useState("");
  const [conversationEditSuffix, setConversationEditSuffix] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [savingConversation, setSavingConversation] = useState(false);
  const legacySuffixSyncs = useRef(new Set<string>());
  const [presenceSessionId] = useState(getPresenceSessionId);

  const activeConversation = useMemo(() => conversations.find((conversation) => conversation.id === activeId) ?? null, [conversations, activeId]);
  const isTyping = composerFocused && draft.trim().length > 0;

  const loadOverview = useCallback(async (quiet = false) => {
    try {
      const [conversationResponse, contactsResponse] = await Promise.all([
        fetch("/api/modules/chat/conversations", { headers: { "x-department-id": departmentId } }),
        fetch("/api/modules/chat/contacts", { headers: { "x-department-id": departmentId } }),
      ]);
      const [conversationResult, contactsResult] = await Promise.all([
        conversationResponse.json() as Promise<ConversationsResponse | { error?: string }>,
        contactsResponse.json() as Promise<{ contacts: Contact[] } | { error?: string }>,
      ]);
      if (!conversationResponse.ok || !("conversations" in conversationResult)) throw new Error("error" in conversationResult ? conversationResult.error ?? "Could not load conversations." : "Could not load conversations.");
      if (!contactsResponse.ok || !("contacts" in contactsResult)) throw new Error("error" in contactsResult ? contactsResult.error ?? "Could not load location members." : "Could not load location members.");
      setConversations(conversationResult.conversations.map((conversation) => ({
        ...conversation,
        titleSuffix: conversation.titleSuffix ?? null,
      })));
      setContacts(contactsResult.contacts);
      setCurrentUserId(conversationResult.currentUserId);
      setCanModerate(conversationResult.canModerate);
      setActiveId((current) => current || conversationResult.conversations[0]?.id || "");
      setError("");
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Could not load chat.");
    } finally { setLoading(false); }
  }, [departmentId]);

  useEffect(() => {
    if (!currentUserId) return;
    for (const conversation of conversations) {
      if (conversation.kind !== "direct" || conversation.titleSuffix) continue;
      const suffix = readChatSuffix(currentUserId, conversation.id);
      if (!suffix) continue;
      const key = `${currentUserId}:${conversation.id}`;
      if (legacySuffixSyncs.current.has(key)) continue;
      legacySuffixSyncs.current.add(key);
      void mutate(`/api/modules/chat/conversations/${encodeURIComponent(conversation.id)}`, "PATCH", { titleSuffix: suffix, onlyIfEmpty: true })
        .then(() => {
          try { window.localStorage.removeItem(chatSuffixStorageKey(currentUserId, conversation.id)); } catch { /* The shared suffix is saved on the server. */ }
          void loadOverview(true);
        })
        .catch(() => { legacySuffixSyncs.current.delete(key); });
    }
  }, [conversations, currentUserId, loadOverview]);

  const sendPresence = useCallback(() => {
    const focused = document.visibilityState === "visible" && document.hasFocus();
    const notificationsEnabled = systemNotificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "granted";
    realtime?.send("module:chat:presence", { sessionId: presenceSessionId, focused, notificationsEnabled });
  }, [presenceSessionId, realtime, systemNotificationsEnabled]);

  useEffect(() => {
    void loadOverview();
    void sendPresence();
    const presenceTimer = window.setInterval(() => { void sendPresence(); }, 15_000);
    const unsubscribeChanged = realtime?.subscribe("module:chat:changed", () => { void loadOverview(true); });
    const unsubscribePresence = realtime?.subscribe("module:chat:presence", () => { void loadOverview(true); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void loadOverview(true); sendPresence(); });
    const refreshPresenceAndOverview = () => { void sendPresence(); void loadOverview(true); };
    document.addEventListener("visibilitychange", refreshPresenceAndOverview);
    window.addEventListener("focus", refreshPresenceAndOverview);
    window.addEventListener("blur", refreshPresenceAndOverview);
    return () => {
      window.clearInterval(presenceTimer);
      unsubscribeChanged?.();
      unsubscribePresence?.();
      unsubscribeConnected?.();
      document.removeEventListener("visibilitychange", refreshPresenceAndOverview);
      window.removeEventListener("focus", refreshPresenceAndOverview);
      window.removeEventListener("blur", refreshPresenceAndOverview);
      realtime?.send("module:chat:presence:leave", { sessionId: presenceSessionId });
    };
  }, [departmentId, loadOverview, presenceSessionId, realtime, sendPresence]);

  useEffect(() => {
    onActiveChatChange?.(activeId || null);
    return () => onActiveChatChange?.(null);
  }, [activeId, onActiveChatChange]);

  useEffect(() => {
    if (!requestedChatConversationId) return;
    setActiveId(requestedChatConversationId);
    setComposing(false);
    onChatConversationOpened?.(requestedChatConversationId);
  }, [requestedChatConversationId, onChatConversationOpened]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let cancelled = false;
    async function loadMessages(quiet: boolean) {
      if (!quiet) setMessagesLoading(true);
      try {
        const response = await fetch(`/api/modules/chat/conversations/${encodeURIComponent(activeId)}/messages`, { headers: { "x-department-id": departmentId } });
        const result = await response.json() as { messages: ChatMessage[] } | { error?: string };
        if (!response.ok || !("messages" in result)) throw new Error("error" in result ? result.error ?? "Could not load messages." : "Could not load messages.");
        if (!cancelled) {
          setMessages(result.messages);
          setConversations((current) => current.map((conversation) => conversation.id === activeId ? { ...conversation, unreadCount: 0 } : conversation));
        }
      } catch (reason) {
        if (!quiet && !cancelled) setError(reason instanceof Error ? reason.message : "Could not load messages.");
      } finally { if (!cancelled) setMessagesLoading(false); }
    }
    void loadMessages(false);
    const refreshVisibleChat = () => {
      if (document.visibilityState === "visible") void loadMessages(true);
    };
    const unsubscribeChanged = realtime?.subscribe("module:chat:changed", () => { void loadMessages(true); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void loadMessages(true); });
    document.addEventListener("visibilitychange", refreshVisibleChat);
    window.addEventListener("focus", refreshVisibleChat);
    return () => {
      cancelled = true;
      unsubscribeChanged?.();
      unsubscribeConnected?.();
      document.removeEventListener("visibilitychange", refreshVisibleChat);
      window.removeEventListener("focus", refreshVisibleChat);
    };
  }, [activeId, departmentId, realtime]);

  useEffect(() => {
    if (!activeId) { setTypingUsers([]); return; }
    let cancelled = false;
    async function loadTyping() {
      try {
        const response = await fetch(`/api/modules/chat/conversations/${encodeURIComponent(activeId)}/typing`, { headers: { "x-department-id": departmentId } });
        const result = await response.json() as { typingUsers: string[] } | { error?: string };
        if (response.ok && "typingUsers" in result && !cancelled) setTypingUsers(result.typingUsers);
      } catch { /* Typing indicators are best effort; messages remain available. */ }
    }
    setTypingUsers([]);
    void loadTyping();
    const unsubscribeTyping = realtime?.subscribe("module:chat:typing", () => { void loadTyping(); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void loadTyping(); });
    return () => { cancelled = true; unsubscribeTyping?.(); unsubscribeConnected?.(); };
  }, [activeId, departmentId, realtime]);

  useEffect(() => {
    if (!activeId || !isTyping || composing) return;
    const refreshTyping = () => realtime?.send("module:chat:typing", { conversationId: activeId, typing: true });
    void refreshTyping();
    const timer = window.setInterval(() => { void refreshTyping(); }, 3000);
    return () => {
      window.clearInterval(timer);
      realtime?.send("module:chat:typing", { conversationId: activeId, typing: false });
    };
  }, [activeId, composing, isTyping, realtime]);

  async function mutate(path: string, method: string, body?: object) {
    const send = (token: string) => fetch(path, {
      method,
      headers: { "x-department-id": departmentId, "x-csrf-token": token, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let response = await send(csrfToken);
    let result = await response.json() as { error?: string; id?: string };
    if (response.status === 403 && result.error?.includes("session token")) {
      const freshToken = await refreshCsrfToken?.();
      if (freshToken) {
        response = await send(freshToken);
        result = await response.json() as { error?: string; id?: string };
      }
    }
    if (!response.ok) throw new Error(result.error ?? "The request failed.");
    return result;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage();
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !activeConversation || sending) return;
    setSending(true); setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/messages`, "POST", { body });
      setDraft("");
      const response = await fetch(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/messages`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as { messages: ChatMessage[] };
      if (response.ok) setMessages(result.messages);
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the message."); }
    finally { setSending(false); }
  }

  async function remove(message: ChatMessage) {
    if (!activeConversation) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/messages/${encodeURIComponent(message.id)}`, "DELETE");
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the message."); }
  }

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.length) return;
    setError("");
    try {
      const result = await mutate("/api/modules/chat/conversations", "POST", { userIds: selectedIds, ...(selectedIds.length > 1 && groupName.trim() ? { name: groupName.trim() } : {}) });
      await loadOverview(true);
      setActiveId(result.id ?? "");
      setComposing(false); setManagingConversation(false); setSelectedIds([]); setSearch(""); setGroupName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the conversation."); }
  }

  async function deleteConversation(conversation: Conversation) {
    const title = conversationTitle(conversation, currentUserId);
    if (!window.confirm(translateModuleText(`Delete “${title}” and all its messages for everyone in this chat?`, translationsForModule("chat"), language))) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(conversation.id)}`, "DELETE");
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (activeId === conversation.id) {
        setActiveId(remaining[0]?.id ?? "");
        setMessages([]);
        setManagingConversation(false);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the chat."); }
  }

  function toggleContact(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function beginManagingConversation(conversation: Conversation) {
    setConversationEditName(conversation.name ?? "");
    setConversationEditSuffix(conversation.titleSuffix ?? readChatSuffix(currentUserId, conversation.id));
    setSelectedMemberIds([]);
    setSearch("");
    setManagingConversation(true);
  }

  async function saveConversationEdits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConversation) return;
    setSavingConversation(true);
    setError("");
    try {
      if (activeConversation.kind === "group") {
        await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}`, "PATCH", { name: conversationEditName });
      } else {
        const suffix = conversationEditSuffix.trim();
        await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}`, "PATCH", { titleSuffix: suffix });
        try { window.localStorage.removeItem(chatSuffixStorageKey(currentUserId, activeConversation.id)); } catch { /* The shared server name is saved; an old local fallback can be ignored. */ }
      }
      await loadOverview(true);
      setManagingConversation(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this chat."); }
    finally { setSavingConversation(false); }
  }

  async function addGroupMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConversation || activeConversation.kind !== "group" || !selectedMemberIds.length) return;
    setSavingConversation(true);
    setError("");
    try {
      for (const userId of selectedMemberIds) {
        await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/members`, "POST", { userId });
      }
      setSelectedMemberIds([]);
      await loadOverview(true);
    } catch (reason) {
      await loadOverview(true);
      setError(reason instanceof Error ? reason.message : "Could not add group members.");
    } finally { setSavingConversation(false); }
  }

  async function removeGroupMember(person: Participant) {
    if (!activeConversation || activeConversation.kind !== "group") return;
    if (!window.confirm(translateModuleText(`Remove ${person.displayName} from this group chat?`, translationsForModule("chat"), language))) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/members/${encodeURIComponent(person.id)}`, "DELETE");
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this group member."); }
  }

  async function changeGroupMemberRole(person: Participant) {
    if (!activeConversation || activeConversation.kind !== "group") return;
    const role = person.role === "admin" ? "member" : "admin";
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/members/${encodeURIComponent(person.id)}`, "PATCH", { role });
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this group member."); }
  }

  const filteredContacts = contacts.filter((contact) => contact.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const activeRole = activeConversation?.participants.find((person) => person.id === currentUserId)?.role;
  const canManageActiveGroup = activeConversation?.kind === "group" && (activeRole === "owner" || activeRole === "admin");
  const isGroupCreator = activeConversation?.kind === "group" && activeConversation.createdBy === currentUserId;

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || `Chat for ${department.location} · ${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}`}</div>
    <section className="page-heading chat-page-heading">
      <div><div className="eyebrow">YOUR COMMUNITY</div><h1>Chat</h1><p className="page-subtitle">Private conversations for {department.location}.</p></div>
    </section>

    {error && <p className="chat-feedback" role="alert"><CircleAlert size={14} />{error}</p>}
    <section className="directory-card chat-layout" aria-label="Chat">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-heading"><div><h2>Messages</h2><p>Direct messages and group chats.</p></div><button className="button button-primary chat-new-button" type="button" onClick={() => { setComposing(true); setActiveId(""); setManagingConversation(false); setSelectedIds([]); setGroupName(""); }}><Plus size={14} />New chat</button></div>
        {loading ? <p className="chat-empty" role="status">Loading conversations…</p> : conversations.length === 0 && !composing ? <div className="chat-sidebar-empty"><MessageCircle size={18} /><span>Your conversations will appear here.</span></div> : <div className="chat-conversation-list">
          {conversations.map((conversation) => {
            const title = conversationTitle(conversation, currentUserId);
            const others = conversation.participants.filter((person) => person.id !== currentUserId);
            const groupPresence = others.some((person) => presenceStatus(person) === "online") ? "online" : others.some((person) => presenceStatus(person) === "away") ? "away" : "offline";
            return <div className="chat-conversation-row" key={conversation.id}>
              <button className={`chat-conversation${conversation.id === activeId && !composing ? " chat-conversation-active" : ""}`} type="button" onClick={() => { setActiveId(conversation.id); setComposing(false); setManagingConversation(false); }}>
                <span className={`chat-avatar${conversation.kind === "group" ? " chat-avatar-group" : ""}`}>{conversation.kind === "group" ? <Users size={16} /> : title.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                <span className="chat-conversation-copy"><span className="chat-conversation-title">{presenceDot(groupPresence)}{title}</span><span className="chat-conversation-preview">{conversation.lastMessage ?? (conversation.kind === "group" ? `${conversation.participants.length} participants` : "Start a conversation")}</span></span>
                {conversation.unreadCount > 0 && <span className="chat-unread-count" aria-label={`${conversation.unreadCount} unread ${conversation.unreadCount === 1 ? "message" : "messages"}`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>}
              </button>
              <button className="chat-conversation-delete" type="button" aria-label={`Delete chat with ${title}`} title="Delete chat for everyone" onClick={() => void deleteConversation(conversation)}><Trash2 size={14} /></button>
            </div>;
          })}
        </div>}
        <div className="chat-online-note" aria-label="Presence key"><span>No dot: offline</span><span>{presenceDot("online")} Online</span><span>{presenceDot("away")} Unfocused, no notifications</span></div>
      </aside>

      <div className="chat-main">
        {composing ? <section className="chat-new-panel">
          <div className="chat-thread-heading"><div><h2>New chat</h2><p>Choose one person for a direct message or multiple people for a group.</p></div><button className="chat-close-button" type="button" onClick={() => { setComposing(false); setSelectedIds([]); setGroupName(""); }} aria-label="Close new conversation"><X size={17} /></button></div>
          <form className="chat-create-form" onSubmit={createConversation}>
            <label className="chat-contact-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" aria-label="Find a person" /></label>
            {selectedIds.length > 1 && <label className="chat-group-name">Group name <span className="optional-label">Optional</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={80} placeholder="e.g. Sunday volunteers" /></label>}
            <div className="chat-contact-list">
              {filteredContacts.length === 0 ? <p className="chat-empty">No matching people.</p> : filteredContacts.map((contact) => <label className="chat-contact-option" key={contact.id}>
                <input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} />
                <span className="chat-contact-avatar">{contact.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                <span>{contact.displayName}{contact.isAdmin && <small>Server Administrator</small>}</span>
                <small>{presenceStatus(contact) === "offline" ? "Offline" : <>{presenceDot(presenceStatus(contact))}{presenceStatus(contact) === "away" ? "Away" : "Online"}</>}</small>
              </label>)}
            </div>
            <div className="chat-create-footer"><span>{selectedIds.length ? `${selectedIds.length} ${selectedIds.length === 1 ? "person" : "people"} selected` : "Select one or more people"}</span><button className="button button-primary" type="submit" disabled={!selectedIds.length}><MessageCircle size={14} />{selectedIds.length > 1 ? "Create group" : "Start chat"}</button></div>
          </form>
        </section> : activeConversation ? <>
          <div className="chat-thread-heading">
            <span className="chat-avatar">{conversationTitle(activeConversation, currentUserId).split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
            <div className="chat-thread-title"><h2>{conversationTitle(activeConversation, currentUserId)}</h2><p>{activeConversation.kind === "group" ? `${activeConversation.participants.length} participants · Group chat` : (() => { const other = activeConversation.participants.find((person) => person.id !== currentUserId); const status = other ? presenceStatus(other) : "offline"; return status === "offline" ? "Direct message" : status === "away" ? "Away" : "Online"; })()}</p></div>
            {(activeConversation.kind === "direct" || canManageActiveGroup) && <button className="chat-close-button" type="button" onClick={() => managingConversation ? setManagingConversation(false) : beginManagingConversation(activeConversation)} aria-label={managingConversation ? "Close chat settings" : "Edit chat settings"} title={managingConversation ? "Close chat settings" : "Edit chat settings"}><Pencil size={15} /></button>}
          </div>
          {managingConversation ? <section className="chat-management-panel">
            {activeConversation.kind === "direct" ? <>
              <div><h3>Shared chat name</h3><p>Both participants will see this suffix after the other person’s name.</p></div>
              <form className="chat-management-form" onSubmit={saveConversationEdits}>
                <label>Shared suffix <span className="optional-label">Optional</span><input value={conversationEditSuffix} onChange={(event) => setConversationEditSuffix(event.target.value)} maxLength={60} placeholder="e.g. Choir" /></label>
                <p className="chat-name-preview">Preview: {activeConversation.participants.find((person) => person.id !== currentUserId)?.displayName ?? "Direct message"}{conversationEditSuffix.trim() ? ` · ${conversationEditSuffix.trim()}` : ""}</p>
                <div className="chat-management-actions"><button className="button button-secondary" type="button" onClick={() => setManagingConversation(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={savingConversation}>{savingConversation ? "Saving…" : "Save name"}</button></div>
              </form>
            </> : <>
              <div><h3>Group chat settings</h3><p>Admins can rename the group and manage its members. Only the creator can change admin roles.</p></div>
              <form className="chat-management-form" onSubmit={saveConversationEdits}>
                <label>Group name <span className="optional-label">Optional</span><input value={conversationEditName} onChange={(event) => setConversationEditName(event.target.value)} maxLength={80} placeholder="e.g. Sunday volunteers" /></label>
                <div className="chat-management-actions"><button className="button button-secondary" type="button" onClick={() => setManagingConversation(false)}>Close</button><button className="button button-primary" type="submit" disabled={savingConversation}>{savingConversation ? "Saving…" : "Save name"}</button></div>
              </form>
              <div className="chat-managed-members"><h4>Members ({activeConversation.participants.length})</h4>
                {activeConversation.participants.map((person) => <div className="chat-managed-member" key={person.id}>
                  <span className="chat-managed-member-name">{person.displayName}{person.id === currentUserId && <small>You</small>}</span>
                  <span className="chat-managed-member-role">{person.id === activeConversation.createdBy ? "Creator · Admin" : person.role === "admin" ? "Admin" : "Member"}</span>
                  {isGroupCreator && person.id !== activeConversation.createdBy && <button className="chat-member-action" type="button" onClick={() => void changeGroupMemberRole(person)} title={person.role === "admin" ? "Remove admin role" : "Make admin"}><Shield size={14} />{person.role === "admin" ? "Demote" : "Make admin"}</button>}
                  {canManageActiveGroup && person.id !== activeConversation.createdBy && (isGroupCreator || person.role !== "admin") && <button className="chat-member-action chat-member-remove" type="button" onClick={() => void removeGroupMember(person)} title="Remove from group"><Trash2 size={14} />Remove</button>}
                </div>)}
              </div>
              <form className="chat-management-form chat-add-members" onSubmit={addGroupMembers}>
                <h4><UserPlus size={15} />Add people</h4>
                <label className="chat-contact-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person" aria-label="Find a person to add" /></label>
                <div className="chat-contact-list">
                  {filteredContacts.filter((contact) => !activeConversation.participants.some((person) => person.id === contact.id)).length === 0 ? <p className="chat-empty">No more matching people.</p> : filteredContacts.filter((contact) => !activeConversation.participants.some((person) => person.id === contact.id)).map((contact) => <label className="chat-contact-option" key={contact.id}>
                    <input type="checkbox" checked={selectedMemberIds.includes(contact.id)} onChange={() => setSelectedMemberIds((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} />
                    <span className="chat-contact-avatar">{contact.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span>{contact.displayName}</span>
                  </label>)}
                </div>
                <div className="chat-management-actions"><span>{selectedMemberIds.length ? `${selectedMemberIds.length} selected` : "Select people to add"}</span><button className="button button-primary" type="submit" disabled={!selectedMemberIds.length || savingConversation}>{savingConversation ? "Adding…" : "Add to group"}</button></div>
              </form>
            </>}
          </section> : <>
          {typingUsers.length > 0 && <p className="chat-typing-indicator" role="status">{typingUsers[0]} is typing…</p>}
          <div className="chat-message-list">
            {messagesLoading ? <p className="chat-empty" role="status">Loading messages…</p> : messages.length === 0 ? <div className="chat-empty-state"><span><MessageCircle size={20} /></span><strong>Start the conversation</strong><p>Send a private message to {conversationTitle(activeConversation, currentUserId)}.</p></div> : messages.map((message) => {
              const own = message.userId === currentUserId;
              return <article className={`chat-message${own ? " chat-message-own" : ""}`} key={message.id}>
                <div className="chat-message-meta"><strong>{own ? "You" : message.author}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>
                <p>{message.body}</p>
                {own && message.seenBy.length > 0 && <small className="chat-seen-receipt">Seen by {message.seenBy.join(", ")}</small>}
                {(own || canModerate) && <button type="button" className="chat-delete" onClick={() => void remove(message)} aria-label={`Delete message from ${message.author}`} title={canModerate && !own ? "Moderate message" : "Delete your message"}><Trash2 size={13} /></button>}
              </article>;
            })}
          </div>
          <form className="chat-compose" onSubmit={send}>
            <label className="chat-compose-label" htmlFor="chat-message">Message</label>
            <textarea id="chat-message" value={draft} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.altKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} maxLength={2000} rows={2} placeholder="Write a message… (Enter to send, Alt+Enter for a new line)" aria-describedby="chat-character-count" />
            <div className="chat-compose-footer"><span id="chat-character-count">{draft.length}/2000</span><button className="button button-primary" type="submit" disabled={sending || !draft.trim()}><Send size={14} />{sending ? "Sending…" : "Send"}</button></div>
          </form>
          </>}
        </> : <div className="chat-select-empty"><span><MessageCircle size={23} /></span><strong>Select a conversation</strong><p>Choose a conversation or start a new chat with one or more people.</p><button className="button button-primary" type="button" onClick={() => { setComposing(true); setManagingConversation(false); setSelectedIds([]); }}><Plus size={14} />New chat</button></div>}
      </div>
    </section>
      <footer className="page-footer"><span>Conversations are private to their participants in {department.location}.</span><span>Direct chat suffixes sync between both participants; group settings are managed by admins.</span></footer>
  </>;
}
