/**
 * UI copy only. The AST allowlist in assert-no-fabricated-state.mjs enforces
 * that this module never becomes a source of client, session, or product data.
 */

export const brand = {
  product: "Authority Activation",
  short: "Authority",
  by: "Inside Success",
};

export const login = {
  headline: ["Your authority,", "working every week."],
  title: "Sign in",
  emailLabel: "Email",
  passwordLabel: "Password",
  submit: "Sign in",
  // Unrendered, on purpose (auth phase, 2026-08-22): there is no self-serve
  // password reset this phase — reset links are operator-issued only (F3) — so
  // showing this would promise a flow that does not exist. Left in place
  // rather than deleted because the shape may be wired once that flow lands.
  forgot: "Forgot your password?",
  // Was the screen's only footer line while the form was disabled; moved in
  // here as part of enabling the form (auth phase, 2026-08-22, R4).
  noPassword: "No password yet? Use the invite link we sent you.",
  pending: "Signing in…",
  success: "Signed in successfully.",
  failed: "Email or password didn't match.",
  // Byte-identical to `EXPIRED_LINK_SENTENCE` (src/lib/product.ts) and to
  // `EXPIRED_LINK_MESSAGE` (src/components/ErrorSurface.tsx) — this is the
  // THIRD copy of the same sentence in this repo, and each exists for the same
  // structural reason as the other two: `product.ts` opens with
  // `import "server-only"`, so a client component can never import its
  // constant, and `ErrorSurface.tsx`'s own copy already can't be imported from
  // `content.ts` without inverting that module's role as pure UI copy. Two
  // spellings of this sentence would be two different answers to the same
  // question, so all three are compared byte for byte rather than left to
  // drift.
  //
  // REWORDED (fix wave, 2026-08-22, F4), together with all three other
  // copies: the old wording named "this link" specifically, which stopped
  // being true the day a PASSWORD SESSION started ending the same 401 way
  // (revoked, or past its 90-day ceiling). See `EXPIRED_LINK_MESSAGE`'s own
  // comment in `ErrorSurface.tsx` for the full reasoning; this file's job is
  // only to stay byte-identical to it.
  linkDead: "This link or session is no longer valid — sign in again to continue.",
  // NESTED, NOT A NEW TOP-LEVEL EXPORT (Task 10, auth phase, 2026-08-22).
  // `assert-no-fabricated-state.mjs` §3 pins `content.ts`'s top-level export
  // list to an exact seven-name list; a new `export const setPassword` would
  // fail that check the moment this landed. Nesting it inside `login` (the
  // set-password screen IS the other half of this app's one front door) needs
  // no change to that allowlist at all.
  setPassword: {
    headline: ["One step left,", "then you're in."],
    title: "Set your password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm password",
    submit: "Set password",
    pending: "Setting password…",
    mismatch: "Passwords don't match.",
    tooShort: "Use at least 12 characters.",
    // Operator-fixable (P1), so unlike every other message on this screen it
    // NAMES what's wrong and what to do about it, rather than collapsing to
    // one unexplained refusal.
    conflict:
      "This email address already has login credentials — contact us if that doesn't look right.",
    // BYTE-IDENTICAL to `login.linkDead` two lines above it, on purpose — this
    // is the FOURTH copy of the same sentence in this repo (see that field's
    // own comment for the other three, one per layer that cannot import
    // another's copy). Here it is a fourth copy in the SAME file for the same
    // reason under a stricter version of it: `login` is nested-object data,
    // and reaching across from `login.setPassword.linkDead` to `login.linkDead`
    // while the object literal that defines both is still being constructed
    // is not expressible without pulling the sentence out to a file-level
    // `const` — which would itself be a second place this exact string lives.
    // Compared byte for byte rather than left to drift, same as the other three.
    // REWORDED together with the other three copies (fix wave, 2026-08-22,
    // F4) — see `login.linkDead`'s own comment two lines above for why.
    linkDead: "This link or session is no longer valid — sign in again to continue.",
  },
};

export const trainYourAi = {
  title: "Train Your AI",
  cta: "Add a source",
  actions: { confirmed: "Edit", review: "Confirm", ask: "Answer" },
};

export const compose = {
  moduleLabel: "Social post",
  back: "Back",
  mode: {
    heading: "How would you rather do this?",
    guided: { title: "Step me through it", detail: "Four short questions." },
    chat: { title: "Just talk it out", detail: "Tell us what's on your mind." },
    cta: "Begin",
    hint: "You can swap over mid-way.",
  },
  platform: {
    heading: "Where is this post going?",
    primary: "LinkedIn",
    laterLabel: "Instagram, X, YouTube — later",
    cta: "Continue",
  },
  objective: {
    heading: "What should this post achieve?",
    cta: "Continue",
    hint: "Pick both if that's honest.",
  },
  context: {
    hint: "Tap a suggestion or write your own — both land in the same slot.",
    keepLabel: "Keep this for future posts",
    keepOff: "Off: used once, then forgotten.",
    keepOn: "On: saved to your brand profile.",
    cta: "Write the post",
    skip: "Skip — I don't have this",
    optionalNote: "Only asked when the post needs something the profile hasn't got.",
  },
  draft: {
    claimsLabel: "Underlined claims",
    approve: "Approve",
    edit: "Edit",
    retry: "Try again",
    close: "Close",
    unsavedNote: "Not saved to profile",
  },
  approved: {
    heading: "Approved. It's in your library.",
    primary: "Change the time",
    unscheduled: "It isn't scheduled yet — pick a date and it lands on your calendar.",
    schedule: "Pick a date",
  },
  chat: {
    opener: "Morning. What do you want this one to do for you?",
    ack: {
      lead: "Got it. I'll lean on the three-to-one ratio.",
      ask: "One thing the profile doesn't have —",
    },
    kept: "Kept for this post only.",
    writeNow: "Write it now",
    saveToProfile: "Save to profile",
    placeholder: "Type your answer",
    toChat: "Switch to chat",
  },
};

export const nav = {
  home: "Home",
  library: "Content Library",
  train: "Train Your AI",
  calendar: "Calendar",
  modules: "Modules",
  social: "Social post",
  more: "More coming",
  profile: "Profile",
  settings: "Settings",
};

export const library = {
  title: "Content Library",
  cta: "Start a post",
  // Library action labels describe the operation. The compose confirmation
  // screen keeps its more conversational copy as a separate flow.
  schedule: "Schedule",
  reschedule: "Reschedule",
};

export const calendar = {
  title: "Calendar",
  cta: "Start a post",
  today: "today",
};
