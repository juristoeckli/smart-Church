import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const redirectUri = (configured?: string) => configured?.trim() || process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_REDIRECT_URI?.trim() || "";
const encryptionSecret = () => process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY?.trim() ?? "";

export async function ensureYoutubeTokenKey() {
  const environmentKey = encryptionSecret();
  if (environmentKey) return environmentKey;

  const keyPath = process.env.SMART_CHURCH_VIDEO_STEFFISBURG_TOKEN_KEY_FILE?.trim()
    || resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/video-steffisburg/youtube-token-key");
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    const storedKey = (await readFile(keyPath, "utf8")).trim();
    if (storedKey) {
      process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY = storedKey;
      return storedKey;
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const generatedKey = randomBytes(32).toString("hex");
  try {
    await writeFile(keyPath, `${generatedKey}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existingKey = (await readFile(keyPath, "utf8")).trim();
    if (!existingKey) throw new Error("The persisted YouTube token encryption key is empty.");
    process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY = existingKey;
    return existingKey;
  }
  process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY = generatedKey;
  return generatedKey;
}

export function youtubeOAuthConfigured(oauthClientId: string, oauthClientSecret: string, configuredRedirectUri?: string) {
  return Boolean(oauthClientId.trim() && oauthClientSecret.trim() && redirectUri(configuredRedirectUri) && encryptionSecret());
}

export function youtubeAuthorizationUrl(state: string, oauthClientId: string, configuredRedirectUri?: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: oauthClientId,
    redirect_uri: redirectUri(configuredRedirectUri),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return url.toString();
}

export async function exchangeYoutubeCode(code: string, oauthClientId: string, oauthClientSecret: string, configuredRedirectUri?: string) {
  const result = await tokenRequest({
    code,
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    redirect_uri: redirectUri(configuredRedirectUri),
    grant_type: "authorization_code",
  });
  if (!result.access_token) throw new Error("Google did not return an access token.");
  return result;
}

export function encryptYoutubeToken(token: string) {
  const key = tokenKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptYoutubeToken(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Stored YouTube credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export async function refreshYoutubeAccessToken(refreshToken: string, oauthClientId: string, oauthClientSecret: string) {
  const result = await tokenRequest({
    refresh_token: refreshToken,
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    grant_type: "refresh_token",
  });
  if (!result.access_token) throw new Error("Google did not return an access token.");
  return result.access_token;
}

export async function youtubeApi<T>(accessToken: string, path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const message = typeof (data.error as { message?: unknown } | undefined)?.message === "string"
      ? String((data.error as { message: string }).message).slice(0, 180)
      : `YouTube returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

export async function updateYoutubeBroadcast(accessToken: string, broadcastId: string, input: { title: string; description: string; scheduledStartTime: string; privacyStatus: "private" | "unlisted" | "public" }) {
  const path = `liveBroadcasts?part=snippet,status,contentDetails&id=${encodeURIComponent(broadcastId)}`;
  const result = await youtubeApi<{ items?: Array<{ id?: string; snippet?: Record<string, unknown>; status?: Record<string, unknown>; contentDetails?: Record<string, unknown> }> }>(accessToken, path);
  const current = result.items?.[0];
  if (!current?.id || !current.snippet || !current.status) throw new Error("The YouTube broadcast could not be loaded for editing.");
  const monitorStream = current.contentDetails?.monitorStream as Record<string, unknown> | undefined;
  const response = await youtubeApi<{ id?: string }>(
    accessToken,
    "liveBroadcasts?part=snippet,status,contentDetails",
    "PUT",
    {
      id: current.id,
      snippet: { ...current.snippet, title: input.title.slice(0, 100), description: input.description.slice(0, 5000), scheduledStartTime: input.scheduledStartTime },
      status: { ...current.status, privacyStatus: input.privacyStatus },
      contentDetails: {
        ...current.contentDetails,
        enableAutoStart: false,
        enableAutoStop: false,
        enableDvr: true,
        recordFromStart: true,
        monitorStream: {
          ...monitorStream,
          enableMonitorStream: monitorStream?.enableMonitorStream ?? true,
          broadcastStreamDelayMs: monitorStream?.broadcastStreamDelayMs ?? 0,
        },
      },
    },
  );
  if (!response.id) throw new Error("YouTube did not confirm the broadcast update.");
  return { id: response.id };
}

export async function createYoutubeBroadcast(accessToken: string, input: { title: string; description: string; scheduledStartTime: string; privacyStatus: "private" | "unlisted" | "public" }) {
  const resource = await youtubeApi<{ id?: string; snippet?: { title?: string; scheduledStartTime?: string }; status?: { lifeCycleStatus?: string } }>(
    accessToken,
    "liveBroadcasts?part=snippet,status,contentDetails",
    "POST",
    { snippet: { title: input.title.slice(0, 100), description: input.description.slice(0, 5000), scheduledStartTime: input.scheduledStartTime }, status: { privacyStatus: input.privacyStatus }, contentDetails: { enableAutoStart: false, enableAutoStop: false, enableDvr: true, recordFromStart: true } },
  );
  if (!resource.id) throw new Error("YouTube did not return a broadcast ID.");
  return { id: resource.id, status: resource.status?.lifeCycleStatus ?? "created" };
}

export async function transitionYoutubeBroadcast(accessToken: string, broadcastId: string, status: "testing" | "live" | "complete") {
  const query = new URLSearchParams({ broadcastStatus: status, id: broadcastId, part: "id,snippet,status" });
  const result = await youtubeApi<{ id?: string; status?: { lifeCycleStatus?: string } }>(accessToken, `liveBroadcasts/transition?${query}`, "POST");
  if (!result.id) throw new Error("YouTube did not confirm the broadcast transition.");
  return { id: result.id, status: result.status?.lifeCycleStatus ?? status };
}

export async function deleteYoutubeBroadcast(accessToken: string, broadcastId: string) {
  await youtubeApi<unknown>(accessToken, `liveBroadcasts?id=${encodeURIComponent(broadcastId)}`, "DELETE");
}

export async function setYoutubeVideoUnlisted(accessToken: string, videoId: string) {
  await youtubeApi<unknown>(accessToken, "videos?part=status", "PUT", {
    id: videoId,
    status: { privacyStatus: "unlisted" },
  });
}

export async function youtubePlaylists(accessToken: string) {
  const playlists: Array<{ id: string; title: string }> = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ part: "id,snippet", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    const result = await youtubeApi<{ items?: Array<{ id?: string; snippet?: { title?: string } }>; nextPageToken?: string }>(accessToken, `playlists?${query}`);
    for (const playlist of result.items ?? []) {
      if (playlist.id && playlist.snippet?.title) playlists.push({ id: playlist.id, title: playlist.snippet.title });
    }
    pageToken = result.nextPageToken ?? "";
  } while (pageToken && playlists.length < 1_000);
  return playlists;
}

export async function addYoutubeVideoToPlaylist(accessToken: string, playlistId: string, videoId: string) {
  const query = new URLSearchParams({ part: "contentDetails", playlistId, videoId, maxResults: "50" });
  const existing = await youtubeApi<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>(accessToken, `playlistItems?${query}`);
  if (existing.items?.some((item) => item.contentDetails?.videoId === videoId)) return;
  await youtubeApi<unknown>(accessToken, "playlistItems?part=snippet", "POST", {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  });
}

export async function youtubeChannel(accessToken: string) {
  const result = await youtubeApi<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>(accessToken, "channels?part=id,snippet&mine=true");
  const channel = result.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel is available for this Google account.");
  return { id: channel.id, title: channel.snippet?.title ?? "YouTube channel" };
}

async function tokenRequest(values: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!response.ok) throw new Error(result.error_description || result.error || `Google OAuth returned HTTP ${response.status}.`);
  return result;
}

function tokenKey() {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Configure SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY to store YouTube credentials securely.");
  return createHash("sha256").update(secret).digest();
}
