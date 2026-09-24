export type Packet = { id: string; type: 'choice' | 'pick_source' | 'multi' | 'short' | 'long'; why: string; headline: string; topic: string; required?: boolean; questionVersion?: string; quote?: string; source?: string; options?: { label: string; quote?: string; source?: string }[]; exclusiveChoices?: string[]; placeholder?: string; maxTextChars?: number };
export type SetupAnswer = { selected: string[]; text: string };
export type Setup = { answers: Record<string, SetupAnswer>; completed: boolean };
export const OTHER = '__other__';
export const PACKETS: Packet[] = [
  { id: 'sixty_day_hustle_role', type: 'choice', required: true, why: "Confirm your credit.", headline: "Public sources describe your role on 60 Day Hustle in different ways. Which describes it accurately?", options: ["I host it.", "I host it and I am a producer.", "I co-created it, host it and executive produce it."].map(label => ({ label })), topic: "60 Day Hustle" },
  { id: 'mawer_capital', type: 'choice', required: true, why: "Choose the closest answer.", headline: "How should your posts treat Mawer Capital today?", options: ["As an active brand I post about.", "Only as part of my past work.", "Leave it out of my posts."].map(label => ({ label })), topic: "Mawer Capital" },
  { id: 'content_focus', type: 'choice', required: true, why: "Choose the closest answer.", headline: "What should most of your posts focus on right now?", options: ["My personal brand.", "Inside Success TV.", "An even mix of both."].map(label => ({ label })), topic: "Your focus" },
  { id: 'istv_voice', type: 'multi', required: true, why: "Choose all that apply.", headline: "When you ask for a post written as Inside Success TV rather than as you, how should it sound? Choose all that apply.", options: ["Cinematic and inspiring.", "Warm and focused on our cast.", "Bold and energetic, like me.", "Professional and understated."].map(label => ({ label })), topic: "Inside Success TV's voice" },
  { id: 'usable_figures', type: 'long', required: false, why: "Add this if it is useful, or leave it for now.", headline: "Which revenue, ad-spend or growth figures from your websites may we use in posts, and for which business and time period?", placeholder: "For example: which figure, which business, which years.", topic: "Figures we can use" },
  { id: 'istv_turning_point', type: 'long', required: false, why: "Add this if it is useful, or leave it for now.", headline: "Tell us about one hard decision you made while building Inside Success TV: what you decided, what happened, and what you learned.", placeholder: "A few sentences are enough.", topic: "A turning point" },
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
