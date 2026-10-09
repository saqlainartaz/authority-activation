import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime } from '@assistant-ui/react';
import { buildConversationMessages } from './conversation';
import type { Workspace } from './useWorkspace';
import ScheduleCard from './ScheduleCard';
import type { ScheduleProposals } from './useScheduleProposals';
import AssistantMarkdown from './AssistantMarkdown';

function UserMessage() { return <MessagePrimitive.Root className="rf-user-message"><MessagePrimitive.Parts /></MessagePrimitive.Root>; }
const DraftResult = createContext<ReactNode>(null);
const Proposals = createContext<ScheduleProposals | null>(null);
function AssistantMessage() {
  const draft = useContext(DraftResult);
  const proposals = useContext(Proposals);
  const messageId = useAuiState(s => s.message.id);
  const isDraft = messageId === 'current-draft';
  if (isDraft && draft) return <MessagePrimitive.Root className="rf-result-message" data-inline-post>{draft}</MessagePrimitive.Root>;
  // A schedule card: rendered from the server's record, acted on with the
  // client's own credential. The model never touches it.
  const proposal = messageId.startsWith('proposal:') ? proposals?.proposals.find(p => `proposal:${p.id}` === messageId) : undefined;
  if (proposal && proposals) {
    return (
      <MessagePrimitive.Root className="rf-agent-message">
        <span className="rf-agent-mark" aria-hidden="true">PP</span>
        <ScheduleCard
          proposal={proposal}
          busy={proposals.busy === proposal.id}
          error={proposals.errors[proposal.id]}
          onConfirm={when => void proposals.confirm(proposal.id, when)}
          onDecline={() => void proposals.decline(proposal.id)}
        />
      </MessagePrimitive.Root>
    );
  }
  return <MessagePrimitive.Root className="rf-agent-message"><span className="rf-agent-mark" aria-hidden="true">PP</span><div><MessagePrimitive.Parts components={{ Text: AssistantMarkdown }} /></div></MessagePrimitive.Root>;
}
export default function AgentThread({ ws, inlineDraft = false, draft }: { ws: Workspace; inlineDraft?: boolean; draft?: ReactNode }) {
  const messages = useMemo(() => buildConversationMessages(ws, inlineDraft), [ws.thread, ws.phase, ws.visible, ws.fmt, ws.title, ws.xPosts, ws.proposals.proposals, inlineDraft]);
  const runtime = useExternalStoreRuntime({ messages, convertMessage: message => message, isRunning: ws.phase === 'streaming' || ws.phase === 'reading' || ws.typing, onNew: async message => { ws.askChange(message.content.filter(p => p.type === 'text').map(p => p.text).join('\n')); }, onCancel: async () => ws.stop() });
  return <Proposals.Provider value={ws.proposals}><DraftResult.Provider value={draft}><AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="rf-native-thread"><ThreadPrimitive.Viewport autoScroll={false} scrollToBottomOnRunStart={false} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false}><ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} /></ThreadPrimitive.Viewport></ThreadPrimitive.Root></AssistantRuntimeProvider></DraftResult.Provider></Proposals.Provider>;
}
