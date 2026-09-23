import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client-session", () => ({
  clientToken: vi.fn(async () => "session-token"),
}));

vi.mock("@/lib/product", () => ({
  expiredLinkResponse: vi.fn(() => Response.json({ error: "Sign in again." }, { status: 401 })),
  forwardProductError: vi.fn(() => Response.json({ error: "Backend unavailable." }, { status: 502 })),
  startLinkedInOAuth: vi.fn(async () => ({
    authorization_url: "https://www.linkedin.com/oauth/v2/authorization?state=opaque",
    expires_at: "2026-09-23T12:10:00Z",
  })),
  completeLinkedInOAuth: vi.fn(async () => ({ id: "account-id" })),
  listSocialAccounts: vi.fn(async () => [{ id: "account-id", provider: "linkedin" }]),
  listSocialProviders: vi.fn(async () => [{ provider: "linkedin", publishing_enabled: false }]),
  listSocialPublications: vi.fn(async () => []),
  publishContentItemNow: vi.fn(async () => ({ id: "publication-id", status: "queued" })),
  setSocialAutoPublish: vi.fn(async () => ({ id: "account-id", auto_publish_enabled: false })),
  readJsonObject: vi.fn(async (request: Request) => request.json()),
}));

import { clientToken } from "@/lib/client-session";
import {
  completeLinkedInOAuth,
  listSocialAccounts,
  listSocialProviders,
  listSocialPublications,
  publishContentItemNow,
  setSocialAutoPublish,
  startLinkedInOAuth,
} from "@/lib/product";
import { GET as callback } from "@/app/api/client/social/linkedin/callback/route";
import { POST as start } from "@/app/api/client/social/linkedin/start/route";
import { GET as accounts } from "@/app/api/client/social/accounts/route";
import { GET as providers } from "@/app/api/client/social/providers/route";
import { GET as publications } from "@/app/api/client/social/publications/route";
import { POST as publish } from "@/app/api/client/content-items/[id]/publish/route";
import { PATCH as changeAuto } from "@/app/api/client/social/accounts/[accountId]/auto-publish/route";

const CALLBACK = "https://app.example.test/api/client/social/linkedin/callback";
const STATE = "opaque-state-at-least-twenty-characters";

describe("LinkedIn OAuth BFF", () => {
  beforeEach(() => {
    vi.mocked(clientToken).mockReset().mockResolvedValue("session-token");
    vi.mocked(startLinkedInOAuth).mockClear();
    vi.mocked(completeLinkedInOAuth).mockReset().mockResolvedValue({ id: "account-id" } as never);
    vi.mocked(listSocialAccounts).mockClear();
    vi.mocked(listSocialProviders).mockClear();
    vi.mocked(listSocialPublications).mockClear();
    vi.mocked(publishContentItemNow).mockClear();
    vi.mocked(setSocialAutoPublish).mockClear();
  });

  it("starts OAuth with the server session and no browser-supplied scope or redirect", async () => {
    const response = await start(new Request("https://app.example.test/api/client/social/linkedin/start", {
      method: "POST",
      headers: { Origin: "https://app.example.test" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(startLinkedInOAuth).toHaveBeenCalledWith("session-token");
  });

  it("refuses a cross-origin start before touching the session or backend", async () => {
    const response = await start(new Request("https://app.example.test/api/client/social/linkedin/start", {
      method: "POST",
      headers: { Origin: "https://other.example.test" },
    }));
    expect(response.status).toBe(403);
    expect(clientToken).not.toHaveBeenCalled();
    expect(startLinkedInOAuth).not.toHaveBeenCalled();
  });

  it("passes the code and state to the authenticated backend then strips both from the browser URL", async () => {
    const response = await callback(new Request(`${CALLBACK}?code=short-lived-code&state=${STATE}`));
    expect(completeLinkedInOAuth).toHaveBeenCalledWith("session-token", "short-lived-code", STATE);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/refined/home?linkedin=connected");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not exchange an invalid response, a denial, or a response without the starting session", async () => {
    const invalid = await callback(new Request(`${CALLBACK}?code=c&state=short`));
    const denied = await callback(new Request(`${CALLBACK}?error=access_denied&state=${STATE}`));
    vi.mocked(clientToken).mockResolvedValue(null);
    const expired = await callback(new Request(`${CALLBACK}?code=c&state=${STATE}`));
    expect(invalid.headers.get("location")).toContain("linkedin=invalid-response");
    expect(denied.headers.get("location")).toContain("linkedin=denied");
    expect(expired.headers.get("location")).toContain("linkedin=session-expired");
    expect(completeLinkedInOAuth).not.toHaveBeenCalled();
  });

  it("hides backend failures and does not leak code or state in the redirect", async () => {
    vi.mocked(completeLinkedInOAuth).mockRejectedValue(new Error("provider secret or raw code"));
    const response = await callback(new Request(`${CALLBACK}?code=short-lived-code&state=${STATE}`));
    expect(response.headers.get("location")).toBe("https://app.example.test/refined/home?linkedin=failed");
  });

  it("lists only accounts returned for the server-side product session", async () => {
    const response = await accounts();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(listSocialAccounts).toHaveBeenCalledWith("session-token");
  });

  it("exposes provider gate and delivery status through the same session", async () => {
    expect((await providers()).status).toBe(200);
    expect((await publications()).status).toBe(200);
    expect(listSocialProviders).toHaveBeenCalledWith("session-token");
    expect(listSocialPublications).toHaveBeenCalledWith("session-token");
  });

  it("queues publish-now for an exact content item and caller-supplied idempotency key", async () => {
    const id = "e927cf12-1699-4690-8775-7c4761c88449";
    const response = await publish(new Request(`https://app.example.test/api/client/content-items/${id}/publish`, {
      method: "POST",
      headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: "click-12345678" }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(202);
    expect(publishContentItemNow).toHaveBeenCalledWith("session-token", id, "click-12345678");
  });

  it("rejects forged origin and extra publish fields before backend dispatch", async () => {
    const id = "e927cf12-1699-4690-8775-7c4761c88449";
    const endpoint = `https://app.example.test/api/client/content-items/${id}/publish`;
    const forged = await publish(new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://other.example.test" },
    }), { params: Promise.resolve({ id }) });
    const extra = await publish(new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: "click-12345678", client_id: "foreign" }),
    }), { params: Promise.resolve({ id }) });
    expect(forged.status).toBe(403);
    expect(extra.status).toBe(422);
    expect(publishContentItemNow).not.toHaveBeenCalled();
  });

  it("changes auto-publish only for a same-origin authenticated boolean request", async () => {
    const endpoint = "https://app.example.test/api/client/social/accounts/account-id/auto-publish";
    const context = { params: Promise.resolve({ accountId: "account-id" }) };
    const forged = await changeAuto(new Request(endpoint, {
      method: "PATCH", headers: { Origin: "https://other.example.test" }, body: JSON.stringify({ enabled: false }),
    }), context);
    const extra = await changeAuto(new Request(endpoint, {
      method: "PATCH", body: JSON.stringify({ enabled: false, client_id: "foreign" }),
    }), context);
    expect(forged.status).toBe(403);
    expect(extra.status).toBe(400);
    expect(setSocialAutoPublish).not.toHaveBeenCalled();
    const accepted = await changeAuto(new Request(endpoint, {
      method: "PATCH", headers: { Origin: "https://app.example.test" }, body: JSON.stringify({ enabled: false }),
    }), context);
    expect(accepted.status).toBe(200);
    expect(setSocialAutoPublish).toHaveBeenCalledWith("session-token", "account-id", false);
  });
});
