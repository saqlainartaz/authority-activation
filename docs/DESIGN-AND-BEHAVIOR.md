# Selected design and behavior

This describes the exported implementation after the latest decisions. It replaces the need to carry the earlier design experiments or historical decisions file into the integration repository.

## Promo Partner update — 2026-09-22

The client and operator-facing product is now displayed as **Promo Partner**. Home is calendar-led: the shared authoritative post/schedule projection supplies the month and selected-day agenda, while Library retains Table and Board only. Navigation has one writing destination, **Write a Post**, at the compatible `/refined/workspace` route.

Workspace supports the closed LinkedIn, Instagram, X and Facebook registry. Multi-selection runs one authoritative session/content item per channel and preserves completed channels if another turn fails. Each channel uses its own server-side skill/profile and produces a labelled draft. Post-generation Shorter, Longer and Punchier actions are compact revision chips that use the same revision path as typed instructions.

Each post version may bind one validated static JPEG, PNG or WebP image. Attach, preview, replace, remove, download, save/reopen and exact-version history are connected. Editing text or media creates an immutable version, invalidates approval and moves an existing slot to `needs_reapproval`; old media remains readable. Images are post media, never knowledge sources or model inputs.

Appearance remains in Settings with Light/Dark/System behavior. The sidebar theme control, “Only use my sources,” and the Learning section are absent. The established 768 px navigation and 1,180 px writing-layout boundaries remain.

## Visual system

The interface uses shadcn/ui on Base UI, with Lucide icons for product controls and shared Simple Icons brand marks for LinkedIn, Instagram, X and Facebook. Every social-channel surface routes through the same unboxed `ChannelMark` component rather than improvised letters or nested icon tiles. Workspace channel choices extend that mark into one horizontal pill: inactive channels are muted, while the selected pill uses its platform color and a quiet tinted background instead of a separate checkmark. The assistant conversation uses assistant-ui; calendars use React DayPicker. These are the selected libraries.

Workspace channel choices use compact, borderless brand icons without a redundant “Channels” label. LinkedIn is selected by default. A selected channel expands to show its name in a quiet branded pill; on phone layouts, two or more selected channels remain compact tinted icons so the composer does not crowd or overflow.

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

`ThemeProvider` stores Light/Dark/System under `authority-refined-appearance`. Light is the default when no preference exists. System follows media-query changes. Settings exposes all three choices on desktop and mobile; there is no sidebar appearance control. Toasts and portalled controls use the selected theme.

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
| `/refined/home` | Calendar-led Home dashboard |
| `/refined/workspace` | Fresh writing session |
| `/refined/workspace?post=<id>` | Load an existing local post |
| `/refined/workspace?welcome=1` | Post-onboarding welcome when setup is complete |
| `/refined/library` | Table/board post library |
| `/refined/train?tab=questions` | Pending training questions |
| `/refined/train?tab=knowledge` | Your data and Add files |
| `/refined/train?tab=guidance` | Guidance rules |
| `/refined/train` | Defaults to Guidance |
| `/refined/signin` | Sign-in and recovery states |
| `/refined/invite` | Invitation password setup |
| `/refined/onboarding` | First unanswered packet, or review if complete |

Settings is a modal/drawer opened from navigation, not a separate route. The standalone root redirects to Home to keep the prototype immediately reviewable; real authentication entry belongs to the destination integration.

## Home and navigation

Preserve the approved Home composition: greeting, dominant month calendar with selected-day agenda, and monthly/agent summary. Do not restore the removed duplicate writing hero. Mobile headers remain compact, and the active bottom-navigation destination has a subtle icon background and stronger label.

## Workspace

The fresh state presents a writing prompt, channel selection and templates. Desktop uses a small template grid. Phone uses one horizontal card carousel with previous/next controls, a visible count and a partial next card. Selecting a template fills the composer with a short, complete discovery request, not a dangling heading; browsing templates does not submit a prompt. The visible card names and descriptions remain unchanged.

The fresh state ends as soon as the user sends the first message. From that point the Workspace is a continuous chat: the submitted message remains visible, the agent exposes its current activity and streamed response, and clarification turns stay in the conversation instead of falling back to the starter prompt. Consecutive persisted assistant records may be grouped into one visual response, but their text must not be dropped or duplicated.

The chat remains the only main surface until the backend has produced an authoritative draft. Conversational prose and streaming deltas are not themselves a draft and must not open or populate the document pane. Once a persisted draft is available, desktop adds the right-hand document pane and compact layouts insert the draft into the conversation. Demo mode may retain its clearly identified fixture draft behavior.

**New post** is available as soon as a conversation exists, including while the agent is still clarifying and no draft has been produced. It opens a confirmation that distinguishes ending a conversation from discarding a draft. Confirmation calls the backend's authoritative `start_new_post` command, waits for success, then clears the old transcript and opens the replacement session. A failed replacement leaves the current conversation visible.

The agent is a conversational guide, not a questionnaire gate. Ordinary clarification replies should be concise, ask no more than one useful question, and avoid repeating an already answered question. “Choose for me,” “write about anything,” “what do my clients ask?” or a template that asks the agent to find an angle delegates topic discovery: use authenticated topic suggestions and a small set of active objections, pain points, insights, proof points and quotes to choose a specific retrieval subject instead of demanding another choice. Those discovery candidates are not citable draft material. An empty generation snapshot describes that attempted topic, not the whole account. When neither candidates nor retrieved evidence exist, offer a few clearly labelled hypotheses rather than inventing a client fact or repeating the server question. Questions such as “Who am I?” and “How much data do you have?” use a narrow authenticated overview of identity, extracted knowledge counts, represented sources, and onboarding suggestions; the answer must distinguish those account-wide facts from material frozen for a particular draft.

Desktop has a conversation and document pane, Write/Preview switching, evidence, editable draft text and a persistent footer beneath the document. That footer exposes **Keep as draft** and **Approve** directly, aligned right. There is no desktop Post actions dropdown.

Preview is presentation-only: it shows the author/channel treatment, image and publishable post body without attachment, text-editing or media-editing controls. Outside Preview, **Replace Image** and a compact delete icon form a right-aligned group in the existing view-control row. Compact Draft mode places a right-aligned, pen-labelled **Edit text** action after a quiet dotted divider and immediately before the post copy. It opens one full-post editor rather than separate paragraph fields; its toolbar supports bold, italic and bullet-list text formatting. The writing surface does not show the image filename, dimensions, download action or image-description field.

Compact layouts keep the full draft inside the conversation stream. Preview post changes that result in place. Evidence expands within the result. Keep as draft and Approve sit above the composer, outside the conversation scroller. The draft must remain visible on small screens, not disappear behind a canvas-only mode.

Shorter/Longer/Punchier are compact post-generation revision chips. They submit through the same current-draft revision path as typed changes and are disabled while conflicting work runs. Streaming exposes Stop. Stop ends the browser display, while New post replaces the persisted conversation; the compatible backend still cannot cancel a model turn already executing. A failed real operation should preserve the user's input and draft when the backend is connected.

The evidence lens distinguishes supported claims and unsupported material. Preview omits paragraphs marked as missing support. Manual paragraph edits clear their previous segment-level evidence metadata; the backend should recompute evidence for changed content rather than retaining stale citations.

Connected evidence must use the selected persisted version's receipt. **Show evidence** is enabled only when claim-level spans exist. It dims ordinary text, keeps supported spans legible and underlined, and exposes the receipt quote/source/locator from each numbered marker. A source label without claim offsets may still be listed, but must not be presented as sentence-level evidence. Missing locator fields remain absent rather than being replaced with invented text.

When the first authoritative draft arrives at or above 1,180 px, the document pane expands and fades in while the conversation remains mounted; below 1,180 px the inline result rises gently into the thread. Subsequent streamed conversation remains visible. Reduced-motion preference collapses these effects to effectively instantaneous changes. The transition does not delay, simulate, or manufacture the backend's draft-ready state.

Approve opens scheduling. The user may approve without a date or pick a date and time. Preserve the distinction between draft, approved and scheduled.

## Library

Library supports Table and Board; Calendar now belongs to Home and is not offered as a desktop tab or mobile choice. Mobile puts the remaining view picker in the refined header; search and Filters share a row, and table density is a separate Compact rows switch. Filters open a drawer on mobile rather than a horizontally overflowing toolbar.

The phone Board has status tabs and one vertical lane. Do not restore horizontally scrolling columns on the phone. The table keeps readable titles and status, with secondary columns hidden at narrow widths.

Opening a post gives its preview and scheduling actions. A scheduling success produces a persistent confirmation and a Change schedule action. Map this to a confirmed backend operation during integration.

## Train your AI

Questions use the centered dark question deck. Single-choice and multiple-selection questions each offer a custom written alternative. Short-text and long-text questions are also present. Saving requires a valid answer and removes that question from the pending deck; the remaining question index stays in range. There is no zero-count notification badge when caught up.

The onboarding auto-advance change does not change the training deck: Training continues to use Save answer. These are separate flows.

Guidance uses a numbered list with active rules first. Disabled rules move to the end and appear muted. Each row has an enable switch and edit action; Add opens the guidance editor. Preserve the simple list rather than introducing cards for every rule.

Knowledge has one **Your data** list containing all source types. **Add files** opens a dialog containing drag-and-drop and Choose files. Successful uploads appear in the same list. There is no separate Your documents section, no Sample knowledge heading, and no permanent upload panel ahead of the sources. Existing coverage cards remain above the list.

File details expose download and removal. Local unprocessed files are not presented as learned. When real processing is connected, preserve this distinction using the backend's actual status names.

## Settings

Keep the established Settings modal/drawer and its responsive section navigation. Appearance remains under Preferences with Light/Dark/System. “Only use my sources” and the Learning section were deliberately removed; grounding and provenance remain enforced independently of those removed controls.

## Sign-in and invitation

Desktop entry uses a split floating card: a dark brand/message panel beside a focused form. Phone stacks a shorter brand panel above the form. Password visibility, Caps Lock feedback, validation and recovery stay in the form flow. There is no open sign-up or social-login design.

Invitation setup has an email and password field; the real system must obtain that email from an invitation. Recovery stays within the entry card. Do not imply an email was sent when its backend request failed.

## Admin dashboard

The operator dashboard retains Overview, People, Sources, Knowledge, Voice profile, Access, and Held drafts with their existing backend operations. Its revised shell uses the client product's system type, black primary actions, white cards, warm gray secondary surfaces, quiet borders, and restrained motion while remaining clearly labelled **Operator**.

At 1,180 px and above, the operator shell uses a 238 px persistent client/module rail. Below 1,180 px, identity and client selection become compact rows and modules become a horizontally scrollable control rail above the work; the desktop sidebar must not consume most of a tablet or phone screen. At phone widths, controls stack without document-level horizontal overflow. Switching modules uses the existing short rise transition, and reduced-motion preference is respected.

The admin route owns an isolated stylesheet so these visual alignments do not leak admin utilities into the client workspace. Tailwind's source inventory must include `src/app/internal`; otherwise admin-only responsive grid utilities are absent from production output even when development type checks pass.

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
