export type Packet = { id: string; type: 'choice' | 'pick_source' | 'multi' | 'short' | 'long'; why: string; headline: string; topic: string; required?: boolean; questionVersion?: string; quote?: string; source?: string; options?: { label: string; quote?: string; source?: string }[]; placeholder?: string };
export type SetupAnswer = { selected: string[]; text: string };
export type Setup = { answers: Record<string, SetupAnswer>; completed: boolean };
export const OTHER = '__other__';
export const PACKETS: Packet[] = [
  { id: 'audience', type: 'choice', why: 'Checking our reading of your calls.', headline: 'Do you sell to restaurant groups with several sites?', quote: '“Northwind runs fourteen locations across three states.”', source: 'What we heard · Discovery call, Marcus Bell · 00:03:05', options: ['Yes', 'Yes, and single sites too', 'No, not restaurants specifically'].map(label => ({ label })), topic: 'Who you sell to' },
  { id: 'timing', type: 'pick_source', why: 'Two of your sources say different things. Which one is true?', headline: 'How long does onboarding take?', options: [{ label: 'Three days', quote: '“Onboarding now takes three days.”', source: 'Ops weekly, 25 Aug · p. 1' }, { label: 'About six weeks', quote: '“Migration takes about six weeks.”', source: 'Website · Services page' }], topic: 'Onboarding length' },
  { id: 'services', type: 'multi', why: 'Nothing in your material covers this. Pick all that apply.', headline: 'Which of these do you sell?', options: ['Payroll', 'Compliance', 'Scheduling', 'Consulting'].map(label => ({ label })), topic: 'What you sell' },
  { id: 'engine', type: 'short', why: 'You mention this in calls, but we could not work out what it is.', headline: 'What is “the Engine”?', placeholder: 'A few words is enough.', topic: '“The Engine”' },
  { id: 'company', type: 'long', why: 'This ends up in almost every post.', headline: 'In a sentence or two, what does the company do?', placeholder: 'Plain words beat a tagline.', topic: 'What the company does' },
];
export function packetAnswer(packet: Packet, answer?: SetupAnswer): string[] | null {
  if (!answer) return null;
  const text = answer.text.trim();
  if (!packet.options) return text ? [text] : null;
  if (!answer.selected.length || (answer.selected.includes(OTHER) && !text)) return null;
  const selected = packet.type === 'multi' ? answer.selected : answer.selected.slice(0, 1);
  const values = selected.flatMap(value => value === OTHER ? [text] : packet.options!.some(o => o.label === value) ? [value] : []);
  return values.length ? values : null;
}
export function canContinue(packet: Packet, answer?: SetupAnswer): boolean {
  if (packetAnswer(packet, answer)) return true;
  const attempted = Boolean(answer && (answer.selected.length || answer.text.trim()));
  return packet.required === false && !attempted;
}
export function setupComplete(setup: Setup, packets: readonly Packet[] = PACKETS): boolean { return packets.every(packet => canContinue(packet, setup.answers[packet.id])); }
export function advancesOnChoice(packet: Packet, value: string): boolean {
  return (packet.type === 'choice' || packet.type === 'pick_source') && value !== OTHER && !!packet.options?.some(option => option.label === value);
}
export function restoreSetup(value: unknown): Setup {
  const empty: Setup = { answers: {}, completed: false };
  if (!value || typeof value !== 'object') return empty;
  const saved = value as Partial<Setup>;
  if (!saved.answers || typeof saved.answers !== 'object') return empty;
  const answers: Setup['answers'] = {};
  for (const packet of PACKETS) {
    const answer = saved.answers[packet.id];
    if (answer && Array.isArray(answer.selected) && answer.selected.every(s => typeof s === 'string') && typeof answer.text === 'string') answers[packet.id] = { selected: answer.selected, text: answer.text };
  }
  const setup = { answers, completed: false };
  setup.completed = saved.completed === true && setupComplete(setup);
  return setup;
}
