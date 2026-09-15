import { describe, expect, it } from "vitest";

import {
  bodyPreview,
  contentPreviewCacheKey,
  isLibraryTableReady,
  latestContentVersion,
  libraryPage,
  libraryPageCount,
  moduleForAssetKind,
  newestContentFirst,
} from "@/lib/library-view";
import type { ClientContentItem, ContentVersionEntry } from "@/lib/product";

const item = (id: string, createdAt: string): ClientContentItem => ({
  content_item_id: id,
  campaign_id: null,
  asset_kind: "linkedin_post",
  state: "draft",
  state_changed_at: createdAt,
  latest_version_id: null,
  latest_version_no: null,
  manually_edited: false,
  version_count: 0,
  created_at: createdAt,
});

const version = (id: string, versionNo: number, body = `Body ${versionNo}`): ContentVersionEntry => ({
  content_version_id: id,
  version_no: versionNo,
  body,
  body_sha256: `sha-${versionNo}`,
  manually_edited: false,
  state: "draft",
  created_at: `2026-08-${20 + versionNo}T09:00:00Z`,
  receipt: [],
  untrusted_fields: [],
  trust: "untrusted",
});

describe("Content Library view helpers", () => {
  it("orders posts newest-first without mutating the shared collection", () => {
    const original = [
      item("older", "2026-08-20T09:00:00Z"),
      item("newer", "2026-08-25T09:00:00Z"),
    ];

    expect(newestContentFirst(original).map((entry) => entry.content_item_id)).toEqual(["newer", "older"]);
    expect(original.map((entry) => entry.content_item_id)).toEqual(["older", "newer"]);
  });

  it("uses the item id as a deterministic tie-break for equal timestamps", () => {
    const tied = [item("b", "2026-08-25T09:00:00Z"), item("a", "2026-08-25T09:00:00Z")];
    expect(newestContentFirst(tied).map((entry) => entry.content_item_id)).toEqual(["a", "b"]);
  });

  it("slices pages and clamps an out-of-range page", () => {
    const values = Array.from({ length: 53 }, (_, index) => index + 1);

    expect(libraryPageCount(values.length, 25)).toBe(3);
    expect(libraryPage(values, 2, 25)).toEqual(values.slice(25, 50));
    expect(libraryPage(values, 99, 25)).toEqual(values.slice(50));
    expect(libraryPageCount(0, 25)).toBe(1);
  });

  it("maps only verified asset kinds to a module and platform", () => {
    expect(moduleForAssetKind("linkedin_post")).toEqual({
      moduleLabel: "Social post",
      platform: "linkedin",
      platformLabel: "LinkedIn",
    });
    expect(moduleForAssetKind("newsletter_issue")).toEqual({
      moduleLabel: "Newsletter Issue",
      platform: null,
      platformLabel: null,
    });
  });

  it("builds a readable post excerpt from the real body", () => {
    expect(bodyPreview("  First line\n\nSecond   line  ", 80)).toBe("First line Second line");
    expect(bodyPreview("A useful preview should stop cleanly before the rest of the post", 32))
      .toBe("A useful preview should stop…");
  });

  it("honours the declared latest version before falling back to the highest version number", () => {
    const contentItem = {
      ...item("post", "2026-08-25T09:00:00Z"),
      latest_version_id: "v2",
      latest_version_no: 2,
      version_count: 3,
    };
    const versions = [version("v3", 3), version("v1", 1), version("v2", 2)];

    expect(latestContentVersion(contentItem, versions)?.content_version_id).toBe("v2");
    expect(latestContentVersion({ ...contentItem, latest_version_id: null, latest_version_no: null }, versions)?.content_version_id)
      .toBe("v3");
  });

  it("changes the preview cache key when the latest version changes", () => {
    const original = item("post", "2026-08-25T09:00:00Z");
    const revised = { ...original, latest_version_id: "v2", latest_version_no: 2, version_count: 2 };
    expect(contentPreviewCacheKey(revised)).not.toBe(contentPreviewCacheKey(original));
  });

  it("shows the table only after scheduling and every visible preview settle", () => {
    const items = [
      item("first", "2026-08-25T09:00:00Z"),
      item("second", "2026-08-24T09:00:00Z"),
    ];
    const loading = new Map([
      ["first", { kind: "ready" as const }],
      ["second", { kind: "loading" as const }],
    ]);
    const settled = new Map([
      ["first", { kind: "ready" as const }],
      ["second", { kind: "failed" as const }],
    ]);

    expect(isLibraryTableReady(items, false, settled)).toBe(false);
    expect(isLibraryTableReady(items, true, loading)).toBe(false);
    expect(isLibraryTableReady(items, true, settled)).toBe(true);
    expect(isLibraryTableReady(items, true, new Map([["first", { kind: "ready" as const }]]))).toBe(false);
  });
});
