import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CircleAlert, LogOut, MessageCircle, Plus, Search, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./chat.css";
import "./chat-groups.css";

type Contact = { id: string; displayName: string; online: boolean };
type Participant = Contact & { role: "owner" | "member" };
type Conversation = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  participants: Participant[];
  lastMessage: string | null;
  unreadCount: number;
  updatedAt: string;
};
type ChatMessage = { id: string; userId: string; author: string; body: string; createdAt: string; seenBy: string[] };
type ConversationsResponse = { conversations: Conversation[]; currentUserId: string; canModerate: boolean };

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function conversationTitle(conversation: Conversation, currentUserId: string) {
  if (conversation.kind === "group" && conversation.name) return conversation.name;
  const others = conversation.participants.filter((person) => person.id !== currentUserId).map((person) => person.displayName);
  return conversation.kind === "direct" ? others[0] ?? "Direct message" : others.join(", ") || "Group chat";
}

export function ChatModule({ department, departmentId, csrfToken }: ModuleContext) {
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
  const [manageGroup, setManageGroup] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");

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
      setConversations(conversationResult.conversations);
      setContacts(contactsResult.contacts);
      setCurrentUserId(conversationResult.currentUserId);
      setCanModerate(conversationResult.canModerate);
      setActiveId((current) => current || conversationResult.conversations[0]?.id || "");
      setError("");
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Could not load chat.");
    } finally { setLoading(false); }
  }, [departmentId]);

  const sendPresence = useCallback(async () => {
    try {
      await fetch("/api/modules/chat/presence", {
        method: "POST",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken },
      });
    } catch { /* Presence is best effort; message access does not depend on it. */ }
  }, [csrfToken, departmentId]);

  useEffect(() => {
    void loadOverview();
    void sendPresence();
    const overviewTimer = window.setInterval(() => { void loadOverview(true); }, 15_000);
    const presenceTimer = window.setInterval(() => { void sendPresence(); }, 20_000);
    return () => { window.clearInterval(overviewTimer); window.clearInterval(presenceTimer); };
  }, [loadOverview, sendPresence]);

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
    const timer = window.setInterval(() => { void loadMessages(true); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeId, departmentId]);

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
    const timer = window.setInterval(() => { void loadTyping(); }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeId, departmentId]);

  useEffect(() => {
    if (!activeId || !isTyping || composing || manageGroup) return;
    const path = `/api/modules/chat/conversations/${encodeURIComponent(activeId)}/typing`;
    const refreshTyping = () => fetch(path, {
      method: "POST",
      headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken },
    }).catch(() => undefined);
    void refreshTyping();
    const timer = window.setInterval(() => { void refreshTyping(); }, 3000);
    return () => {
      window.clearInterval(timer);
      void fetch(path, {
        method: "DELETE",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken },
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [activeId, composing, csrfToken, departmentId, isTyping, manageGroup]);

  async function mutate(path: string, method: string, body?: object) {
    const response = await fetch(path, {
      method,
      headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as { error?: string; id?: string };
    if (!response.ok) throw new Error(result.error ?? "The request failed.");
    return result;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  function toggleContact(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIds.length) return;
    setError("");
    try {
      const result = await mutate("/api/modules/chat/conversations", "POST", { userIds: selectedIds, ...(selectedIds.length > 1 && groupName.trim() ? { name: groupName.trim() } : {}) });
      await loadOverview(true);
      setActiveId(result.id ?? "");
      setComposing(false); setManageGroup(false); setSelectedIds([]); setGroupName(""); setSearch("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the conversation."); }
  }

  function openGroupManagement() {
    if (!activeConversation || activeConversation.kind !== "group") return;
    setGroupName(activeConversation.name ?? ""); setSelectedIds([]); setSearch(""); setManageGroup(true);
  }

  async function renameGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConversation || !groupName.trim()) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}`, "PATCH", { name: groupName.trim() });
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename the group."); }
  }

  async function addGroupMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeConversation || !selectedIds.length) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/members`, "POST", { userIds: selectedIds });
      setSelectedIds([]);
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add group members."); }
  }

  async function removeGroupMember(userId: string) {
    if (!activeConversation) return;
    setError("");
    try {
      await mutate(`/api/modules/chat/conversations/${encodeURIComponent(activeConversation.id)}/members/${encodeURIComponent(userId)}`, "DELETE");
      if (userId === currentUserId) { setManageGroup(false); setActiveId(""); }
      await loadOverview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update group members."); }
  }

  const filteredContacts = contacts.filter((contact) => contact.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const activeMember = activeConversation?.participants.find((person) => person.id === currentUserId);
  const canManageGroup = activeConversation?.kind === "group" && (canModerate || activeMember?.role === "owner");
  const availableGroupContacts = filteredContacts.filter((contact) => !activeConversation?.participants.some((person) => person.id === contact.id));

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || `Chat for ${department.location} · ${conversations.length} ${conversations.length === 1 ? "conversation" : "conversations"}`}</div>
    <section className="page-heading chat-page-heading">
      <div><div className="eyebrow">YOUR COMMUNITY</div><h1>Chat</h1><p className="page-subtitle">Private conversations and group chats for {department.location}.</p></div>
    </section>

    {error && <p className="chat-feedback" role="alert"><CircleAlert size={14} />{error}</p>}
    <section className="directory-card chat-layout" aria-label="Chat">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-heading"><div><h2>Messages</h2><p>Only conversation members can read messages.</p></div><button className="button button-primary chat-new-button" type="button" onClick={() => { setComposing(true); setManageGroup(false); setActiveId(""); }}><Plus size={14} />New chat</button></div>
        {loading ? <p className="chat-empty" role="status">Loading conversations…</p> : conversations.length === 0 && !composing ? <div className="chat-sidebar-empty"><MessageCircle size={18} /><span>Your conversations will appear here.</span></div> : <div className="chat-conversation-list">
          {conversations.map((conversation) => {
            const title = conversationTitle(conversation, currentUserId);
            const otherParticipants = conversation.participants.filter((person) => person.id !== currentUserId);
            const online = conversation.kind === "direct" && otherParticipants.some((person) => person.online);
            return <button className={`chat-conversation${conversation.id === activeId && !composing ? " chat-conversation-active" : ""}`} type="button" key={conversation.id} onClick={() => { setActiveId(conversation.id); setComposing(false); setManageGroup(false); }}>
              <span className={`chat-avatar${conversation.kind === "group" ? " chat-avatar-group" : ""}`}>{conversation.kind === "group" ? <Users size={16} /> : title.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
              <span className="chat-conversation-copy"><span className="chat-conversation-title">{online && <i className="chat-online-dot" title="Online in Chat" />}{title}</span><span className="chat-conversation-preview">{conversation.lastMessage ?? (conversation.kind === "group" ? `${conversation.participants.length} members` : "Start a conversation")}</span></span>
              {conversation.unreadCount > 0 && <span className="chat-unread-count" aria-label={`${conversation.unreadCount} unread ${conversation.unreadCount === 1 ? "message" : "messages"}`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>}
              {conversation.kind === "group" && <span className="chat-member-count">{conversation.participants.length}</span>}
            </button>;
          })}
        </div>}
        <div className="chat-online-note"><span className="chat-online-dot" />Online means active in Chat.</div>
      </aside>

      <div className="chat-main">
        {composing ? <section className="chat-new-panel">
          <div className="chat-thread-heading"><div><h2>New conversation</h2><p>Choose one person for a direct message, or several for a group.</p></div><button className="chat-close-button" type="button" onClick={() => setComposing(false)} aria-label="Close new conversation"><X size={17} /></button></div>
          <form className="chat-create-form" onSubmit={createConversation}>
            <label className="chat-contact-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a location member" aria-label="Find a location member" /></label>
            {selectedIds.length > 1 && <label className="chat-group-name">Group name <input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={80} placeholder="e.g. Sunday volunteers" /></label>}
            <div className="chat-contact-list">
              {filteredContacts.length === 0 ? <p className="chat-empty">No matching members.</p> : filteredContacts.map((contact) => <label className="chat-contact-option" key={contact.id}>
                <input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} />
                <span className="chat-contact-avatar">{contact.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
                <span>{contact.displayName}</span>
                <small>{contact.online ? <><i className="chat-online-dot" />Online</> : "Offline"}</small>
              </label>)}
            </div>
            <div className="chat-create-footer"><span>{selectedIds.length ? `${selectedIds.length} selected` : "Select at least one person"}</span><button className="button button-primary" type="submit" disabled={!selectedIds.length}><MessageCircle size={14} />{selectedIds.length > 1 ? "Create group" : "Start chat"}</button></div>
          </form>
        </section> : activeConversation ? <>
          <div className="chat-thread-heading">
            <span className={`chat-avatar${activeConversation.kind === "group" ? " chat-avatar-group" : ""}`}>{activeConversation.kind === "group" ? <Users size={16} /> : conversationTitle(activeConversation, currentUserId).split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
            <div className="chat-thread-title"><h2>{conversationTitle(activeConversation, currentUserId)}</h2><p>{activeConversation.kind === "group" ? `${activeConversation.participants.length} members · ` : ""}{activeConversation.participants.filter((person) => person.id !== currentUserId && person.online).map((person) => person.displayName).join(", ") || "Conversation"}</p></div>
            {activeConversation.kind === "group" && <button className="button button-secondary chat-group-details-button" type="button" onClick={() => manageGroup ? setManageGroup(false) : openGroupManagement()}>{manageGroup ? "Back to chat" : "Group details"}</button>}
          </div>
          {typingUsers.length > 0 && <p className="chat-typing-indicator" role="status">{typingUsers.length === 1 ? `${typingUsers[0]} is typing…` : `${typingUsers.slice(0, 2).join(", ")}${typingUsers.length > 2 ? ` and ${typingUsers.length - 2} others` : ""} are typing…`}</p>}
          {manageGroup && activeConversation.kind === "group" ? <section className="chat-group-manage">
            <div className="chat-group-section-heading"><div><h3>Group members</h3><p>Only members of this group can read its messages.</p></div><span>{activeConversation.participants.length}/50</span></div>
            {canManageGroup && <form className="chat-rename-form" onSubmit={renameGroup}><label htmlFor="chat-group-rename">Group name</label><div><input id="chat-group-rename" value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={80} placeholder="Name this group" /><button className="button button-secondary" type="submit" disabled={!groupName.trim() || groupName.trim() === activeConversation.name}>Save name</button></div></form>}
            <div className="chat-group-members">{activeConversation.participants.map((person) => <div className="chat-group-member" key={person.id}>
              <span className="chat-contact-avatar">{person.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span className="chat-group-member-name">{person.displayName}{person.id === currentUserId ? " (you)" : ""}{person.online && <small><i className="chat-online-dot" />Online</small>}</span>{person.role === "owner" && <span className="chat-owner-label">Owner</span>}
              {canManageGroup && person.id !== currentUserId && <button className="chat-remove-member" type="button" onClick={() => void removeGroupMember(person.id)}>Remove</button>}
            </div>)}</div>
            {canManageGroup && activeConversation.participants.length < 50 && <form className="chat-add-members" onSubmit={addGroupMembers}><div className="chat-group-section-heading"><div><h3>Add people</h3><p>Choose existing members of {department.location}.</p></div><UserPlus size={16} /></div>
              <label className="chat-contact-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a location member" aria-label="Find a location member to add" /></label>
              <div className="chat-contact-list chat-add-contact-list">{availableGroupContacts.length === 0 ? <p className="chat-empty">No more matching members.</p> : availableGroupContacts.map((contact) => <label className="chat-contact-option" key={contact.id}>
                <input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleContact(contact.id)} /><span className="chat-contact-avatar">{contact.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span>{contact.displayName}</span><small>{contact.online ? <><i className="chat-online-dot" />Online</> : "Offline"}</small>
              </label>)}</div>
              <div className="chat-create-footer"><span>{selectedIds.length ? `${selectedIds.length} selected` : "Select people to add"}</span><button className="button button-primary" type="submit" disabled={!selectedIds.length}><UserPlus size={14} />Add members</button></div>
            </form>}
            <div className="chat-leave-group-row"><p>{canManageGroup ? "As owner, leaving transfers ownership to the next member." : "You can leave this group at any time."}</p><button className="button button-secondary" type="button" onClick={() => void removeGroupMember(currentUserId)}><LogOut size={14} />Leave group</button></div>
          </section> : <>
          <div className="chat-message-list">
            {messagesLoading ? <p className="chat-empty" role="status">Loading messages…</p> : messages.length === 0 ? <div className="chat-empty-state"><span><MessageCircle size={20} /></span><strong>Start the conversation</strong><p>Send a private message to {conversationTitle(activeConversation, currentUserId)}.</p></div> : messages.map((message) => {
              const own = message.userId === currentUserId;
              return <article className={`chat-message${own ? " chat-message-own" : ""}`} key={message.id}>
                {!own && <div className="chat-message-meta"><strong>{message.author}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>}
                {own && <div className="chat-message-meta"><strong>You</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>}
                <p>{message.body}</p>
                {own && message.seenBy.length > 0 && <small className="chat-seen-receipt">Seen by {message.seenBy.join(", ")}</small>}
                {(own || canModerate) && <button type="button" className="chat-delete" onClick={() => void remove(message)} aria-label={`Delete message from ${message.author}`} title={canModerate && !own ? "Moderate message" : "Delete your message"}><Trash2 size={13} /></button>}
              </article>;
            })}
          </div>
          <form className="chat-compose" onSubmit={send}>
            <label className="chat-compose-label" htmlFor="chat-message">Message</label>
            <textarea id="chat-message" value={draft} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={2} placeholder="Write a message…" aria-describedby="chat-character-count" />
            <div className="chat-compose-footer"><span id="chat-character-count">{draft.length}/2000</span><button className="button button-primary" type="submit" disabled={sending || !draft.trim()}><Send size={14} />{sending ? "Sending…" : "Send"}</button></div>
          </form>
          </>}
        </> : <div className="chat-select-empty"><span><MessageCircle size={23} /></span><strong>Select a conversation</strong><p>Choose a message on the left or start a new chat.</p><button className="button button-primary" type="button" onClick={() => { setComposing(true); setManageGroup(false); }}><Plus size={14} />New chat</button></div>}
      </div>
    </section>
    <footer className="page-footer"><span>Conversations are private to their members in {department.location}.</span><span>Messages refresh automatically; read receipts update as members open the chat.</span></footer>
  </>;
}
