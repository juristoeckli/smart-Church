import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatUserDate } from "./date-format";
import { translate } from "./i18n";

type HomePost = { id: string; title: string; publishedAt: string; groupName: string | null };

function postUrl(pathname: string, postId?: string) {
  const query = postId ? "?" + new URLSearchParams({ communityPost: postId }) : "";
  return pathname + query + "#module-community-feed";
}

export function HomeCurrentPosts({ departmentId }: { departmentId: string }) {
  const [snapshot, setSnapshot] = useState<{ departmentId: string; posts: HomePost[] }>();
  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    void fetch("/api/modules/community-feed/home-posts", {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { posts?: HomePost[] };
      if (!controller.signal.aborted && Array.isArray(result.posts)) setSnapshot({ departmentId, posts: result.posts });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [departmentId]);

  if (!snapshot || snapshot.departmentId !== departmentId || !snapshot.posts.length) return null;
  const pathname = window.location.pathname;
  return <section className="directory-card community-upcoming-card">
    <div className="directory-heading">
      <h2>{translate("overview.currentPosts")}</h2>
      <a className="button button-secondary" href={postUrl(pathname)}>Open Community <ArrowRight size={14} aria-hidden="true" /></a>
    </div>
    <ul className="community-upcoming-list">
      {snapshot.posts.map((post) => <li className="community-upcoming-item" key={post.id}>
        <span className="community-upcoming-date">{formatUserDate(post.publishedAt)}</span>
        <div><a href={postUrl(pathname, post.id)}>{post.title}</a>{post.groupName && <small>{post.groupName}</small>}</div>
      </li>)}
    </ul>
  </section>;
}
