export type WorkspacePhase = 'empty' | 'reading' | 'streaming' | 'record';
export type WorkspaceConversationMessage =
  | { who: 'u'; text: string }
  | { who: 'a'; text: string; text2: string; strong: string };

/**
 * The writing starter is an entry state, not the idle state for an existing
 * conversation. A real agent can ask several questions before it has enough
 * material to create a draft, so transcript presence keeps the chat surface
 * open even after a turn has stopped streaming.
 */
export function showsConversation(phase: WorkspacePhase, messageCount: number): boolean {
  return phase !== 'empty' || messageCount > 0;
}

/** A conversation can be replaced before it has produced a draft. The
 * confirmation kind controls only the wording; both kinds expose the same
 * authoritative New-post operation. */
export function newPostConfirmationKind(
  phase: WorkspacePhase,
  messageCount: number,
  hasPersistedDraft: boolean,
): 'conversation' | 'draft' | null {
  if (!showsConversation(phase, messageCount)) return null;
  return hasPersistedDraft ? 'draft' : 'conversation';
}

/**
 * Connected drafts become visible only after the engine has returned a
 * persisted variant. The demo is the one exception: its local timer has no
 * server variant, so its established partial-draft animation remains visible.
 */
export function showsDraft(
  phase: WorkspacePhase,
  hasPersistedDraft: boolean,
  isDemo: boolean,
): boolean {
  return hasPersistedDraft || (isDemo && phase === 'streaming');
}

export function settledWorkspacePhase(hasPersistedDraft: boolean): WorkspacePhase {
  return hasPersistedDraft ? 'record' : 'empty';
}

/**
 * Keep the browser's immediate echo in the transcript until the authoritative
 * session read contains it. `useChatSession` has already removed echoes that
 * match newly persisted task rows, so this function only has to preserve their
 * order and place the live assistant text after them.
 */
export function assembleWorkspaceConversation(
  persisted: ReadonlyArray<{ role: string; body: string }>,
  pendingUserMessages: readonly string[],
  streamedAssistantText: string,
): WorkspaceConversationMessage[] {
  const conversation = persisted.reduce<WorkspaceConversationMessage[]>((messages, message) => {
    const body = message.body.trim();
    if (!body) return messages;
    if (message.role === 'user') {
      messages.push({ who: 'u', text: body });
    } else {
      const previous = messages.at(-1);
      if (previous?.who === 'a' && previous.text === body) return messages;
      messages.push({ who: 'a', text: body, text2: '', strong: '' });
    }
    return messages;
  }, []);
  conversation.push(...pendingUserMessages.map(text => ({ who: 'u' as const, text })));
  const streamed = streamedAssistantText.trim();
  const previous = conversation.at(-1);
  if (streamed && !(previous?.who === 'a' && previous.text === streamed)) {
    conversation.push({ who: 'a', text: streamed, text2: '', strong: '' });
  }
  return conversation;
}
