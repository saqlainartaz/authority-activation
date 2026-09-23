import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime } from '@assistant-ui/react';
import { buildConversationMessages } from './conversation';
import type { Workspace } from './useWorkspace';
import AssistantMarkdown from './AssistantMarkdown';

function UserMessage() { return <MessagePrimitive.Root className="rf-user-message"><MessagePrimitive.Parts /></MessagePrimitive.Root>; }
const DraftResult = createContext<ReactNode>(null);
function AssistantMessage() {
  const draft = useContext(DraftResult);
  const isDraft = useAuiState(s => s.message.id === 'current-draft');
  if (isDraft && draft) return <MessagePrimitive.Root className="rf-result-message">{draft}</MessagePrimitive.Root>;
  return <MessagePrimitive.Root className="rf-agent-message"><span className="rf-agent-mark" aria-hidden="true">PP</span><div><MessagePrimitive.Parts components={{ Text: AssistantMarkdown }} /></div></MessagePrimitive.Root>;
}
export default function AgentThread({ ws, inlineDraft = false, draft }: { ws: Workspace; inlineDraft?: boolean; draft?: ReactNode }) {
  const messages = useMemo(() => buildConversationMessages(ws, inlineDraft), [ws.thread, ws.phase, ws.visible, ws.fmt, ws.title, ws.xPosts, inlineDraft]);
  const runtime = useExternalStoreRuntime({ messages, convertMessage: message => message, isRunning: ws.phase === 'streaming' || ws.phase === 'reading' || ws.typing, onNew: async message => { ws.askChange(message.content.filter(p => p.type === 'text').map(p => p.text).join('\n')); }, onCancel: async () => ws.stop() });
  return <DraftResult.Provider value={draft}><AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="rf-native-thread"><ThreadPrimitive.Viewport><ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} /></ThreadPrimitive.Viewport></ThreadPrimitive.Root></AssistantRuntimeProvider></DraftResult.Provider>;
}
