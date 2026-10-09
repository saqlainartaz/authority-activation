import { describe, expect, it } from "vitest";

import exchange from "@/agent/contracts/read-exchange.json";
import readSchema from "@/agent/contracts/read-schema.json";
import {
  coverageSchema,
  modelReadRequestSchema,
  modelReadResultSchema,
  readFailureSchema,
  wirePayloadSchema,
} from "@/agent/contracts/read";

/**
 * The cross-language check: both languages must accept the same fixture bytes.
 *
 * `read-exchange.json` is byte-identical to the copy under
 * `tests/fixtures/ke_c4/crosslang/` in the backend, where pydantic validates it
 * in `test_ke_retrieval_contracts.py`. If the two mirrors drift, one of them
 * rejects this file and the divergence surfaces here rather than on a real turn
 * against a real client.
 *
 * `read-schema.json` is generated from the pydantic models, so the second half
 * of this file checks the zod mirror against Python's own declaration of the
 * shape rather than against a hand-written list.
 */

describe("the model-facing read contract", () => {
  it("accepts the same request bytes Python accepts", () => {
    for (const key of [
      "request",
      "request_exact",
      "request_orient",
      "request_inspect",
    ] as const) {
      const parsed = modelReadRequestSchema.safeParse(exchange[key]);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(
        true,
      );
    }
  });

  it("accepts the same result bytes Python accepts", () => {
    const parsed = modelReadResultSchema.safeParse(exchange.result);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("rejects an unknown key rather than carrying it through", () => {
    // Closed objects are the rule on both sides. An unknown key reaching the
    // runtime as an unvalidated field is how a raw record escapes projection.
    const withExtra = {
      ...exchange.request,
      scope: { ...exchange.request.scope, tenant_id: "leaked" },
    };
    expect(modelReadRequestSchema.safeParse(withExtra).success).toBe(false);
  });

  it("has no read_view field for the model to supply", () => {
    // The server injects the active view. A model that could name a view could
    // name someone else's.
    const withView = { ...exchange.request, read_view: "V9" };
    expect(modelReadRequestSchema.safeParse(withView).success).toBe(false);
  });

  it("rejects a selector kind the contract does not declare", () => {
    const browse = { ...exchange.request, selector: { kind: "browse" } };
    expect(modelReadRequestSchema.safeParse(browse).success).toBe(false);
  });

  it("rejects an inspect selector with no refs", () => {
    const empty = {
      ...exchange.request,
      selector: { kind: "inspect", refs: [], expand_context: false },
    };
    expect(modelReadRequestSchema.safeParse(empty).success).toBe(false);
  });
});

describe("the completeness invariants hold in TypeScript too", () => {
  // The same three rules pydantic enforces. Encoded here as well because the
  // agent reads a tool result before Python ever sees it again: a result that
  // claimed exhaustive coverage while paging would mislead the model even
  // though the server would later reject it.
  const base = {
    extent: "selected" as const,
    truncated: false,
    processing: "ready" as const,
    retrieval: "ok" as const,
    index_pending: false,
  };

  it("permits exhaustive coverage that is genuinely exhaustive", () => {
    expect(coverageSchema.safeParse({ ...base, extent: "exhaustive" }).success).toBe(
      true,
    );
  });

  it("rejects exhaustive coverage that is truncated", () => {
    expect(
      coverageSchema.safeParse({ ...base, extent: "exhaustive", truncated: true })
        .success,
    ).toBe(false);
  });

  it("rejects exhaustive coverage while retrieval is degraded", () => {
    expect(
      coverageSchema.safeParse({
        ...base,
        extent: "exhaustive",
        retrieval: "degraded",
      }).success,
    ).toBe(false);
  });

  it("rejects an exhaustive result that still has a next page", () => {
    const result = {
      ...exchange.result,
      coverage: { ...base, extent: "exhaustive" },
      next_cursor: "page-2",
    };
    expect(modelReadResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects two items sharing a handle", () => {
    const [first] = exchange.result.items;
    const result = { ...exchange.result, items: [first, first] };
    expect(modelReadResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("the mirror matches the schema generated from Python", () => {
  it("declares the same request fields Python declares", () => {
    const declared = Object.keys(readSchema.ModelReadRequest.properties).sort();
    expect(declared).toEqual(["cursor", "scope", "selector"]);

    const parsed = modelReadRequestSchema.parse(exchange.request);
    expect(Object.keys(parsed).sort()).toEqual(declared);
  });

  it("declares the same result fields Python declares", () => {
    const declared = Object.keys(readSchema.ModelReadResult.properties).sort();
    const parsed = modelReadResultSchema.parse(exchange.result);
    // `gaps` has a default on both sides, so it is present after parsing even
    // when the producer omitted it.
    expect(Object.keys(parsed).sort()).toEqual(declared);
  });

  it("pins the tool schema version Python pins", () => {
    expect(readSchema.ModelReadResult.properties.schema.const).toBe("c4-tool-1");
  });
});

describe("no model-facing field leaks a server identity", () => {
  // The projection rule, asserted against the actual fixture rather than
  // against the prose: client ids, actor ids, release ids, storage locators and
  // digests are omitted, not relabelled.
  const FORBIDDEN = [
    "client_id",
    "release_id",
    "evidence_id",
    "context_id",
    "roster_person_id",
    "actor_id",
    "document_id",
    "artifact_id",
    "original_sha256",
    "dependency_digest",
    "storage_path",
  ];

  it("carries none of the forbidden identifiers anywhere in a result", () => {
    const blob = JSON.stringify(exchange.result);
    for (const field of FORBIDDEN) {
      expect(blob, `${field} reached the model-facing result`).not.toContain(field);
    }
  });

  it("keeps a privileged speaker as a handle or as nothing", () => {
    const evidence = exchange.result.items.find(
      (item) => item.payload.kind === "evidence",
    );
    expect(evidence).toBeDefined();
    const parsed = wirePayloadSchema.parse(evidence!.payload);
    if (parsed.kind !== "evidence") throw new Error("expected an evidence payload");
    // Either a handle or null. Never a roster uuid.
    expect(parsed.speaker_handle === null || parsed.speaker_handle.length > 0).toBe(
      true,
    );
  });

  it("accepts every declared failure code and nothing else", () => {
    for (const code of [
      "unavailable",
      "access_denied",
      "invalid_request",
      "unsupported_version",
      "stale_cursor",
      "dependency_changed",
      "budget_exhausted",
    ]) {
      const failure = {
        schema: "c4-read-1",
        code,
        retryable: false,
        correlation_id: "5b1f9a2c-0000-4000-8000-000000000001",
      };
      expect(readFailureSchema.safeParse(failure).success, code).toBe(true);
    }

    expect(
      readFailureSchema.safeParse({
        schema: "c4-read-1",
        code: "fact_absent",
        retryable: false,
        correlation_id: "5b1f9a2c-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});
