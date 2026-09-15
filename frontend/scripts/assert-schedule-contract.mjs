#!/usr/bin/env node

// The schedule contract, asserted structurally.
//
// WHY THIS FILE EXISTS AND WHAT IT IS NOT. There is no unit-test runner in this
// repo and the Playwright suite needs Postgres and a live backend, so the
// executable guards on this surface are `tsc --noEmit` and this script. It is
// modelled on `assert-onboarding-contract.mjs`: text needles with a mutation
// control for each one, so an assertion that cannot fail is reported as a
// failure rather than passing quietly.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function source(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relative} is missing`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function requireText(label, text, needle) {
  if (!text.includes(needle)) failures.push(`${label} is missing ${JSON.stringify(needle)}`);
}

function forbidText(label, text, pattern) {
  if (pattern.test(text)) failures.push(`${label} contains forbidden ${pattern}`);
}

/** A representative mutation must make its assertion fail, or the assertion is decorative. */
function mutationTrips(label, text, needle) {
  const mutated = text.replaceAll(needle, "__schedule_contract_mutation__");
  if (mutated === text || mutated.includes(needle)) {
    failures.push(`${label} mutation control does not trip for ${JSON.stringify(needle)}`);
  }
}

/** Every `.ts`/`.tsx` file under `src` AND `e2e`, so a whole-tree rule is a
 * whole-tree rule. `e2e` is in scope for the same reason
 * `assert-no-fabricated-state.mjs` already scans both roots: a spec can encode
 * a contract just as durably as a component can, and section 5 below claims
 * `campaign_objective` is gone TREE-WIDE — a claim `src`-only scanning cannot
 * actually make good on.
 *
 * Paths are normalised to forward slashes (`path.sep` is `\` on Windows) so the
 * declarer comparison below can use a forward-slash literal on every platform —
 * the same normalisation `assert-internal-bff-boundary.mjs` already applies for
 * the same reason.
 */
function sourceFiles(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) ? [child.split(path.sep).join("/")] : [];
  });
}
const tree = ["src", "e2e"]
  .flatMap((directory) => sourceFiles(directory))
  .map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]);

/* ---------------------------------------------------------------------------
 * 1. The wall-clock -> aware-instant conversion is declared ONCE.
 *
 * `RescheduleIn.slot_at` and `ScheduleCreate.slot_at` are both `AwareDatetime`
 * on the Python side. Two copies of this arithmetic is two answers to "what
 * instant did the client mean", and the day they disagree the post moves.
 * ------------------------------------------------------------------------- */

const zoned = source("src/lib/zoned-instant.ts");
requireText("zoned-instant", zoned, "export function instantInZone");
mutationTrips("zoned-instant", zoned, "export function instantInZone");

const declarers = tree.filter(([, text]) => /function\s+instantInZone/.test(text)).map(([file]) => file);
if (declarers.length !== 1 || declarers[0] !== "src/lib/zoned-instant.ts") {
  failures.push(`instantInZone declared in ${JSON.stringify(declarers)}`);
}

const zonedInstantDeclarers = tree
  .filter(([, text]) => /(const|function)\s+zonedInstant\b/.test(text))
  .map(([file]) => file);
if (zonedInstantDeclarers.length > 0) {
  failures.push(`the old local zonedInstant survives in ${JSON.stringify(zonedInstantDeclarers)}`);
}

/* ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 2. The create route exists, and the ZONE is resolved server-side.
 *
 * The browser may name a date and a time. It may not name a zone and it may not
 * name an instant: the backend stamps `slot_zone` from `clients.timezone`
 * (`product/api/lookups.py::client_zone`), so an instant built against any other
 * zone would render on the calendar as a time the client did not pick. Same
 * column, same answer, one place.
 * ------------------------------------------------------------------------- */

const product = source("src/lib/product.ts");
requireText("product schedule helper", product, "export function scheduleContentItem");
requireText("product schedule helper", product, "/schedule`");
mutationTrips("product schedule helper", product, "export function scheduleContentItem");

const createRoute = source("src/app/api/client/content-items/[id]/schedule/route.ts");
requireText("create route", createRoute, "scheduleContentItem");
requireText("create route", createRoute, "clientTimezone");
requireText("create route", createRoute, "instantInZone");
mutationTrips("create route", createRoute, "instantInZone");

// The browser's own words never become the instant, and never become the zone.
forbidText("create route takes no instant", createRoute, /raw\.slot_at/);
forbidText("create route takes no zone", createRoute, /raw\.(timezone|zone)/);

const timezoneHelper = source("src/lib/client-timezone.ts");
requireText("timezone helper", timezoneHelper, "server-only");
requireText("timezone helper", timezoneHelper, "resolveClientId");
mutationTrips("timezone helper", timezoneHelper, "resolveClientId");

const timezoneRoute = source("src/app/api/client/timezone/route.ts");
requireText("timezone route", timezoneRoute, "export async function GET");
requireText("timezone route", timezoneRoute, "clientTimezone");

// The date and time are RANGE-checked, not merely shape-checked: `Date.UTC` rolls
// a shape-valid impossible date over into a real one, so `\d{2}` alone would let
// `2026-02-31` schedule 3 March and answer 201.
requireText("create route range-checks the date", createRoute, "isRealDate");
mutationTrips("create route range-checks the date", createRoute, "isRealDate");
forbidText("create route does not shape-check alone", createRoute, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);

/* ---------------------------------------------------------------------------
 * 3. The picker has a create arm, and the dead legacy arm is gone.
 *
 * `onConfirm` handed a caller `(date, time)` and no way to reach either the zone
 * maths or the idempotency key. It had no callers. Two shapes, both writing
 * through this component, is the invariant: the key and the conversion live in
 * one place per action.
 * ------------------------------------------------------------------------- */

const picker = source("src/components/app/SchedulePicker.tsx");
requireText("picker create arm", picker, "contentItemId");
requireText("picker create arm", picker, "/schedule`");
requireText("picker create arm", picker, "onScheduled");
mutationTrips("picker create arm", picker, "onScheduled");
forbidText("picker has no dead legacy arm", picker, /onConfirm/);

// Both arms key their write. An unkeyed POST through `postJson` is retried, and a
// retried unkeyed create is a second slot. A bare `includes("keyFor")` is
// satisfied by a single occurrence, so it would keep passing after one arm
// silently lost its key — each arm gets its own path-scoped needle instead.
requireText("picker keys the create arm", picker, "key.keyFor(`${props.contentItemId}");
mutationTrips("picker keys the create arm", picker, "key.keyFor(`${props.contentItemId}");
requireText("picker keys the reschedule arm", picker, "key.keyFor(`${props.slot.slot_id}");
mutationTrips("picker keys the reschedule arm", picker, "key.keyFor(`${props.slot.slot_id}");

/* ---------------------------------------------------------------------------
 * 4. `Approved.slot` is nullable on the wire type, and the screen has a branch
 *    for it.
 *
 * Pass 1 (spec 2026-08-20, decision D2) deleted the allocator approve called, so
 * `state: "approved"` with `slot: null` is the ORDINARY response — not an edge
 * case. The declaration is what makes `tsc` name every unguarded reader.
 * ------------------------------------------------------------------------- */

requireText("approved slot is nullable", product, "slot: ScheduledSlot | null");
mutationTrips("approved slot is nullable", product, "slot: ScheduledSlot | null");

const approved = source("src/components/compose/Approved.tsx");
requireText("approved screen branches on no slot", approved, "slot === null");
requireText("approved screen offers a date", approved, "contentItemId");
mutationTrips("approved screen branches on no slot", approved, "slot === null");

/* ---------------------------------------------------------------------------
 * 5. The calendar renders `objective`, and `campaign_objective` is gone tree-wide.
 *
 * `objective` is always populated (`CalendarSlotOut`: the item's own, else the
 * legacy campaign's, else ""), while `campaign_objective` is null on every
 * standalone item — which is every chat-created post, i.e. all of them. Reading
 * the deprecated field showed the generic fallback on every card.
 * ------------------------------------------------------------------------- */

// SCOPED TO THE `CalendarSlot` BLOCK ON PURPOSE. A bare `objective: string` needle
// against the whole of product.ts would already pass: `ClientCampaign` and
// `ServiceCampaign` both declare one, so the assertion would be decorative and its
// mutation control would happily trip on somebody else's field.
const calendarSlotBlock = /export type CalendarSlot = \{([\s\S]*?)\n\};/.exec(product)?.[1] ?? "";
if (!calendarSlotBlock) failures.push("product.ts declares no CalendarSlot type");
if (!/\n\s*objective: string;/.test(calendarSlotBlock)) {
  failures.push("CalendarSlot does not declare `objective: string`");
}

const calendarPage = source("src/app/(app)/calendar/page.tsx");
requireText("calendar renders objective", calendarPage, "slot.objective");
mutationTrips("calendar renders objective", calendarPage, "slot.objective");

// A READ, not a MENTION. `text.includes("campaign_objective")` would fail on the
// docstring below that names the field it deprecates — this file's own version of
// the prose-counts trap the backend's CLAUDE.md records twenty-three times. Match a
// property access (`slot.campaign_objective`) or a declaration (`campaign_objective:`)
// so the deprecation can be documented in the words a later reader will search for.
const DEPRECATED_READ = /\.campaign_objective\b|campaign_objective\s*:/;
const readsDeprecated = tree.filter(([, text]) => DEPRECATED_READ.test(text)).map(([file]) => file);
if (readsDeprecated.length > 0) {
  failures.push(`campaign_objective is still read in ${JSON.stringify(readsDeprecated)}`);
}

// Approve no longer allocates, so no screen may promise that it does.
forbidText("calendar copy does not promise an automatic slot", calendarPage, /takes a slot here/);

/* ---------------------------------------------------------------------------
 * 6. An approved item in the library can be given a date.
 *
 * `DraftActions` renders for `state === "draft"` and hands its `Approved` result
 * to `onRefresh`, so before this the only schedulable item was one approved
 * inside compose. The library needs its own affordance or half the approvals are
 * a dead end.
 * ------------------------------------------------------------------------- */

const libraryPage = source("src/app/(app)/library/page.tsx");
requireText("library offers a date", libraryPage, "SchedulePicker");
requireText("library offers a date", libraryPage, "contentItemId");
requireText("library knows what is scheduled", libraryPage, "/api/client/calendar");
mutationTrips("library knows what is scheduled", libraryPage, "/api/client/calendar");

// The affordance is gated on the SERVER's state word, never on a local guess.
requireText("library gates on server state", libraryPage, 'item.state === "approved"');
mutationTrips("library gates on server state", libraryPage, 'item.state === "approved"');

/* ---------------------------------------------------------------------------
 * 7. No CONTENT-ITEM shape claims a non-null `campaign_id`.
 *
 * Migration 0015 dropped the NOT NULL, and `ContentItemOut`,
 * `ClientContentItemOut`, `HeldDraftOut` and `CalendarSlotOut` all publish it as
 * optional now. A `campaign_id: string` on one of those is a promise the API
 * stopped keeping.
 *
 * EXACTLY ONE NON-NULLABLE DECLARATION IS CORRECT AND MUST SURVIVE:
 * `ClientCampaign.campaign_id` on the `GET /v1/campaigns` envelope, where the
 * value is a CAMPAIGN's own id and can no more be null than a row can be its own
 * absence. The rule is therefore a count, not a ban — a ban would either be false
 * or would need that one file exempted by name, and an exemption list is how the
 * next legitimate declaration gets silently mis-classified.
 *
 * `src/app/(app)/profile/page.tsx` types the same envelope inline and is counted
 * here for the same reason.
 * ------------------------------------------------------------------------- */

const nonNullable = tree.flatMap(([file, text]) =>
  (text.match(/campaign_id: string;/g) ?? []).map(() => file),
);
const nullable = tree.flatMap(([file, text]) =>
  (text.match(/campaign_id: string \| null;/g) ?? []).map(() => file),
);
if (nonNullable.length !== 2) {
  failures.push(
    `expected exactly 2 non-nullable campaign_id declarations (the /v1/campaigns envelope in product.ts and its inline twin in profile/page.tsx); found ${nonNullable.length} in ${JSON.stringify([...new Set(nonNullable)])}`,
  );
}
requireText("the surviving non-nullable is the campaigns envelope", product, "export type ClientCampaign");
// Mutation control: the nullable pattern must be one that CAN match, or the count
// above is measuring a spelling nothing in the tree uses.
if (nullable.length === 0) {
  failures.push("no nullable campaign_id is declared anywhere, so the count above proves nothing");
}

/* ---------------------------------------------------------------------------
 * 8. Plan D-lite: approve opens the one picker itself, the create arm offers
 *    fast presets instead of two bare inputs, and a stale library catches up
 *    when the client comes back to the tab.
 *
 * Approve used to hand off to a SEPARATE unscheduled screen that then asked
 * the client to tap "Pick a date" before the picker even opened — two screens
 * for one decision. The picker itself asked for a date and a time typed into
 * two inputs with no faster path for the two answers most clients actually
 * want. Neither gap was a missing feature so much as a missing shortcut, and
 * both are closed here without touching the reschedule arm's own contract
 * (section 3 above already pins its key, its route and its copy).
 * ------------------------------------------------------------------------- */

// The calendar helpers the presets are built from. Pure date arithmetic, no
// new dependency — the same "declared once" argument section 1 makes for
// `instantInZone`.
requireText("zoned-instant", zoned, "export function todayInZone");
mutationTrips("zoned-instant", zoned, "export function todayInZone");
requireText("zoned-instant", zoned, "export function addCalendarDays");
mutationTrips("zoned-instant", zoned, "export function addCalendarDays");
requireText("zoned-instant", zoned, "export function nextWeekday");
mutationTrips("zoned-instant", zoned, "export function nextWeekday");

// The create arm no longer takes a caller-supplied starting point: it resolves
// its own from the client's zone. A surviving `initialDate` prop would mean a
// caller is still seeding the duplicated default this change removes.
forbidText("picker create arm takes no initialDate", picker, /initialDate/);

// The create arm offers one-tap presets built from the resolved zone, plus an
// escape hatch to the raw fields for anything else, and a soft way out that
// does not claim the client is cancelling something they already decided to do.
requireText("picker create arm's presets are computed via todayInZone", picker, "todayInZone");
mutationTrips("picker create arm's presets are computed via todayInZone", picker, "todayInZone");
requireText("picker create arm offers the raw fields on request", picker, "Another time");
mutationTrips("picker create arm offers the raw fields on request", picker, "Another time");
requireText("picker create arm's exit does not claim a cancellation", picker, "Not yet");
mutationTrips("picker create arm's exit does not claim a cancellation", picker, "Not yet");

// ROUND 2: a stored date was a stale answer to a question whose inputs (the
// resolved zone) were still arriving — a preset tap could be overtaken by the
// zone landing after it, or the zone landing could revert a preset tap that
// came before it, depending on which the `edited` ref let win. The fix is a
// selection the picker re-derives every render, so nothing is ever reseated.
requireText("picker create arm derives its date from a selection, not a stored one", picker, 'type Selection = "tomorrow" | "monday" | "custom"');
mutationTrips("picker create arm derives its date from a selection, not a stored one", picker, 'type Selection = "tomorrow" | "monday" | "custom"');
// The reseat mechanism this replaces must not creep back in.
forbidText("picker has no reseat-on-resolve race to reintroduce", picker, /edited\.current/);

// Approve opens the picker itself when there is no date yet, instead of
// landing on a screen that then asks the client to open it themselves.
requireText("approved opens its own picker when unscheduled", approved, "useState(approved.slot === null)");
mutationTrips("approved opens its own picker when unscheduled", approved, "useState(approved.slot === null)");

// The library catches up when the client comes back to the tab, and does so
// by asking the server again — never by polling it on a timer the client
// never asked for, which the auth gate would also charge a `/v1/me` against.
requireText("library refreshes on return to the tab", libraryPage, "visibilitychange");
mutationTrips("library refreshes on return to the tab", libraryPage, "visibilitychange");
forbidText("library does not poll", libraryPage, /setInterval/);

/* ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 9. Plan D-lite: approving from a library card asks the same question compose
 *    asks.
 *
 * The library card used to approve and call `onRefresh`, discarding the
 * `Approved` result — so the client had to hunt for the card again and press
 * "Pick a date" themselves. Closed here without adding a second picker
 * instance.
 *
 * FIX ROUND 1: the picker moved OUT of the card and up to `LibraryRegion`.
 * A card-owned picker was gated on `item.state === "approved"`, which only
 * flips true once `router.refresh()` resolves — and in that same render pass
 * the active shelf filter re-evaluates too. On a shelf that excludes approved
 * items (Drafts, the one a client approving drafts is most likely sitting on)
 * the card unmounts, taking its freshly-opened picker down with it, before
 * the gate ever renders it. The needles below were rewritten to match the
 * hoisted shape, not weakened: they now check for one picker at page level
 * (keyed by which item it's open for) and a card that no longer carries one
 * of its own — a genuine interface change, not a relaxed assertion.
 * ------------------------------------------------------------------------- */

// Approving from a card still triggers the picker instead of only refreshing —
// the same question compose's own Approved screen asks itself — and only when
// the approval left the item unscheduled (a non-null slot is a reclaimed one).
// `handleApproved` now calls UP (`onPick`) instead of holding its own picker
// state.
requireText("approving from a card opens the picker", libraryPage, "handleApproved");
mutationTrips("approving from a card opens the picker", libraryPage, "handleApproved");
requireText("approving from a card opens the picker only when unscheduled", libraryPage, "approved.slot === null");
mutationTrips("approving from a card opens the picker only when unscheduled", libraryPage, "approved.slot === null");
// UPDATED, Plan D-lite (section 11 below): `onPick` now carries a MODE, not a
// bare id, because the same picker serves a reschedule target too. The needle
// tracks the real call shape rather than a fossil of the pre-widening one.
requireText("the card calls up to open the picker rather than owning one", libraryPage, 'onPick({ mode: "create", contentItemId: item.content_item_id })');
mutationTrips("the card calls up to open the picker rather than owning one", libraryPage, 'onPick({ mode: "create", contentItemId: item.content_item_id })');

// The picker itself is owned by `LibraryRegion`, keyed by which item it's open
// for, not by a per-card boolean — a card unmounting can't take a `null`
// versus `boolean` distinction with it the way it could a card-local flag.
// UPDATED, Plan D-lite (section 11 below): the picker now serves a second mode
// (reschedule), so the id-keyed `string | null` widened to a discriminated
// union. The needle tracks the real declaration rather than a fossil of the
// narrower one it replaced.
requireText("library owns one picker, keyed by which item or slot it's open for", libraryPage, "useState<PickerTarget | null>(null)");
mutationTrips("library owns one picker, keyed by which item or slot it's open for", libraryPage, "useState<PickerTarget | null>(null)");

// The regression this fix closes: `CardSlot` must never render a `SchedulePicker`
// of its own again, or the unmount-mid-flight bug is right back. Scoped to the
// `CardSlot` function body specifically — a bare `forbidText` against the whole
// file would also trip on `LibraryRegion`'s own (correct) picker below it.
const cardSlotStart = libraryPage.indexOf("function CardSlot");
const libraryRegionStart = libraryPage.indexOf("function LibraryRegion");
if (cardSlotStart === -1 || libraryRegionStart === -1 || libraryRegionStart <= cardSlotStart) {
  failures.push("could not isolate the CardSlot function body to check it renders no picker of its own");
} else {
  const cardSlotBody = libraryPage.slice(cardSlotStart, libraryRegionStart);
  forbidText("CardSlot renders no SchedulePicker of its own", cardSlotBody, /SchedulePicker/);
  // Mutation control: prove the slice actually reaches into the function body,
  // not just its signature, or the check above is decorative.
  if (!cardSlotBody.includes("handleApproved")) {
    failures.push("the isolated CardSlot body is missing handleApproved, so it is too short to trust");
  }
}

/* ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 10. Plan D-lite: Approved and Scheduled are different shelves.
 *
 * The shelf list filtered on `item.state` alone, so an approved-and-scheduled
 * post looked identical to an approved-and-unscheduled one — both are
 * `state === "approved"`, and state alone cannot tell them apart. Closed here
 * without adding a second calendar read: the shelf reads the same slot set
 * `loadScheduled` already populates.
 * ------------------------------------------------------------------------- */

// The Scheduled shelf exists and is told apart from Approved by the slot set
// the library already loads (`loadScheduled`'s own `scheduled` set), not by a
// second, locally invented status.
requireText("library offers a Scheduled shelf", libraryPage, '"Scheduled"');
mutationTrips("library offers a Scheduled shelf", libraryPage, '"Scheduled"');
requireText("library's shelf membership reads the scheduled set", libraryPage, "scheduled.has(item.content_item_id)");
mutationTrips("library's shelf membership reads the scheduled set", libraryPage, "scheduled.has(item.content_item_id)");

// The library still performs exactly one calendar read. Matched as a quoted
// string literal, not a bare substring, so the prose above (which names the
// same path inside backticks) cannot trip this — two occurrences of the
// LITERAL in order means a second fetch crept in somewhere, a second answer
// to "what is scheduled" that nothing keeps in step with the first.
forbidText(
  "library performs exactly one calendar read",
  libraryPage,
  /"\/api\/client\/calendar"[\s\S]*"\/api\/client\/calendar"/,
);

/* ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * 11. Plan D-lite: a scheduled card in the library says so, shows the date,
 *     and offers a way back.
 *
 * A post's state and whether it holds a schedule slot are independent facts.
 * The library used to reduce `/api/client/calendar` to a bare `Set` of ids —
 * enough to answer "does this have a date?" and nothing more — so a scheduled
 * card still said "Approved", showed no date, and offered no way to move it.
 * Compose's approved screen already has "Change the time"; the calendar
 * already has "Reschedule". This closes the last surface with no way back,
 * without a second calendar read and without a second `SchedulePicker`.
 * ------------------------------------------------------------------------- */

const postCard = source("src/components/app/PostCard.tsx");

// 11a. The Set becomes a Map carrying the slot itself — one read, same
// endpoint, same place.
requireText(
  "library reduces the calendar to a Map of slots",
  libraryPage,
  "new Map(result.slots.map((slot) => [slot.content_item_id, slot]))",
);
mutationTrips(
  "library reduces the calendar to a Map of slots",
  libraryPage,
  "new Map(result.slots.map((slot) => [slot.content_item_id, slot]))",
);
forbidText("the old bare Set of ids is gone", libraryPage, /new Set\(result\.slots\.map/);

// Still exactly one calendar read — the Map swap must not have grown a second
// fetch to go with it.
const calendarFetchOccurrences = (libraryPage.match(/"\/api\/client\/calendar"/g) ?? []).length;
if (calendarFetchOccurrences !== 1) {
  failures.push(
    `expected exactly one "/api/client/calendar" literal in library/page.tsx, found ${calendarFetchOccurrences}`,
  );
}

// 11b. One formatter, shared. `Approved.tsx` already builds an
// `Intl.DateTimeFormat` for a slot; the library card needs the same shape at a
// different `dateStyle`. Extracted into `zoned-instant.ts` (the file that
// already owns every other slot-time computation) so both callers share it
// rather than each declaring its own.
requireText("zoned-instant declares the shared slot formatter", zoned, "export function formatSlotInstant");
mutationTrips("zoned-instant declares the shared slot formatter", zoned, "export function formatSlotInstant");
requireText("Approved.tsx uses the shared formatter", approved, "formatSlotInstant(");
mutationTrips("Approved.tsx uses the shared formatter", approved, "formatSlotInstant(");
requireText("the library card uses the shared formatter", postCard, "formatSlotInstant(");
mutationTrips("the library card uses the shared formatter", postCard, "formatSlotInstant(");

// Mutation control for the ban below: the pattern it forbids elsewhere must be
// able to match SOMEWHERE, or the ban is proving nothing. `formatSlotInstant`
// itself writes `dateStyle: style` (a parameter, not a literal), so the
// pattern matches the bare option name rather than requiring a quote after it.
if (!/dateStyle:/.test(zoned)) {
  failures.push("no dateStyle usage found in zoned-instant.ts, so the duplicate-formatter ban below is vacuous");
}
const dateStyleDeclarers = tree
  .filter(([file, text]) => file !== "src/lib/zoned-instant.ts" && /dateStyle:/.test(text))
  .map(([file]) => file);
if (dateStyleDeclarers.length > 0) {
  failures.push(`a second slot-date formatter survives in ${JSON.stringify(dateStyleDeclarers)}`);
}

// 11c. `statusLabel` takes the item's slot and substitutes ONLY the "Approved"
// case — "Manually edited" still wins over everything, exactly as it does
// today, and every other label is untouched.
requireText(
  "statusLabel takes an optional slot",
  postCard,
  "export function statusLabel(item: ClientContentItem, slot?: CalendarSlot | null): string",
);
mutationTrips(
  "statusLabel takes an optional slot",
  postCard,
  "export function statusLabel(item: ClientContentItem, slot?: CalendarSlot | null): string",
);
requireText("statusLabel can return Scheduled", postCard, '"Scheduled"');
mutationTrips("statusLabel can return Scheduled", postCard, '"Scheduled"');
requireText(
  "manually_edited still wins over everything",
  postCard,
  'if (item.manually_edited) return "Manually edited";',
);
mutationTrips(
  "manually_edited still wins over everything",
  postCard,
  'if (item.manually_edited) return "Manually edited";',
);

// 11d. A scheduled card can be rescheduled, through the picker's EXISTING
// reschedule mode (a real `CalendarSlot`, not a fabricated one).
requireText("a scheduled card can be rescheduled", libraryPage, 'mode: "reschedule"');
mutationTrips("a scheduled card can be rescheduled", libraryPage, 'mode: "reschedule"');
requireText("the reschedule target carries a real CalendarSlot", libraryPage, '{ mode: "reschedule"; slot: CalendarSlot }');
mutationTrips("the reschedule target carries a real CalendarSlot", libraryPage, '{ mode: "reschedule"; slot: CalendarSlot }');

// 11e. Still one picker, owned by `LibraryRegion`, outside `CardSlot` — the
// CardSlot/LibraryRegion isolation from section 9 still holds; only the state
// it's keyed on widened to a discriminated union (checked in section 9's own
// updated needle above). It renders as TWO named-prop call sites rather than
// one spread call: a single `<SchedulePicker {...props} />` built from a
// `picking.mode`-keyed ternary type-checks (no cast needed — `CalendarSlot`
// carries every field `ScheduledSlot` declares plus extras) but trips this
// codebase's `react-hooks/refs` lint rule, which cannot trace a ref
// `SchedulePicker` reads internally through a spread of a union-typed props
// object. So the invariant checked here is not "exactly one JSX tag" but
// "exactly one state, exactly two mutually-exclusive branches of it, both
// outside CardSlot" — a card-owned THIRD instance is what section 9's
// isolation guards against, not this file's own two.
const schedulePickerTags = (libraryPage.match(/<SchedulePicker\b/g) ?? []).length;
if (schedulePickerTags !== 2) {
  failures.push(`expected exactly two <SchedulePicker> call sites (one per picking.mode) in library/page.tsx, found ${schedulePickerTags}`);
}
requireText("the create branch is keyed on picking.mode", libraryPage, 'picking.mode === "create"');
mutationTrips("the create branch is keyed on picking.mode", libraryPage, 'picking.mode === "create"');
requireText("the reschedule branch is keyed on picking.mode", libraryPage, 'picking.mode === "reschedule" ?');
mutationTrips("the reschedule branch is keyed on picking.mode", libraryPage, 'picking.mode === "reschedule" ?');

/* ------------------------------------------------------------------------- */

if (failures.length > 0) {
  console.error("assert-schedule-contract FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("assert-schedule-contract - the schedule path is wired the one way it is allowed to be");
