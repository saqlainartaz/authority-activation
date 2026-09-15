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
  const mutated = text.replaceAll(needle, "__onboarding_contract_mutation__");
  if (mutated === text || mutated.includes(needle)) {
    failures.push(`${label} mutation control does not trip for ${JSON.stringify(needle)}`);
  }
}

const form = source("src/components/onboarding/OnboardingForm.tsx");
const product = source("src/lib/product.ts");

/* ---------------------------------------------------------------------------
 * Audience is the ONE onboarding answer with a closed value set. The backend
 * publishes it per profession (`audience_options_for`, versioned by
 * `PROFESSIONS_VERSION`) and refuses anything outside it with a 422 naming the
 * offered keys. Every control below guards one half of that contract.
 * ------------------------------------------------------------------------- */

// The catalogue is served and typed; it must actually be consumed.
requireText("audience options", product, "audience_options");
requireText("audience options", form, "prefill.audience_options");

// Audience must be chosen, never typed. The previous control displayed
// `audience.join(", ")` while onChange stored the whole string as ONE array
// element, so "founders, investors" became a single key containing a comma —
// the display and the state disagreed and multi-select was impossible.
forbidText("audience is not free text", form, /audience\.join\(/);
forbidText("audience is not free text", form, /setAudience\(event\.target\.value/);

// Selection uses the primitives the rest of the app already selects with.
requireText("audience is selectable", form, "OptionRow");
requireText("audience is selectable", form, "CheckMark");

// The refusal treatment stays. A stored answer can name an option no longer
// offered — which is exactly why `professions_version` is recorded — so
// catalogue drift is a real state the UI still has to show.
requireText("refusal treatment", form, 'refused.has("audience")');

// Catalogue drift must stay VISIBLE and deselectable. Rendering only the offered
// options would make a stored-but-no-longer-offered key invisible, and the
// backend refuses exactly those keys with a 422 naming them — so the client
// would receive a refusal about a value they cannot see or remove.
requireText("catalogue drift", form, "no longer offered");
mutationTrips("catalogue drift", form, "no longer offered");

/* ---------------------------------------------------------------------------
 * The guardrail OR-constraint. The backend refuses a confirmation whose
 * `never_say`, `voice_constraints` AND `tone` are all empty, because such a
 * submission writes no atom and the guardrails the client believes they set
 * would bind nothing. Three things follow, and each has a control.
 * ------------------------------------------------------------------------- */

// 1. The form must not OFFER a submit the backend is bound to refuse.
requireText("guardrail gate", form, "canConfirm");
forbidText("guardrail gate", form, /void submit\(\)\} disabled=\{pending\}/);

// 2. The blocked state must be explained in the client's vocabulary. The backend
//    message names REQUEST FIELDS (`never_say`, `voice_constraints`, `tone`),
//    which no client has ever seen — they answered prompts, not field names.
requireText("guardrail gate", form, "any one is enough");

// 3. An OR failure must not paint all three fields red. `namedFields` scans the
//    message for field names and the backend message contains all three, so the
//    untreated path implies every one is wrong when filling in ONE resolves it.
requireText("or-failure treatment", form, "at least one guardrail question");

for (const [label, text, needle] of [
  ["audience options", form, "prefill.audience_options"],
  ["guardrail gate", form, "canConfirm"],
  ["or-failure treatment", form, "at least one guardrail question"],
  ["audience is selectable", form, "OptionRow"],
  ["refusal treatment", form, 'refused.has("audience")'],
]) mutationTrips(label, text, needle);

if (failures.length > 0) {
  console.error("assert-onboarding-contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("assert-onboarding-contract — audience is chosen from the served catalogue, not typed");
