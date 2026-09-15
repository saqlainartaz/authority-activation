import type { ClientContentItem, ContentVersionEntry } from "@/lib/product";

export const LIBRARY_PAGE_SIZE = 25;

const timestamp = (value: string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

/** Newest means creation time; the id tie-break keeps equal timestamps stable. */
export function newestContentFirst(items: readonly ClientContentItem[]): ClientContentItem[] {
  return [...items].sort((left, right) => {
    const byCreatedAt = timestamp(right.created_at) - timestamp(left.created_at);
    return byCreatedAt || left.content_item_id.localeCompare(right.content_item_id);
  });
}

export function libraryPageCount(itemCount: number, pageSize = LIBRARY_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function libraryPage<T>(items: readonly T[], page: number, pageSize = LIBRARY_PAGE_SIZE): T[] {
  const safePage = Math.min(Math.max(1, page), libraryPageCount(items.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

type LibraryPreviewState = { kind: "loading" | "ready" | "failed" };

/**
 * The list swaps in atomically once scheduling and every visible post preview
 * have settled. A failed preview is settled and renders its existing fallback.
 */
export function isLibraryTableReady(
  items: readonly Pick<ClientContentItem, "content_item_id">[],
  scheduleReady: boolean,
  previews: ReadonlyMap<string, LibraryPreviewState>,
): boolean {
  return scheduleReady && items.every((item) => {
    const preview = previews.get(item.content_item_id);
    return preview?.kind === "ready" || preview?.kind === "failed";
  });
}

export function readableAssetKind(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export type LibraryModuleInfo = {
  moduleLabel: string;
  platform: string | null;
  platformLabel: string | null;
};

const ASSET_KIND_MODULES: Readonly<Record<string, LibraryModuleInfo>> = {
  linkedin_post: {
    moduleLabel: "Social post",
    platform: "linkedin",
    platformLabel: "LinkedIn",
  },
};

/** Only verified asset kinds receive a platform; unknown future kinds are never guessed. */
export function moduleForAssetKind(assetKind: string): LibraryModuleInfo {
  return ASSET_KIND_MODULES[assetKind] ?? {
    moduleLabel: readableAssetKind(assetKind) || "Other content",
    platform: null,
    platformLabel: null,
  };
}

/** A version-aware key prevents an edited post from reusing an older body preview. */
export function contentPreviewCacheKey(item: ClientContentItem): string {
  return [
    item.content_item_id,
    item.latest_version_id ?? "no-version-id",
    item.latest_version_no ?? "no-version-number",
    item.version_count,
  ].join(":");
}

/** Resolve the server-declared latest version before falling back to the highest version number. */
export function latestContentVersion(
  item: ClientContentItem,
  versions: readonly ContentVersionEntry[],
): ContentVersionEntry | null {
  if (item.latest_version_id) {
    const declared = versions.find((version) => version.content_version_id === item.latest_version_id);
    if (declared) return declared;
  }
  if (item.latest_version_no !== null) {
    const declared = versions.find((version) => version.version_no === item.latest_version_no);
    if (declared) return declared;
  }
  return versions.reduce<ContentVersionEntry | null>(
    (latest, version) => latest === null || version.version_no > latest.version_no ? version : latest,
    null,
  );
}

export function bodyPreview(body: string, maxLength = 180): string {
  const normalized = body.trim().replace(/\s+/g, " ");
  if (!normalized) return "";

  const characters = Array.from(normalized);
  if (characters.length <= maxLength) return normalized;

  const head = characters.slice(0, Math.max(1, maxLength)).join("");
  const lastSpace = head.lastIndexOf(" ");
  const cutAtWord = lastSpace >= Math.floor(maxLength * 0.6);
  return `${(cutAtWord ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

export function libraryDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
