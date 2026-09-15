import type { ThreadMessageLike } from '@assistant-ui/react';
import type { Workspace } from './useWorkspace';

export function buildConversationMessages(ws: Workspace, inlineDraft: boolean): ThreadMessageLike[] {
    const turns: Array<{ id: string; role: 'user' | 'assistant'; text: string }> = [];
    ws.thread.filter(m => m.who !== 't').forEach((m, i) => {
      const role = m.who === 'u' ? 'user' : 'assistant';
      const text = m.who === 'a' ? `${m.text}\n\n${m.text2}${m.strong}`.trim() : m.text;
      const previous = turns.at(-1);
      if (role === 'assistant' && previous?.role === 'assistant') {
        previous.text = `${previous.text}\n\n${text}`.trim();
      } else {
        turns.push({ id: String(i), role, text });
      }
    });
    const result: ThreadMessageLike[] = turns.map(turn => ({ id: turn.id, role: turn.role, content: [{ type: 'text', text: turn.text }] }));
    if (inlineDraft && ws.showDraft) {
      const paragraphs = ws.fmt === 'x' && ws.phase === 'record' ? ws.xPosts.map(p => p.t) : ws.visible.done.map(p => p.segs.map(s => s.t).join('') + (p.miss ? ' [Needs a source]' : ''));
      const text = [...paragraphs, ...(ws.visible.partial ? [ws.visible.partial] : [])].join('\n\n');
      const draft: ThreadMessageLike = { id: 'current-draft', role: 'assistant', content: [{ type: 'text', text: `${ws.phase === 'streaming' ? 'Writing your draft' : ws.title} · ${ws.fmt === 'li' ? 'LinkedIn' : 'X'}\n\n${text || 'Starting your draft…'}` }] };
      // Keep the live draft next to the request that produced it, before the reply.
      const lastUser = result.map(m => m.role).lastIndexOf('user');
      result.splice(lastUser + 1, 0, draft);
    }
    return result;
}
