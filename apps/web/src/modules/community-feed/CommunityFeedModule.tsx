import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Heart, MessageCircle, Newspaper, Send, Trash2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { translateModuleText } from "../../module-registry";
import { formatUserDate } from "../../date-format";
import { translationsForModule } from "../translations";
import "./community-feed.css";

type FeedComment = { id: string; body: string; authorId: string; authorName: string; createdAt: string };
type FeedPost = {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  comments: FeedComment[];
};

function formatPostDate(value: string) {
  return formatUserDate(value, true);
}

export function CommunityFeedModule({ departmentId, csrfToken, language }: ModuleContext) {
  const t = (message: string) => translateModuleText(message, translationsForModule("community-feed"), language);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const response = await fetch("/api/modules/community-feed/posts", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as FeedPost[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? t("Could not load community posts.") : t("Could not load community posts."));
      setPosts(result);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? t(reason.message) : t("Could not load the community feed."));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [departmentId, language]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function sendMutation(path: string, method: string, payload?: object) {
    const response = await fetch(path, {
      method,
      headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ? t(result.error) : t("The request could not be completed."));
  }

  async function publish(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSaving(true); setError(""); setFeedback("");
    try {
      await sendMutation("/api/modules/community-feed/posts", "POST", { title: title.trim(), body: body.trim() });
      setTitle(""); setBody("");
      setFeedback(t("Your post was published."));
      await load();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not publish the post.")); }
    finally { setSaving(false); }
  }

  async function toggleLike(post: FeedPost) {
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/likes`, post.likedByMe ? "DELETE" : "POST");
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, likedByMe: !item.likedByMe, likeCount: Math.max(0, item.likeCount + (item.likedByMe ? -1 : 1)) } : item));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not update your reaction.")); }
  }

  async function comment(post: FeedPost, formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const commentBody = (commentDrafts[post.id] ?? "").trim();
    if (!commentBody) return;
    try {
      await sendMutation(`/api/modules/community-feed/posts/${post.id}/comments`, "POST", { body: commentBody });
      setCommentDrafts((current) => ({ ...current, [post.id]: "" }));
      await load();
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

  return <main className="community-feed-page">
    <header className="page-heading"><div><div className="eyebrow">{t("CHURCH LIFE")}</div><h1>{t("Community")}</h1><p className="page-subtitle">{t("Share news, encouragement, and updates with your church.")}</p></div></header>
    <form className="community-post-composer" onSubmit={(event) => void publish(event)}>
      <div className="community-feed-card-heading"><span className="community-feed-icon"><Newspaper size={18} /></span><div><strong>{t("Share an update")}</strong><small>{t("Your post will be visible to signed-in members of this location.")}</small></div></div>
      <input aria-label={t("Post title")} maxLength={120} placeholder={t("Title (optional)")} value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea aria-label={t("Post text")} maxLength={4000} required rows={4} placeholder={t("What would you like the church to know?")} value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="community-post-composer-footer"><small>{body.length}/4000</small><button className="button button-primary" type="submit" disabled={saving || !body.trim()}><Send size={15} />{saving ? t("Publishing…") : t("Publish")}</button></div>
    </form>
    {error && <p className="community-feed-error" role="alert">{error}</p>}
    {feedback && <p className="community-feed-feedback" role="status">{feedback}</p>}
    <section className="community-post-list" aria-label={t("Community posts")}>
      {loading ? <p className="community-feed-empty">{t("Loading posts…")}</p> : posts.length ? posts.map((post) => <article className="community-post-card" key={post.id}>
        <header className="community-post-header"><span className="community-post-avatar">{post.authorName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div className="community-post-author"><strong>{post.authorName}</strong><time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time></div>{post.canDelete && <button className="community-post-delete" type="button" aria-label={t("Delete post")} title={t("Delete post")} onClick={() => void deletePost(post)}><Trash2 size={16} /></button>}</header>
        {post.title && <h2>{post.title}</h2>}<p className="community-post-body">{post.body}</p>
        <div className="community-post-actions"><button type="button" className={post.likedByMe ? "community-post-like is-liked" : "community-post-like"} onClick={() => void toggleLike(post)} aria-pressed={post.likedByMe}><Heart size={16} fill={post.likedByMe ? "currentColor" : "none"} />{post.likeCount} {t(post.likeCount === 1 ? "like" : "likes")}</button><span><MessageCircle size={16} />{post.comments.length} {t(post.comments.length === 1 ? "comment" : "comments")}</span></div>
        {post.comments.length > 0 && <div className="community-post-comments">{post.comments.map((item) => <div className="community-post-comment" key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p><time dateTime={item.createdAt}>{formatPostDate(item.createdAt)}</time></div>)}</div>}
        <form className="community-comment-form" onSubmit={(event) => void comment(post, event)}><input aria-label={t("Write a comment…")} maxLength={1000} placeholder={t("Write a comment…")} value={commentDrafts[post.id] ?? ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} /><button type="submit" className="community-comment-submit" disabled={!(commentDrafts[post.id] ?? "").trim()} aria-label={t("Post comment")}><Send size={16} /></button></form>
      </article>) : <p className="community-feed-empty">{t("There are no posts yet. Share the first update with your church.")}</p>}
    </section>
  </main>;
}
