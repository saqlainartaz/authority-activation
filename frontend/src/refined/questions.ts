type QuestionBase = { id: string; why: string; title: string };
export type Question = QuestionBase & (
  | { kind: 'single' | 'multiple'; options: string[] }
  | { kind: 'short' | 'long'; placeholder: string }
);

export const OTHER_ANSWER = '__other__';
export const QUESTIONS: Question[] = [
  { id: 'clients', kind: 'single', why: 'Your drafts keep saying “a client” because the agent does not know this.', title: 'Can I name clients in a post?', options: ['Yes, name them', 'Only the ones who agreed', 'No, keep clients anonymous'] },
  { id: 'engine', kind: 'single', why: 'You called this an internal name during setup. Checking it never goes public.', title: 'Can “the Engine” appear in a post?', options: ['Yes, it is fine to say', 'No, say “our payroll system” instead'] },
  { id: 'voice', kind: 'single', why: 'Two openings for the same post. This shapes how every draft starts.', title: 'Which sounds more like you?', options: ['We spent four months building the wrong thing.', 'I want to share some reflections on a challenging quarter for our team.'] },
  { id: 'customers', kind: 'multiple', why: 'These become the posts that bring in calls. Pick all that apply.', title: 'What do customers ask you most?', options: ['How much will it cost', 'How long does it take', 'Do you guarantee the work', 'Have you done this before'] },
  { id: 'customer-name', kind: 'short', why: 'The agent should use the same words you use when you talk about your work.', title: 'What do you call the people you work with?', placeholder: 'Clients, members, partners…' },
  { id: 'changed-approach', kind: 'long', why: 'A real example helps the agent write from your experience.', title: 'Tell me about a time your approach changed.', placeholder: 'What happened, what did you change, and what did you learn?' },
];

// Preserve the existing saved-answer format while storing the actual written
// response, never the internal “Something else” selection marker.
export function getQuestionAnswer(question: Question, selected: string[], text: string): string[] | null {
  const written = text.trim();
  if (!('options' in question)) return written ? [written] : null;
  if (!selected.length || (selected.includes(OTHER_ANSWER) && !written)) return null;
  const choices = question.kind === 'single' ? selected.slice(0, 1) : selected;
  const answer = choices.flatMap(value => value === OTHER_ANSWER ? [written] : question.options.includes(value) ? [value] : []);
  return answer.length ? answer : null;
}
