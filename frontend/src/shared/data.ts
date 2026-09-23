// Shared mock data for every system in the bake-off. Same copy, same posts, same claims.
import { CHANNELS, type Channel } from './channels';
export type { Channel } from './channels';
export type Seg = { t: string; claim?: { n: string; bad?: boolean } };
export type Para = { g: '' | 'c' | 'm'; segs: Seg[]; miss?: boolean };
export type Source = { n: string; t: string; loc: string; quote?: string; mark?: string; bad?: boolean };
export type Version = { paras: Para[]; sources: Source[]; count: string };

export const paraText = (p: Para) => p.segs.map((s) => s.t).join('');
export const versionChars = (v: Version) => v.paras.reduce((a, p) => a + paraText(p).length + 1, 0);

export const FULL: Version = {
  paras: [
    { g: '', segs: [{ t: 'Three years ago we charged a setup fee. Then a client asked what it was for, and I did not have a good answer.' }] },
    { g: 'c', segs: [{ t: 'We had been billing it since the month we opened, and by then it was ' }, { t: 'just under a fifth of what a new client paid us in year one', claim: { n: '1' } }, { t: '. Nobody internally could say what work it covered.' }] },
    { g: 'c', segs: [{ t: 'So we dropped it. What I did not expect: ' }, { t: 'deals started closing eleven days faster', claim: { n: '2' } }, { t: ', because the fee was the thing procurement always wanted to argue about.' }] },
    { g: 'm', miss: true, segs: [{ t: 'Most agencies still charge one, and ' }, { t: 'the average is around four thousand pounds', claim: { n: '?', bad: true } }, { t: '.' }] },
    { g: '', segs: [{ t: 'If you charge a setup fee, ask your own team what it buys. If nobody can answer in a sentence, your clients cannot either.' }] },
  ],
  sources: [
    { n: '1', t: 'FY23 revenue breakdown', loc: 'sheet 2, row 14' },
    { n: '2', t: 'Pipeline review, 4 Mar', loc: '00:14:22' },
    { n: '?', t: 'Competitor pricing', loc: 'no source', bad: true },
  ],
  count: '1,214 / 3,000',
};

export const SHORT: Version = {
  paras: [
    { g: '', segs: [{ t: 'Three years ago we charged a setup fee. A client asked what it was for. I had no answer.' }] },
    { g: 'c', segs: [{ t: 'It was ' }, { t: 'just under a fifth of what a new client paid us in year one', claim: { n: '1' } }, { t: ', and nobody could say what work it covered.' }] },
    { g: 'c', segs: [{ t: 'We dropped it. ' }, { t: 'Deals started closing eleven days faster', claim: { n: '2' } }, { t: ', because the fee was the thing procurement argued about. If you charge one, ask your team what it buys.' }] },
  ],
  sources: [
    { n: '1', t: 'FY23 revenue breakdown', loc: 'sheet 2, row 14' },
    { n: '2', t: 'Pipeline review, 4 Mar', loc: '00:14:22' },
  ],
  count: '612 / 3,000',
};

export const XPOSTS = [
  { t: 'Three years ago we charged a setup fee. A client asked what it was for. I had no answer.', n: '98 / 280' },
  { t: 'It was nearly a fifth of year-one revenue from a new client. Nobody could say what work it covered.', n: '112 / 280' },
  { t: 'We dropped it. Deals closed eleven days faster. The fee was the thing procurement argued about.', n: '104 / 280' },
  { t: 'If you charge one, ask your team what it buys. If nobody can answer in a sentence, your clients cannot either.', n: '119 / 280' },
];

export const CITES: Record<string, { q: string; mark?: string; s: string; loc: string; bad?: boolean }> = {
  '1': { q: 'by the end of FY23 the setup line was ', mark: '18.6% of first-year revenue', s: 'FY23 revenue breakdown', loc: 'sheet 2, row 14' },
  '2': { q: 'since we pulled the fee the average has come down from 34 days to ', mark: '23, so call it eleven days faster', s: 'Pipeline review, 4 Mar', loc: '00:14:22' },
  '?': { q: 'No passage in your material supports this figure.', s: 'Competitor pricing', loc: 'no source', bad: true },
};

export const TITLE = 'Why we stopped charging setup fees';
export const DEMO_MSG = 'We killed the setup fee last year. Write something about it, honest tone, not a brag.';
export const REPLY_FULL = { text: 'Here it is. I pulled the revenue share from your FY23 breakdown and the eleven days from the March pipeline review.', text2: 'One line has no source: the four thousand pound average for other agencies. ', strong: 'It is marked, and it will not appear in Preview.' };
export const REPLY_SHORT = { text: 'Cut the unsourced line and tightened the opening.', text2: '', strong: 'Two paragraphs shorter, both claims still sourced.' };
export const REPLY_OTHER = { text: 'Not in this prototype, but this is where the change would land: the sheet rewrites in place and the conversation keeps going.', text2: '', strong: '' };

export const TEMPLATES = [
  { id: 'how', name: 'How you do it', line: 'One part of your process, and why it works.', starter: 'What process do I explain most clearly in my material? Choose one and write a post about how I do it.' },
  { id: 'win', name: 'A client win', line: 'A result you got for a client, named or not.', starter: 'What is my strongest client win? Find one in my material and write a post about it.' },
  { id: 'mistake', name: 'A mistake', line: 'What went wrong and what you changed.', starter: 'What is a mistake I have talked about? Choose one from my material and write a post about what changed.' },
  { id: 'question', name: 'A customer question', line: 'Something clients keep asking you, answered straight.', starter: 'What is a question clients keep asking me? Find one in my material and write a post answering it.' },
];

export type Status = 'draft' | 'approved' | 'scheduled' | 'posted';
export type Post = { id: number | string; ch: Channel; name: string; snip: string; status: Status; created: string; when?: string; day?: number };
export const POSTS: Post[] = [
  { id: 1, ch: 'li', name: 'Why we stopped using spreadsheets', snip: 'Nine tabs. Four owners. Zero source of truth.', status: 'approved', created: '2 Mar' },
  { id: 2, ch: 'li', name: 'Q4 launch announcement', snip: 'We spent four months building the wrong thing.', status: 'scheduled', created: '2 Mar', when: 'Wed 4 Mar, 09:00', day: 4 },
  { id: 7, ch: 'li', name: 'What our onboarding actually costs', snip: 'Three days, not six weeks. Here is the maths.', status: 'scheduled', created: '3 Mar', when: 'Wed 4 Mar, 12:30', day: 4 },
  { id: 3, ch: 'x', name: 'Northfield Roofing story', snip: 'Dave had not posted in two years.', status: 'scheduled', created: '1 Mar', when: 'Fri 6 Mar, 12:30', day: 6 },
  { id: 4, ch: 'li', name: 'Three things I got wrong', snip: 'I hired too early, priced too low.', status: 'scheduled', created: '27 Feb', when: 'Thu 5 Mar, 09:00', day: 5 },
  { id: 5, ch: 'x', name: 'Hiring: senior engineer', snip: 'Not because we are scaling. Because we are shipping.', status: 'scheduled', created: '1 Mar', when: 'Wed 4 Mar, 17:00', day: 4 },
  { id: 6, ch: 'li', name: 'Why we stopped charging setup fees', snip: 'Then a client asked what it was for.', status: 'draft', created: 'Today' },
  { id: 8, ch: 'ig', name: 'Behind the launch', snip: 'The bit nobody saw: three discarded prototypes.', status: 'draft', created: 'Today' },
  { id: 9, ch: 'fb', name: 'A note to our clients', snip: 'Thank you for asking the difficult questions.', status: 'approved', created: '1 Mar' },
];
export const FILTER_LABEL: Record<string, string> = { all: 'All', draft: 'Drafts', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted' };
export const VIEW_LABEL: Record<string, string> = { table: 'Table', board: 'Board', calendar: 'Calendar' };
export const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted' };
export const CHANNEL_LABEL: Record<Channel, string> = Object.fromEntries(
  Object.entries(CHANNELS).map(([key, channel]) => [key, channel.label]),
) as Record<Channel, string>;
export const PERSON = { name: 'Saqlain Artaz', headline: 'Founder at InsideSuccess', initials: 'SA' };
export const COPY = {
  fresh: 'What are you working on today?',
  freshSub: 'Tell it what happened, or start from one of these.',
  placeholder: 'Tell it what happened this week, or paste a link.',
  changePlaceholder: 'Ask for a change',
  templates: 'Start with one of these',
  channels: 'Channels',
  reading: 'Reading 4 sources',
  writing: (i: number, n: number) => `Writing… ${i} of ${n} paragraphs`,
  trace: (n: number) => `▸ Read 4 sources · wrote ${n} paragraphs`,
  changes: ['Shorter', 'Longer', 'Punchier'],
  evidenceFull: '2 claims from 2 sources · 1 needs a source',
  evidenceShort: '2 claims from 2 sources · all sourced',
  conversation: 'Conversation',
  openConversation: 'Open the conversation',
  keep: 'Keep as draft',
  approve: 'Approve',
  newPost: 'New post',
  discardTitle: 'Start a new post?',
  discardBody: 'This draft has not been kept or approved. Starting a new post discards it, and the conversation with it.',
  endConversationBody: 'Starting a new post ends this conversation and opens a fresh one. This cannot be undone.',
  keepEditing: 'Keep editing',
  keepTalking: 'Keep talking',
  discard: 'Discard and start new',
  endConversation: 'End and start new',
  kept: 'Kept as a draft. It is in your Library.',
  approved: 'Approved, no date yet. It is in your Library.',
  scheduled: (l: string) => `Scheduled for ${l}. It is in your Library.`,
};
