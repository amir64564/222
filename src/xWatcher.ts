import { logger } from "./utils/logger";
import { config } from "./config";
import { getLastPostId, setLastPostId } from "./database";

export interface XPost { id: string; text: string; createdAt: string; }
export interface IXWatcher { onNewPost(handler: (post: XPost) => Promise<void>): void; start(): Promise<void>; stop(): void; }
type PostHandler = (post: XPost) => Promise<void>;

const WEB_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_BY_SCREEN_NAME_QID = "2qvSHpkWTMS9i0zJAwDNiA";
const USER_TWEETS_QID = "hr4gzZONlq23okjU8fIe_A";
const FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_twitter_article_data_v2_enabled: true,
};

export class ApiXWatcher implements IXWatcher {
  private handler: PostHandler | null = null; private timer: NodeJS.Timeout | null = null; private stopped = false; private running = false;
  onNewPost(handler: PostHandler) { this.handler = handler; }
  private async request(path: string, params: URLSearchParams): Promise<any> {
    const res = await fetch(`https://api.x.com/2/${path}?${params}`, { headers: { Authorization: `Bearer ${config.xBearerToken}` } });
    if (!res.ok) throw new Error(`X API ${res.status}: ${await res.text()}`);
    return res.json();
  }
  private async poll(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const params = new URLSearchParams({
        query: `from:${config.xUsername} -is:retweet`, max_results: "10", "tweet.fields": "created_at,author_id",
      });
      const sinceId = getLastPostId(); if (sinceId) params.set("since_id", sinceId);
      const data = await this.request("tweets/search/recent", params);
      const posts = [...(data.data || [])].sort((a: any, b: any) => BigInt(a.id) > BigInt(b.id) ? 1 : -1);
      for (const tweet of posts) {
        const post: XPost = { id: tweet.id, text: tweet.text, createdAt: tweet.created_at || new Date().toISOString() };
        if (this.handler) await this.handler(post);
        setLastPostId(post.id);
      }
    } catch (e) { logger.error("X API polling failed", { error: (e as Error).message }); }
    finally { this.running = false; }
  }
  async start(): Promise<void> {
    const loop = async () => { if (this.stopped) return; await this.poll(); this.timer = setTimeout(loop, config.xPollIntervalMs); };
    await loop();
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}

export class CookieXWatcher implements IXWatcher {
  private handler: PostHandler | null = null; private timer: NodeJS.Timeout | null = null; private stopped = false; private running = false; private userId: string | null = null;
  onNewPost(handler: PostHandler) { this.handler = handler; }
  private headers(): HeadersInit { return {
    authorization: WEB_BEARER, "x-csrf-token": config.xCt0, "x-twitter-active-user": "yes", "x-twitter-client-language": "en",
    cookie: `auth_token=${config.xAuthToken}; ct0=${config.xCt0}`, "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  }; }
  private async gql(queryId: string, operation: string, variables: Record<string, unknown>): Promise<any> {
    const url = new URL(`https://x.com/i/api/graphql/${queryId}/${operation}`);
    url.searchParams.set("variables", JSON.stringify(variables)); url.searchParams.set("features", JSON.stringify(FEATURES));
    url.searchParams.set("fieldToggles", JSON.stringify({ withArticlePlainText: false }));
    const res = await fetch(url, { headers: this.headers() }); if (!res.ok) throw new Error(`X GraphQL ${res.status}: ${await res.text()}`); return res.json();
  }
  private async resolveUserId(): Promise<string> {
    const data = await this.gql(USER_BY_SCREEN_NAME_QID, "UserByScreenName", { screen_name: config.xUsername, withSafetyModeUserFields: true });
    const id = data?.data?.user?.result?.rest_id || data?.data?.user?.result?.legacy?.id_str;
    if (!id) throw new Error("Could not resolve X user id in cookie mode"); return id;
  }
  private extractTweets(data: any): XPost[] {
    const out: XPost[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      const r = node?.content?.itemContent?.tweet_results?.result;
      if (r) {
        const legacy = r.legacy || {};
        const id = r.rest_id || legacy.id_str;
        const text = legacy.full_text || r.note_tweet?.note_tweet_results?.result?.text;
        if (id && typeof text === "string") out.push({ id, text, createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : new Date().toISOString() });
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(data);
    const uniq = new Map<string, XPost>(); for (const p of out) uniq.set(p.id, p); return [...uniq.values()].sort((a,b)=>BigInt(a.id)>BigInt(b.id)?1:-1);
  }
  private async poll(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      if (!this.userId) this.userId = await this.resolveUserId();
      const data = await this.gql(USER_TWEETS_QID, "UserTweets", { userId: this.userId, count: 20, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: false, withVoice: false });
      const sinceId = getLastPostId();
      for (const post of this.extractTweets(data)) {
        if (sinceId && BigInt(post.id) <= BigInt(sinceId)) continue;
        if (this.handler) await this.handler(post);
        setLastPostId(post.id);
      }
    } catch (e) { logger.error("X cookie/GraphQL polling failed", { error: (e as Error).message }); }
    finally { this.running = false; }
  }
  async start(): Promise<void> {
    const loop = async () => { if (this.stopped) return; await this.poll(); this.timer = setTimeout(loop, config.xPollIntervalMs); };
    await loop();
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}

export function createXWatcher(): IXWatcher { return config.xWatcherMode === "api" ? new ApiXWatcher() : new CookieXWatcher(); }
