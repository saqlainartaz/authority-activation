# Selected design and behavior

This describes the exported implementation after the latest decisions. It replaces the need to carry the earlier design experiments or historical decisions file into the integration repository.

## Visual system

The interface uses shadcn/ui on Base UI, with Lucide icons. The assistant conversation uses assistant-ui; calendars use React DayPicker. These are the selected libraries. No alternate component library is needed to run this folder.

Interface text uses the operating-system sans-serif stack. Draft prose, source quotations and selected numerical statistics use Iowan Old Style/Georgia/Times New Roman fallbacks. There are no custom font downloads, photography or external image dependencies. Preserve the deliberate distinction between UI text and writing content.

Light mode uses white main surfaces, warm gray secondary surfaces, quiet borders and dark primary actions. The Home writing card and the training question deck use the existing dark gradient. Rounded controls and restrained spacing belong to the existing product; backend integration should not introduce an unrelated dashboard theme.

Dark mode uses charcoal surfaces rather than color inversion. Representative tokens:

| Role | Light | Dark |
| --- | --- | --- |
| Main background | `#ffffff` | `#18191b` |
| Main text | `#171717` | `#eeedeb` |
| Muted surface | `#f6f5f3` | `#222326` |
| Secondary text | `#666461` | `#aaa8a4` |
| Border | `#e7e5e2` | `#36373b` |
| Primary fill | `#171717` | `#eeedeb` |

The full token definitions are in `refined.css`, `dark.css` and `styles/shadcn.css`. Component-specific styles remain in their existing CSS files; those files, not this abbreviated table, are the source of truth for exact values.

`ThemeProvider` stores Light/Dark/System under `authority-refined-appearance`. Light is the default when no preference exists. System follows media-query changes. A desktop sidebar control switches modes; Settings → Preferences exposes all three choices on desktop and mobile. Toasts and portalled controls use the selected theme.

Theme scope is attached to `<html data-refined>` with a `.dark` class so dialogs and menus rendered outside the page subtree receive the same tokens. Tailwind preflight and base styles still affect the document. When merging with a host frontend, reconcile those global styles and the host's theme ownership; avoid having two providers fight over the same root class.

## Responsive rules

- Below 768 px: bottom navigation replaces the sidebar, headers retain compact branding, and controls are sized for touch.
- From 768 px: the sidebar is available, with expanded width 190 px and collapsed width 56 px.
- Below 1180 px: Workspace displays the draft inside the conversation.
- From 1180 px: Workspace uses conversation plus a separate draft pane.

The export removes the comparison harness's `?m=1`, `?frame=1` and art-direction helpers. Layout now follows actual viewport width. Keep the thresholds consistent across `shared/frame.ts`, the sidebar hook and media queries.

## Routes

| Route | Behavior |
| --- | --- |
| `/refined/home` | Home dashboard |
| `/refined/workspace` | Fresh writing session |
| `/refined/workspace?post=<id>` | Load an existing local post |
| `/refined/workspace?welcome=1` | Post-onboarding welcome when setup is complete |
| `/refined/library` | Table/board/calendar post library |
| `/refined/train?tab=questions` | Pending training questions |
| `/refined/train?tab=knowledge` | Your data and Add files |
| `/refined/train?tab=guidance` | Guidance rules |
| `/refined/train` | Defaults to Guidance |
| `/refined/signin` | Sign-in and recovery states |
| `/refined/invite` | Invitation password setup |
| `/refined/onboarding` | First unanswered packet, or review if complete |

Settings is a modal/drawer opened from navigation, not a separate route. The standalone root redirects to Home to keep the prototype immediately reviewable; real authentication entry belongs to the destination integration.

## Home and navigation

Preserve the Home composition: greeting, dark writing call-to-action, today's scheduled posts and the monthly/agent summary. Mobile headers were deliberately restored after removal made the product feel empty. Keep them compact rather than deleting them again. The active bottom-navigation destination has a subtle icon background and stronger label.

## Workspace

The fresh state presents a writing prompt, channel selection and templates. Desktop uses a small template grid. Phone uses one horizontal card carousel with previous/next controls, a visible count and a partial next card. Selecting a template fills the composer; browsing templates does not submit a prompt.

Desktop has a conversation and document pane, Write/Preview switching, evidence, editable draft text and a persistent footer beneath the document. That footer exposes **Keep as draft** and **Approve** directly, aligned right. There is no desktop Post actions dropdown.

Compact layouts keep the full draft inside the conversation stream. Preview post changes that result in place. Evidence expands within the result. Keep as draft and Approve sit above the composer, outside the conversation scroller. The draft must remain visible on small screens, not disappear behind a canvas-only mode.

Shorter/Longer/Punchier suggestion chips were removed. The user types requested changes. Streaming exposes Stop. A failed real operation should preserve the user's input and draft when the backend is connected.

The evidence lens distinguishes supported claims and unsupported material. Preview omits paragraphs marked as missing support. Manual paragraph edits clear their previous segment-level evidence metadata; the backend should recompute evidence for changed content rather than retaining stale citations.

Approve opens scheduling. The user may approve without a date or pick a date and time. Preserve the distinction between draft, approved and scheduled.

## Library

Desktop supports Table, Board and Calendar. Mobile puts the view picker in the refined header; search and Filters share a row, and table density is a separate Compact rows switch. Filters open a drawer on mobile rather than a horizontally overflowing toolbar.

The phone Board has status tabs and one vertical lane. Do not restore horizontally scrolling columns on the phone. The table keeps readable titles and status, with secondary columns hidden at narrow widths.

Opening a post gives its preview and scheduling actions. A scheduling success produces a persistent confirmation and a Change schedule action. Map this to a confirmed backend operation during integration.

## Train your AI

Questions use the centered dark question deck. Single-choice and multiple-selection questions each offer a custom written alternative. Short-text and long-text questions are also present. Saving requires a valid answer and removes that question from the pending deck; the remaining question index stays in range. There is no zero-count notification badge when caught up.

The onboarding auto-advance change does not change the training deck: Training continues to use Save answer. These are separate flows.

Guidance uses a numbered list with active rules first. Disabled rules move to the end and appear muted. Each row has an enable switch and edit action; Add opens the guidance editor. Preserve the simple list rather than introducing cards for every rule.

Knowledge has one **Your data** list containing all source types. **Add files** opens a dialog containing drag-and-drop and Choose files. Successful uploads appear in the same list. There is no separate Your documents section, no Sample knowledge heading, and no permanent upload panel ahead of the sources. Existing coverage cards remain above the list.

File details expose download and removal. Local unprocessed files are not presented as learned. When real processing is connected, preserve this distinction using the backend's actual status names.

## Settings

Keep the sections Account, Preferences, Usage and Data. On mobile the initial section navigation leads to one section at a time, with a Back action. Preferences contains appearance, writing/learning preferences and scheduling timezone. The desktop form uses the same information structure.

## Sign-in and invitation

Desktop entry uses a split floating card: a dark brand/message panel beside a focused form. Phone stacks a shorter brand panel above the form. Password visibility, Caps Lock feedback, validation and recovery stay in the form flow. There is no open sign-up or social-login design.

Invitation setup has an email and password field; the real system must obtain that email from an invitation. Recovery stays within the entry card. Do not imply an email was sent when its backend request failed.

## Onboarding

The latest decisions are:

1. Present one question at a time with progress and Back navigation.
2. Choosing an ordinary single-choice answer advances immediately.
3. Choosing Something else reveals a writing field and stays on the question.
4. Multiple-selection questions and text questions wait for Next.
5. Keep source excerpts available through **View source context**, collapsed by default. Quotes are not inserted into every choice label.
6. Do not show the removed keep-open-for-follow-up checkbox or its review badge.
7. Review all answers with Change actions before Open my workspace.

Single-choice edits from review return directly to review. Other edits use Save answer. Selecting the already-selected value after going Back does not emit a new radio change; Next remains available. Keyboard number selection uses the same advancement rule. Written answers must contain non-whitespace content; selecting a custom answer without writing is invalid.

## What integration should preserve

Connect data and behavior while retaining the selected layout, responsive rules, source-context treatment and action placement. If a real backend constraint requires a change, make it explicit in that repository's product decision record. The older exploratory designs are intentionally absent from this handoff.
