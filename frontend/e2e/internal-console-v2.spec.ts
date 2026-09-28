import { expect, test } from "@playwright/test";

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
