export type Packet = { id: string; type: 'choice' | 'pick_source' | 'multi' | 'short' | 'long'; why: string; headline: string; topic: string; required?: boolean; questionVersion?: string; quote?: string; source?: string; options?: { label: string; quote?: string; source?: string }[]; exclusiveChoices?: string[]; placeholder?: string; maxTextChars?: number };
export type SetupAnswer = { selected: string[]; text: string };
export type Setup = { answers: Record<string, SetupAnswer>; completed: boolean };
export const OTHER = '__other__';
export const PACKETS: Packet[] = [
  { id: 'work_today', type: 'choice', required: true, why: 'Clarify your current role.', headline: 'In your interview, you said you still see some therapy clients while directing the practice and creating retreats. Which best describes how you spend your working time today?', options: ['Mostly seeing therapy clients.', 'Mostly directing the practice and supporting the team.', 'Mostly creating or leading retreats and education.', 'My time is fairly evenly split across these.'].map(label => ({ label })), topic: 'Your work today' },
  { id: 'therapy_locations', type: 'multi', required: true, why: 'Choose all that apply.', headline: 'Your materials mention in-person and online therapy across Washington and California, but different clinicians may serve different locations. Where do you personally see therapy clients today? Choose all that apply.', options: ['In person in Washington.', 'Online with clients in Washington.', 'Online with clients in California.', 'I am not currently seeing therapy clients.'].map(label => ({ label })), exclusiveChoices: ['I am not currently seeing therapy clients.'], topic: 'Where you work' },
  { id: 'practice_start_year', type: 'choice', required: true, why: 'Clarify the conflicting year.', headline: 'One account says you started your private practice in 2015, while another says 2016. Which year is right?', options: ['2015.', '2016.', 'I would like to check before answering.'].map(label => ({ label })), topic: 'Founding year' },
  { id: 'retreat_role', type: 'multi', required: true, why: 'Choose all that apply.', headline: 'In your recorded interview, you explain that a trained team can run retreats when you cannot attend. Which parts do you personally handle for most retreats today? Choose all that apply.', options: ['Creating the retreat concept and programme.', 'Teaching or facilitating sessions.', 'Leading the experience on site.', 'Choosing or working with venues and partners.', 'Training and overseeing the retreat team.'].map(label => ({ label })), topic: 'Your role in retreats' },
  { id: 'retreat_misunderstanding', type: 'long', required: false, why: 'Add this if it is useful, or leave it for now.', headline: 'Your materials describe therapist retreats that bring together continuing education, travel, and time to rest. What do people often misunderstand about that experience, and how would you explain it in your own words?', placeholder: 'A few sentences are enough.', topic: 'A common misunderstanding' },
  { id: 'anything_else', type: 'long', required: false, why: 'Share anything we should know.', headline: 'Is there anything else you would like us to understand about your business or the work you do?', placeholder: 'Anything important that we have missed.', topic: 'Anything else' },
];
export function packetAnswer(packet: Packet, answer?: SetupAnswer): string[] | null {
  if (!answer) return null;
  const text = answer.text.trim();
  if (packet.maxTextChars !== undefined && Array.from(text).length > packet.maxTextChars) return null;
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
