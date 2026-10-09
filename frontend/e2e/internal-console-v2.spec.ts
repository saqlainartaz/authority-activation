import { expect, test, type Page } from "@playwright/test";

import type { OpsHealth } from "../src/lib/ops-health";
import { CLIENT_A, CLIENT_B, opsHealth, withUnavailable } from "../tests/client/ops-health-fixture";

const client = {
  id: "client-one", name: "Juniper Studio", timezone: "Europe/London",
  status: "active", created_at: "2026-09-15T09:00:00.000Z",
};
const people = [
  { id: "person-one", display_name: "Lee One", email: "lee@example.invalid", profession: null, status: "active", created_at: "2026-09-15T09:00:00.000Z" },
  { id: "person-two", display_name: "Ari Two", email: "ari@example.invalid", profession: null, status: "active", created_at: "2026-09-16T09:00:00.000Z" },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/internal/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/internal/clients") json = [client];
    else if (path === "/api/internal/voice-profile") json = null;
    else if (path.endsWith("/summary")) json = {
      atom_counts: {}, plays: [], selected_play_id: "", voice_profile: { latest_version: null, approved_version: null }, generated_at: "2026-09-15T09:00:00.000Z",
    };
    else if (path.endsWith("/users")) json = people;
    else if (path.endsWith("/onboarding-tokens") || path.endsWith("/documents") || path.endsWith("/atoms")) json = [];
    else if (path.endsWith("/held")) json = { client_id: client.id, held_count: 0, system_fault_count: 0, items: [], generated_at: "2026-09-15T09:00:00.000Z" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });
});

test("a person's access action issues a link for that person and shows its URL once", async ({ page }) => {
  let issuedTo: string | undefined;
  await page.route("**/api/internal/client-login-link", async (route) => {
    issuedTo = route.request().postDataJSON().userId;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://operator.example.invalid/refined/invite?token=one-time" }) });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "People" }).click();
  const accessAction = page.getByRole("listitem").filter({ hasText: "Ari Two" }).getByRole("button", { name: "Create access link" });
  await expect(accessAction).toBeVisible();
  await accessAction.click();
  await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible();
  await expect(page.getByLabel("Recipient")).toHaveValue("person-two");
  await page.getByRole("button", { name: "Generate link" }).click();
  await expect(page.getByText("https://operator.example.invalid/refined/invite?token=one-time")).toBeVisible();
  expect(issuedTo).toBe("person-two");
});

test("connected console opens on the client directory and keeps client navigation contextual", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await expect(page.locator(".idc-context")).toHaveCount(0);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-directory.png", fullPage: true });
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await expect(page.locator(".idc-context")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your side" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Client side" })).toBeVisible();
  await expect(page.getByText("Selected play", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-overview.png", fullPage: true });
  for (const name of ["Overview", "People", "Sources", "Knowledge", "Voice profile", "Access", "Held drafts"]) {
    await expect(page.locator(".idc-context").getByRole("button", { name, exact: true })).toBeVisible();
  }
  for (const [name, file] of [["People", "people"], ["Sources", "sources"], ["Knowledge", "knowledge"], ["Voice profile", "voice"], ["Access", "access"], ["Held drafts", "held"]]) {
    await page.locator(".idc-context").getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `../docs/integration/screenshots/internal-console-v2-${file}.png`, fullPage: true });
  }
  await page.locator(".idc-context").getByRole("button", { name: "All clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add client" }).click();
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-new-client.png", fullPage: true });
});

test("connected console keeps the directory and workspace within phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await expect(page.getByLabel("Client section")).toBeVisible();
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-phone.png", fullPage: true });
  const widths = await page.evaluate(() => ({ view: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBe(widths.view);
});

test("new client creates the client and first person through the connected routes", async ({ page }) => {
  const created = { ...client, id: "client-new", name: "Cedar Works" };
  let didCreateClient = false;
  let postedPerson: { display_name: string; email: string } | null = null;
  await page.route("**/api/internal/clients", async (route) => {
    if (route.request().method() === "POST") {
      didCreateClient = true;
      expect(route.request().postDataJSON()).toEqual({ name: "Cedar Works", timezone: "Europe/Warsaw" });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(didCreateClient ? [client, created] : [client]) });
    }
  });
  await page.route("**/api/internal/clients/client-new/users", async (route) => {
    if (route.request().method() === "POST") postedPerson = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().method() === "POST" ? { id: "new-person" } : []) });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Add client" }).click();
  await page.getByLabel("Client name").fill("Cedar Works");
  await page.getByLabel("Time zone").fill("Europe/Warsaw");
  await page.getByLabel("Name", { exact: true }).fill("Taylor Cedar");
  await page.getByLabel("Email").fill("taylor@example.invalid");
  await page.getByRole("button", { name: "Create client and person" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.locator(".idc-identity")).toContainText("Cedar Works");
  expect(postedPerson).toMatchObject({ display_name: "Taylor Cedar", email: "taylor@example.invalid" });
});

test("adding a source submits pasted material and opens its pipeline record", async ({ page }) => {
  let uploadedType: string | null = null;
  const document = { id: "source-one", source_type: "brand_doc", source_authority: "CONVERSATIONAL", status: "atomised" };
  await page.route("**/api/internal/clients/client-one/documents", async (route) => {
    if (route.request().method() === "POST") {
      uploadedType = route.request().postData()?.includes("brand_doc") ? "brand_doc" : null;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(document) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(uploadedType ? [document] : []) });
    }
  });
  await page.route("**/api/internal/clients/client-one/documents/source-one", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...document, pipeline_version: 1, created_at: "2026-09-15T09:00:00.000Z", atom_count: 2, pipeline_stages: [] }) });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "Sources" }).click();
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByLabel("Source type").selectOption("brand_doc");
  await page.getByLabel("Paste material").fill("Synthetic brand notes for testing.");
  await page.getByRole("button", { name: "Add source" }).last().click();
  await expect(page.getByText("2 active knowledge items extracted from this source.")).toBeVisible();
  expect(uploadedType).toBe("brand_doc");
});

test("held release requires review confirmation before calling the release route", async ({ page }) => {
  let released = false;
  const item = { content_item_id: "held-one", campaign_id: null, asset_kind: "post", content_version_id: "version-one", version_no: 1, held_at: "2026-09-15T09:00:00.000Z", rejection_kind: "claim", first_rejection_kind: null, rejection_detail: {}, hold_origin: "content", body: "Synthetic held draft for review.", trust: "untrusted" };
  await page.route("**/api/internal/clients/client-one/held", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ client_id: client.id, held_count: released ? 0 : 1, system_fault_count: 0, items: released ? [] : [item], generated_at: "2026-09-15T09:00:00.000Z" }) });
  });
  await page.route("**/api/internal/clients/client-one/held/held-one/release", async (route) => {
    released = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "Held drafts" }).click();
  await expect(page.locator(".idc-detail-content").getByText(item.body)).toBeVisible();
  await page.getByRole("button", { name: "Review release" }).click();
  expect(released).toBe(false);
  await page.getByRole("button", { name: "Release to client" }).click();
  await expect(page.getByText("No held drafts")).toBeVisible();
  expect(released).toBe(true);
});

test("People and Knowledge preserve create, review, and search actions", async ({ page }) => {
  const currentPeople = [...people];
  let atomStatus = "provisional";
  let searchedFor: string | null = null;
  await page.route("**/api/internal/clients/client-one/users", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      currentPeople.push({ id: "person-three", status: "active", created_at: "2026-09-15T09:00:00.000Z", ...body });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentPeople.at(-1)) });
    } else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentPeople) });
  });
  await page.route("**/api/internal/clients/client-one/atoms", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "atom-one", document_id: "source-one", atom_type: "insight", status: atomStatus, text: "Client values clear explanations.", evidence_kind: "explicit", provenance: { line: 12 } }]) });
  });
  await page.route("**/api/internal/clients/client-one/atoms/atom-one/decision", async (route) => {
    atomStatus = route.request().postDataJSON().decision === "confirm" ? "confirmed" : "deprecated";
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/internal/clients/client-one/search", async (route) => {
    searchedFor = route.request().postDataJSON().query;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "hit-one", atom_type: "insight", text: "Client values clear explanations.", status: atomStatus, trust: "untrusted", score: 1, source: { document_id: "source-one", source_type: "brand_doc", source_authority: "CONVERSATIONAL" } }]) });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "People" }).click();
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByLabel("Display name").fill("Sam Three");
  await page.getByLabel("Email").fill("sam@example.invalid");
  await page.getByRole("button", { name: "Add person" }).last().click();
  await expect(page.getByText("Sam Three")).toBeVisible();

  await page.locator(".idc-context").getByRole("button", { name: "Knowledge" }).click();
  await expect(page.locator(".idc-detail-content").getByText("Client values clear explanations.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("confirmed", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Search corpus" }).click();
  await page.getByLabel("Search material").fill("clear explanations");
  await page.getByRole("button", { name: "Search corpus" }).click();
  await expect(page.getByText("CONVERSATIONAL")).toBeVisible();
  expect(searchedFor).toBe("clear explanations");
});

test("issued links can be revoked but their original URL cannot be copied from history", async ({ page }) => {
  let revoked = false;
  await page.route("**/api/internal/clients/client-one/onboarding-tokens", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "token-one", user_id: "person-two", purpose: "invite", issued_at: "2026-09-15T09:00:00.000Z", last_used_at: null, revoked_at: revoked ? "2026-09-16T09:00:00.000Z" : null }]) });
  });
  await page.route("**/api/internal/clients/client-one/onboarding-tokens/token-one/revoke", async (route) => {
    revoked = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "Access" }).click();
  await expect(page.getByText("Ari Two", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  await page.getByRole("button", { name: "Revoke this link" }).click();
  expect(revoked).toBe(false);
  await page.getByRole("button", { name: "Revoke this link" }).last().click();
  await expect(page.getByText(/^Revoked /)).toBeVisible();
  expect(revoked).toBe(true);
});

// Cycle 5 P2.5: the operator Limits card. Rehaul engine only; synthetic values.
// (Temporary increases and the frozen "Send again" form were removed as
// over-engineered, 2026-10-08: staff change the limit with a plain edit.)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type StubState = { extra: number; revision: number; documentsDaily: number; writingDaily: number };

function limitsStub(state: StubState) {
  return {
    month: "2026-10-01", monthly_uploads: 20, extra_uploads: state.extra, uploads_used: 18,
    uploads_remaining: 20 + state.extra - 18,
    daily_limit_usd: state.documentsDaily, spent_today_usd: 3, revision: state.revision,
    writing_daily_limit_usd: state.writingDaily, writing_monthly_limit_usd: 50,
    resets: { daily: "2026-10-06T00:00:00Z", monthly: "2026-11-01T00:00:00Z" },
    meters: {
      documents_daily: { limit_usd: state.documentsDaily, spent_usd: 3, available: true, used_fraction: 0.2 },
      // The deployment's reply settings refuse writing (Ruling 33): no fraction, never shown as 0.
      writing_daily: { limit_usd: state.writingDaily, spent_usd: 4, available: false, used_fraction: null },
      writing_monthly: { limit_usd: 50, spent_usd: 50, available: false, used_fraction: 1 },
      deployment_daily: { limit_usd: 200, spent_usd: 40, available: true, used_fraction: 0.2 },
    },
    replayed: false, grant: null,
  };
}

const historyItem = (setting: string, reason: string) => ({
  setting, old_value: "15.0", new_value: "20.0", reason, changed_by: "operator:shared-passcode", created_at: "2026-10-04T09:30:00Z",
});

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function stubLimits(page: Page, options: {
  /** The first edit commits, but its answer never reaches the browser. */
  loseFirstPutAnswer?: boolean;
  /** Before the first extra uploads land, another operator saves Documents = 25 (revision 4). */
  otherOperatorEditsFirst?: boolean;
  /** The first extra uploads are answered 409 intent_key_reused (an earlier attempt landed). */
  firstExtraReused?: boolean;
} = {}) {
  const state: StubState = { extra: 10, revision: 3, documentsDaily: 15, writingDaily: 10 };
  const extraBodies: Array<Record<string, unknown>> = [];
  const putBodies: Array<Record<string, unknown>> = [];
  const keys = new Set<string>();
  const historyRequests: string[] = [];
  const counts = { limitsReads: 0 };
  let losePut = options.loseFirstPutAnswer ?? false;
  let reuseNext = options.firstExtraReused ?? false;
  await page.route("**/api/internal/engine", (route) => route.fulfill(json({ knowledge_engine: "ke" })));
  await page.route("**/api/internal/clients/client-one/limits", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      putBodies.push(body);
      if (body.expected_revision !== state.revision) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "stale_limits", detail: "stale_limits" }) });
        return;
      }
      if ("daily_limit_usd" in body) state.documentsDaily = Number(body.daily_limit_usd);
      if ("writing_daily_usd" in body) state.writingDaily = Number(body.writing_daily_usd);
      state.revision += 1;
      if (losePut) {
        losePut = false;
        await route.abort("failed"); // committed, but the answer never reaches the browser
        return;
      }
      await route.fulfill(json(limitsStub(state)));
      return;
    }
    counts.limitsReads += 1;
    await route.fulfill(json(limitsStub(state)));
  });
  await page.route("**/api/internal/clients/client-one/limits/extra-uploads", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    extraBodies.push(body);
    if (options.otherOperatorEditsFirst && state.revision === 3) {
      state.documentsDaily = 25;
      state.revision = 4;
    }
    if (reuseNext) {
      reuseNext = false;
      state.extra += 3; // the earlier attempt
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "intent_key_reused", detail: "intent_key_reused" }) });
      return;
    }
    const key = String(body.intent_key);
    // Idempotent by key, as the backend is: a replay records nothing new.
    const replayed = keys.has(key);
    if (!replayed) {
      keys.add(key);
      state.extra += Number(body.extra_uploads);
    }
    await route.fulfill(json({ ...limitsStub(state), replayed, grant: { id: "grant-one", created_at: "2026-10-05T10:00:00Z" } }));
  });
  await page.route("**/api/internal/clients/client-one/limits/changes**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url.search);
    const body = url.searchParams.get("before") === "cursor-page-two"
      ? { items: [historyItem("monthly_uploads", "Older synthetic change")], next: null }
      : { items: [historyItem("daily_limit_usd", "Newer synthetic change")], next: "cursor-page-two" };
    await route.fulfill(json(body));
  });
  return { state, extraBodies, putBodies, historyRequests, counts };
}

async function openLimits(page: Page) {
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.locator(".idc-context").getByRole("button", { name: "Limits", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Limits", exact: true })).toBeVisible();
}

test("Limits is absent when the deployment does not run the new engine", async ({ page }) => {
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await expect(page.locator(".idc-context").getByRole("button", { name: "Held drafts", exact: true })).toBeVisible();
  await expect(page.locator(".idc-context").getByRole("button", { name: "Limits", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Client section").locator("option", { hasText: "Limits" })).toHaveCount(0);
});

test("Limits shows the three budgets, saves a plain edit and extra uploads, and pages the history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await stubLimits(page);
  await openLimits(page);

  const budgets = page.getByRole("list", { name: "Budgets" });
  await expect(budgets.getByRole("listitem")).toHaveCount(3);
  const documents = budgets.locator('[data-meter="documents_daily"]');
  const writingToday = budgets.locator('[data-meter="writing_daily"]');
  const writingMonth = budgets.locator('[data-meter="writing_monthly"]');
  await expect(documents).toContainText("Documents (today)");
  await expect(documents).toContainText("Limit US$15.00 · Used US$3.00 (including reserved)");
  await expect(documents).toContainText("20% used");
  await expect(documents).not.toContainText("Limit reached");
  await expect(writingToday).toContainText("Writing (today)");
  await expect(writingToday).toContainText("Not available");
  await expect(writingToday).not.toContainText("0%");
  await expect(writingMonth).toContainText("Writing (this month)");
  await expect(writingMonth).toContainText("Limit reached");
  await expect(writingMonth).toContainText("Resets 1 Nov 2026, 00:00 UTC");
  await expect(page.getByLabel("Uploads this month")).toContainText("Remaining12");
  await expect(page.getByText("Temporary increase")).toHaveCount(0);

  const editForm = page.getByRole("form", { name: "Change limits" });
  await editForm.getByLabel("Documents daily budget (US$)").fill("20");
  await editForm.getByLabel("Reason").fill("Synthetic launch day");
  await editForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Limits saved.")).toBeVisible();
  await expect(documents).toContainText("Limit US$20.00");
  expect(stub.putBodies).toEqual([{ daily_limit_usd: 20, reason: "Synthetic launch day", expected_revision: 3 }]);

  const extraForm = page.getByRole("form", { name: "Give extra uploads" });
  await extraForm.getByLabel("Extra uploads").fill("5");
  await extraForm.getByLabel("Reason").fill("Synthetic pack");
  await extraForm.getByRole("button", { name: "Add extra uploads" }).click();
  await expect(page.getByText("5 extra uploads added for this month.")).toBeVisible();
  expect(stub.extraBodies[0]).toMatchObject({ extra_uploads: 5, reason: "Synthetic pack" });
  expect(String(stub.extraBodies[0].intent_key)).toMatch(UUID);
  expect(stub.extraBodies[0]).not.toHaveProperty("granted_by");

  const history = page.getByRole("list", { name: "Change history" });
  await expect(history).toContainText("Newer synthetic change");
  await expect(history).toContainText("Operator (shared access) · 4 Oct 2026, 09:30 UTC");
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(history).toContainText("Older synthetic change");
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect(stub.historyRequests.some((search) => new URLSearchParams(search).get("before") === "cursor-page-two")).toBe(true);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-limits.png", fullPage: true });
});

async function fillExtra(page: Page, amount: string, reason: string) {
  const extraForm = page.getByRole("form", { name: "Give extra uploads" });
  await extraForm.getByLabel("Extra uploads").fill(amount);
  await extraForm.getByLabel("Reason").fill(reason);
}

test("an edit whose answer is lost reads the values back and never freezes the form or offers Send again", async ({ page }) => {
  const stub = await stubLimits(page, { loseFirstPutAnswer: true });
  await openLimits(page);
  const editForm = page.getByRole("form", { name: "Change limits" });
  await editForm.getByLabel("Documents daily budget (US$)").fill("20");
  await editForm.getByLabel("Reason").fill("Synthetic edit");
  const readsBefore = stub.counts.limitsReads;
  await editForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("We did not hear back, so this may or may not have been saved.", { exact: false })).toBeVisible();
  expect(stub.counts.limitsReads).toBe(readsBefore + 1);
  await expect(page.getByRole("button", { name: "Send again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check what was saved" })).toHaveCount(0);
  await expect(editForm.getByLabel("Documents daily budget (US$)")).toBeEnabled();
  // The saved value was read back: the budget shows it, and saving again changes nothing.
  await expect(page.getByRole("list", { name: "Budgets" }).locator('[data-meter="documents_daily"]')).toContainText("Limit US$20.00");
  await editForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Nothing has changed. Edit a value before saving.")).toBeVisible();
  expect(stub.putBodies).toHaveLength(1);
  expect(stub.putBodies[0]).not.toHaveProperty("intent_key");
  expect(stub.state.revision).toBe(4);
});

test("a save made after another operator's change is refused as stale, even after extra uploads brought the newer revision back", async ({ page }) => {
  const stub = await stubLimits(page, { otherOperatorEditsFirst: true });
  await openLimits(page);
  const editForm = page.getByRole("form", { name: "Change limits" });
  await editForm.getByLabel("Writing daily budget (US$)").fill("12");
  await editForm.getByLabel("Reason").fill("Synthetic edit");
  // Extra uploads from this console come back with revision 4 (Documents = 25 by someone else).
  await fillExtra(page, "2", "Synthetic grant");
  await page.getByRole("button", { name: "Add extra uploads" }).click();
  await expect(page.getByText("2 extra uploads added for this month.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("These limits were changed by someone else. Review the current values and save again.")).toBeVisible();
  expect(stub.putBodies).toHaveLength(1);
  expect(stub.putBodies[0]).toMatchObject({ writing_daily_usd: 12, expected_revision: 3 });
  expect(stub.putBodies[0]).not.toHaveProperty("daily_limit_usd");
  expect(stub.state.documentsDaily).toBe(25);
  expect(stub.state.writingDaily).toBe(10);
  // After the stale refusal the form shows the other operator's value and keeps the typed one.
  await expect(editForm.getByLabel("Documents daily budget (US$)")).toHaveValue("25");
  await expect(editForm.getByLabel("Writing daily budget (US$)")).toHaveValue("12");
});

test("intent_key_reused reloads the limits and says the earlier attempt was saved", async ({ page }) => {
  const stub = await stubLimits(page, { firstExtraReused: true });
  await openLimits(page);
  await fillExtra(page, "5", "Synthetic grant");
  const readsBefore = stub.counts.limitsReads;
  await page.getByRole("button", { name: "Add extra uploads" }).click();
  await expect(page.getByText("Your earlier attempt was saved. Here are the current values.")).toBeVisible();
  expect(stub.counts.limitsReads).toBe(readsBefore + 1);
  await expect(page.getByLabel("Uploads this month")).toContainText("Extra this month13");
});

test("Limits fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubLimits(page);
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Open Juniper Studio" }).click();
  await page.getByLabel("Client section").selectOption("limits");
  await expect(page.getByRole("list", { name: "Budgets" }).getByRole("listitem")).toHaveCount(3);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-limits-phone.png", fullPage: true });
  const widths = await page.evaluate(() => ({ view: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBe(widths.view);
});

// Cycle 5 P3.3: System health (spec §10.1). Rehaul engine only; the BFF is stubbed
// with the synthetic reply the vitest suites use, its first client mapped onto the
// directory's "client-one" so the spend link opens the stubbed Limits card.
const asConsole = (health: OpsHealth): OpsHealth => JSON.parse(JSON.stringify(health).replaceAll(CLIENT_A, client.id));
const HEALTH_HEADINGS = ["Workers", "Documents added in the last 24 hours", "Waiting over one hour", "Needs a person", "Today's AI spend"];

// The stub answers with `state.answer` until a test changes it. Reads are not counted
// from the first: in development React mounts the page twice (StrictMode), so the
// first read may be made twice.
async function stubHealth(page: Page, first: OpsHealth | number, engine: "ke" | "m1" = "ke") {
  const state = { reads: 0, answer: first };
  await page.route("**/api/internal/clients", (route) => route.fulfill(json([client, { ...client, id: CLIENT_B, name: "Cedar Works" }])));
  await page.route("**/api/internal/engine", (route) => route.fulfill(json({ knowledge_engine: engine })));
  await page.route("**/api/internal/ops/health", async (route) => {
    state.reads += 1;
    const answer = state.answer;
    if (typeof answer === "number") {
      await route.fulfill({ status: answer, contentType: "application/json", body: JSON.stringify({ error: "Something broke on our side. Nothing was saved — try again." }) });
      return;
    }
    await route.fulfill(json(answer));
  });
  return state;
}

async function unlock(page: Page) {
  await page.goto("/internal");
  await page.getByLabel("Internal passcode").fill("synthetic-only");
  await page.getByRole("button", { name: "Open workspace" }).click();
}

async function expectFiveSections(page: Page) {
  for (const name of HEALTH_HEADINGS) await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

test("System health renders its five sections, refreshes by itself and on Refresh, and links spend to Limits", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date("2026-10-07T09:00:05Z") });
  await stubLimits(page);
  const later = (minute: string) => asConsole({ ...opsHealth(), observed_at: `2026-10-07T09:${minute}:00+00:00` });
  const stub = await stubHealth(page, asConsole(opsHealth()));
  await unlock(page);
  await page.getByRole("button", { name: "System health", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "System health" })).toBeVisible();
  await expect(page.getByText("Observed 7 Oct 2026, 09:00 UTC")).toBeVisible();
  await expectFiveSections(page);
  const spend = page.locator('[data-section="health-spend"]');
  await expect(spend).toContainText("UTC accounting day 7 Oct 2026 · resets 8 Oct 2026, 00:00 UTC · currency USD");
  await expect(spend).toContainText("Unknown costs: at least under US$0.01 (2 calls, reconciliation required)");
  await expect(page.locator('[data-section="health-workers"]')).toContainText("Replaced by a newer worker (2)");
  await expect(page.locator('[data-section="health-waiting"]')).toContainText("Progress unknown");
  // No restart, bulk or destructive action on the page: Refresh is its only button.
  await expect(page.locator(".idc-health").getByRole("button")).toHaveCount(1);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-health.png", fullPage: true });

  // Automatic: the next read is due 30 s after the last.
  stub.answer = later("01");
  const readsBefore = stub.reads;
  await page.clock.fastForward(29_000);
  await expect(page.getByText("Observed 7 Oct 2026, 09:00 UTC")).toBeVisible();
  expect(stub.reads).toBe(readsBefore);
  await page.clock.fastForward(1_500);
  await expect(page.getByText("Observed 7 Oct 2026, 09:01 UTC")).toBeVisible();
  expect(stub.reads).toBe(readsBefore + 1);
  // Manual Refresh.
  stub.answer = later("02");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Observed 7 Oct 2026, 09:02 UTC")).toBeVisible();
  expect(stub.reads).toBe(readsBefore + 2);

  await spend.locator('[data-client="client-one"]').getByRole("link", { name: "Open Limits" }).click();
  await expect(page.getByRole("heading", { name: "Limits", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Budgets" }).getByRole("listitem")).toHaveCount(3);
});

test("System health shows an unavailable section as such, and keeps the last data after a failed refresh", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await stubHealth(page, asConsole(withUnavailable("waiting", "RaiseException")));
  await unlock(page);
  await page.getByRole("button", { name: "System health", exact: true }).click();
  const waiting = page.locator('[data-section="health-waiting"]');
  await expect(waiting).toContainText("Unavailable — RaiseException");
  await expect(waiting.locator("li")).toHaveCount(0);
  stub.answer = 503;
  await page.getByRole("button", { name: "Refresh" }).click();
  // (Next.js keeps an empty route-announcer alert on every page.)
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't refresh" })).toHaveText("Couldn't refresh · showing data from 7 Oct 2026, 09:00 UTC");
  await expectFiveSections(page);
  await expect(page.locator('[data-section="health-documents"]')).toContainText("Finished5");
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-health-stale.png", fullPage: true });
});

test("System health is absent when the deployment does not run the new engine", async ({ page }) => {
  const stub = await stubHealth(page, asConsole(opsHealth()), "m1");
  await unlock(page);
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "System health", exact: true })).toHaveCount(0);
  expect(stub.reads).toBe(0);
});

test("System health fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubHealth(page, asConsole(opsHealth()));
  await unlock(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Open System health" }).click();
  await expectFiveSections(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "../docs/integration/screenshots/internal-console-v2-health-phone.png", fullPage: true });
  const widths = await page.evaluate(() => ({ view: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBe(widths.view);
});
