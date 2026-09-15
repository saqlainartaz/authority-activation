import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* ---------------------------------------------------------------------------
 * REPOINTED at step 6 (A14), not deleted outright — half-and-half.
 *
 * This script used to take a `<draft|decisions|schedule>` mode and integration-
 * test THREE things: `compose/page.tsx`'s old `?job_id=` polling render path
 * through `GroundingStep.tsx` -> `DraftReview.tsx` (`draft` mode), the same
 * path's replacement/reject flow through `DraftActions.tsx` (`decisions`
 * mode), and `SchedulePicker.tsx`'s own zone-aware rendering (`schedule`
 * mode). Step 6 deleted `GroundingStep.tsx`, `Screens.tsx` and
 * `Steps.tsx` (Task 7) and `compose/page.tsx` now renders `ChatPath`
 * unconditionally — no `job_id` query param, no polling, no `DraftReview`.
 * `draft` and `decisions` mode's entire subject is gone, not merely moved:
 * confirmed by reading the live `compose/page.tsx`, which has no code path
 * left that either mode's assertions could ever match.
 *
 * `schedule` mode's subject is NOT gone. It never rendered through
 * `compose/page.tsx` at all — it loads `SchedulePicker.tsx` directly and
 * checks its rendered markup derives the right local date/time from a slot's
 * OWN zone even when the browser's zone (faked here as Pacific/Auckland) is
 * deliberately different. `SchedulePicker` is still live (`ChatPath.tsx`
 * renders it for the approved state; `library/page.tsx` and
 * `ContentItemDetail.tsx` render it too), and nothing else in this repo
 * render-tests it — `assert-schedule-contract.mjs` (wired into `npm run
 * check`) only string-matches its source, it never mounts the component, so
 * it cannot catch a zone-math regression the way this can. That is the half
 * kept: this file is now schedule-only, with the `draft`/`decisions` modes,
 * the CLI mode argument, and every helper only they used (`renderCompose`,
 * `generated`, `assertDraftRuntime`, `assertReplacementRuntime`) removed
 * rather than left to bit-rot unreachable.
 *
 * One more thing found while repointing, unrelated to step 6's own diff:
 * running the surviving `schedule` half after the rewrite threw on its own
 * source-text needle, `zonedInstant(date, time, slot.slot_zone)` — that
 * function was renamed to `instantInZone` in `@/lib/zoned-instant` at some
 * earlier, unrelated point, and this script (already disconnected from
 * `npm run check`) was never updated. Fixed to the current call shape,
 * `instantInZone(date, time, props.slot.slot_zone)`, and re-run clean. A
 * script being "repointed" is not the same as it being verified to still
 * pass — it was run by hand after every change in this block.
 * ------------------------------------------------------------------------- */

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(path.join(root, "package.json"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireText = (source, fragment, message) => {
  if (!source.includes(fragment)) throw new Error(message);
};
const requireMarkup = (markup, fragment, message) => {
  if (!markup.replace(/<[^>]*>/g, "").includes(fragment)) throw new Error(message);
};

const approved = read("src/components/compose/Approved.tsx");
const schedule = read("src/components/app/SchedulePicker.tsx");
const content = read("src/lib/content.ts");

class FakeHttpError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const resolveSource = (request, parent) => {
  const candidate = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : path.resolve(path.dirname(parent), request);
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const file = `${candidate}${suffix}`;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  throw new Error(`could not resolve authored module ${request} from ${parent}`);
};

/**
 * Evaluate the shipped TypeScript modules, not a handwritten facsimile. The only
 * substitutions are the browser-only seams SchedulePicker itself needs:
 * navigation (transitively, via whatever it imports), mutation transport, and
 * idempotency. ReactDOM then renders the real component function.
 */
const makeRuntime = ({ query = "", posts = [] } = {}) => {
  const cache = new Map();
  const navigation = [];
  const searchParams = new URLSearchParams(query);
  const router = {
    push: (href) => navigation.push({ kind: "push", href }),
    replace: (href) => navigation.push({ kind: "replace", href }),
    refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {},
  };
  let keyNumber = 0;
  const api = {
    HttpError: FakeHttpError,
    getJson: async (url) => {
      if (url.includes("reject-options")) return {
        taps: ["not_my_voice", "just_not_this_one"], ban_available: false, claims: [], topic_options: [{ key: "different", label: "A different angle" }],
      };
      throw new Error(`unexpected deterministic GET: ${url}`);
    },
    postJson: async (url, body, options) => {
      posts.push({ url, body, options });
      if (url.includes("/reschedule")) return { slot: { slot_id: "slot-new", slot_at: "2026-06-15T17:30:00.000Z", slot_zone: "America/Toronto", status: "scheduled", relaxation: "none", cadence_version: 99 } };
      throw new Error(`unexpected deterministic POST: ${url}`);
    },
  };
  const fakes = {
    "next/navigation": { useRouter: () => router, usePathname: () => "/compose", useSearchParams: () => searchParams },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "server-only": {},
    "@/lib/api": api,
    "@/lib/retry-fetch": api,
    "@/lib/idempotency": {
      useIdempotencyKey: () => ({ key: () => `action-${++keyNumber}`, rotate: () => `action-${++keyNumber}` }),
      useKeyedIdempotency: () => ({ keyFor: (signature) => `key:${signature}` }),
    },
    "@/components/decide/ConfirmDialog": { default: () => null, NEVER_SAY_THIS_AGAIN_CONFIRM: {}, useFocusTrap: () => {} },
  };
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const compiledModule = { exports: {} };
    cache.set(file, compiledModule);
    const source = fs.readFileSync(file, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const authoredRequire = (request) => {
      if (fakes[request]) return fakes[request];
      if (request.startsWith("@/") || request.startsWith(".")) return load(resolveSource(request, file));
      return nativeRequire(request);
    };
    const execute = new Function("exports", "require", "module", "__filename", "__dirname", output);
    execute(compiledModule.exports, authoredRequire, compiledModule, file, path.dirname(file));
    return compiledModule.exports;
  };
  return { load, navigation, posts };
};

const assertScheduleRuntime = () => {
  const browserZone = process.env.TZ;
  process.env.TZ = "Pacific/Auckland"; // deliberately unlike the slot zone
  try {
    const runtime = makeRuntime();
    const SchedulePicker = runtime.load(path.join(root, "src/components/app/SchedulePicker.tsx")).SchedulePicker;
    const slot = { slot_id: "slot-1", slot_at: "2026-06-15T16:00:00.000Z", slot_zone: "America/Toronto", status: "scheduled", relaxation: "none", cadence_version: 7 };
    const markup = renderToStaticMarkup(React.createElement(SchedulePicker, { slot, onRescheduled: () => {}, onCancel: () => {} }));
    requireMarkup(markup, "Times are set in America/Toronto.", "SchedulePicker did not render its authored slot-zone UI");
    if (!markup.includes('value="2026-06-15"')) throw new Error("SchedulePicker did not derive its initial date in slot_zone");
    if (!markup.includes('value="12:00"')) throw new Error("SchedulePicker did not derive its initial time in slot_zone");
  } finally {
    if (browserZone === undefined) delete process.env.TZ;
    else process.env.TZ = browserZone;
  }
  requireText(schedule, "instantInZone(date, time, props.slot.slot_zone)", "SchedulePicker is not constructing an instant in slot_zone");
  requireText(schedule, "/api/client/schedule-slots/", "SchedulePicker does not reach the reschedule BFF");
  requireText(schedule, "slot_at: slotAt", "SchedulePicker does not send the aware reschedule instant");
};

assertScheduleRuntime();
requireText(approved, "SchedulePicker", "Approved does not reach SchedulePicker");
requireText(content, 'primary: "Change the time"', "approved primary copy is stale");
if (content.includes('secondary: "Leave as draft"')) throw new Error("impossible approved escape remains");
console.log("Approved.tsx -> SchedulePicker.tsx -> /api/client/schedule-slots/{slotId}/reschedule (rendered with browser-zone fake Pacific/Auckland vs slot_zone America/Toronto)");
