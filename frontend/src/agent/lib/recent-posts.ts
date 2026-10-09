import "server-only";

import { modelHistoryResultSchema, type ModelHistoryResult } from "@/agent/contracts/product-context";
import { listRecentContent } from "@/lib/product";
import { escapeForBody, type ModelMessage } from "@/agent/transcript";

/**
 * The short list of recent posts a new writing session carries (Cycle 5, P4.1;
 * spec 10A.6), so the agent avoids repeating what the client has just posted.
 *
 * TITLE, OBJECTIVE AND POSTED DATE, AND NOTHING ELSE. The history page carries
 * whole bodies too, and they stay out: the summary is a reminder of what was
 * written about, not a second copy of it. The agent can still read prior
 * writing in full through `list_recent_content` when it wants the voice.
 *
 * Bounded twice: each field is cut to a fixed length, and the whole block to
 * `RECENT_POSTS_MAX_CHARS`, dropping the oldest posts first.
 */

/** How many posts the summary lists. */
export const RECENT_POSTS_LIMIT = 5;
/** The whole block's ceiling, in characters, tags included. */
export const RECENT_POSTS_MAX_CHARS = 1_200;
export const RECENT_POST_TITLE_CHARS = 80;
export const RECENT_POST_OBJECTIVE_CHARS = 160;
/** History pages are versions, not posts, so a post edited twice takes several
 *  rows. A few pages find five posts without reading the whole library. */
const MAX_PAGES = 3;

export type RecentPost = { title?: string; objective?: string; posted?: string };

type HistoryItem = ModelHistoryResult["items"][number];

function bounded(value: string | null | undefined, limit: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * The latest posts, newest first, one entry per post. Versions of one post
 * share its title and objective and collapse into one entry, which keeps the
 * posted date if any of its versions was posted. A post with neither a title
 * nor an objective has nothing to list and is left out.
 */
export function projectRecentPosts(items: HistoryItem[]): RecentPost[] {
  const posts = new Map<string, RecentPost>();
  for (const item of items) {
    const title = bounded(item.title, RECENT_POST_TITLE_CHARS);
    const objective = bounded(item.objective, RECENT_POST_OBJECTIVE_CHARS);
    if (!title && !objective) continue;
    const key = JSON.stringify([title ?? null, objective ?? null]);
    const posted = item.published_at ? item.published_at.slice(0, 10) : undefined;
    const known = posts.get(key);
    if (known) {
      if (!known.posted && posted) known.posted = posted;
      continue;
    }
    if (posts.size === RECENT_POSTS_LIMIT) continue;
    posts.set(key, {
      ...(title ? { title } : {}),
      ...(objective ? { objective } : {}),
      ...(posted ? { posted } : {}),
    });
  }
  return [...posts.values()];
}

/** The `<recent-posts>` context message, or null when there is nothing to list. */
export function recentPostsMessage(posts: RecentPost[]): ModelMessage | null {
  for (let count = Math.min(posts.length, RECENT_POSTS_LIMIT); count > 0; count -= 1) {
    const content =
      `<recent-posts trust="client-authored-untrusted" citable="false">` +
      `${escapeForBody(JSON.stringify(posts.slice(0, count)))}</recent-posts>`;
    if (content.length <= RECENT_POSTS_MAX_CHARS) return { role: "user", content };
  }
  return null;
}

/** The client's latest posts, read through the session's own history route. */
export async function readRecentPosts(token: string, sessionId: string): Promise<RecentPost[]> {
  const items: HistoryItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // An empty query is plain recency: no task terms to select by yet.
    const result = modelHistoryResultSchema.parse(await listRecentContent(token, sessionId, { query: "", cursor }));
    items.push(...result.items);
    if (projectRecentPosts(items).length >= RECENT_POSTS_LIMIT || result.next_cursor === null) break;
    cursor = result.next_cursor;
  }
  return projectRecentPosts(items);
}

/**
 * Whether this turn carries the list: under the rehaul engine (`c4`) only,
 * and only on a session's first turn, when there is no earlier conversation.
 * The block is turn context and is never stored, so later turns do NOT see the
 * list again (P4 review M-2): a topic change after turn 1 gets no repeat
 * reminder. That is the plan's choice ("no block on later turns").
 */
export function carriesRecentPosts(contract: "context.v1" | "c4", earlierMessages: number): boolean {
  return contract === "c4" && earlierMessages === 0;
}

/**
 * The block for this turn, or null. NEVER THROWS: the list is a reminder, not
 * a precondition, so a failed read leaves it out and the turn goes ahead.
 */
export async function recentPostsContext(
  token: string,
  sessionId: string,
  contract: "context.v1" | "c4",
  earlierMessages: number,
): Promise<ModelMessage | null> {
  if (!carriesRecentPosts(contract, earlierMessages)) return null;
  try {
    return recentPostsMessage(await readRecentPosts(token, sessionId));
  } catch {
    return null;
  }
}
