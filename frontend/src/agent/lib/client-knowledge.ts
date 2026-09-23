import 'server-only';

import { escapeForBody, type ModelMessage } from '@/agent/transcript';
import { getClientKnowledgeContext } from '@/lib/product';

/** Always checked, not gated by wording or a successful semantic search.
 * Re-read each turn so edits/removals do not linger in an application cache.
 * Provider caching applies to identical text only, never across changed input.
 */
export async function readClientKnowledge(token: string): Promise<ModelMessage> {
  try {
    const corpus = await getClientKnowledgeContext(token);
    if (corpus.status === 'disabled') {
      return {
        role: 'user',
        content: '<client-knowledge trust="untrusted">{"status":"disabled"}</client-knowledge>',
      };
    }
    return {
      role: 'user',
      content: `<client-knowledge trust="untrusted">${escapeForBody(JSON.stringify(corpus))}</client-knowledge>`,
      cache: true,
    };
  } catch {
    // Missing is not empty. Keep the ordinary retrieval tools available.
    return {
      role: 'user',
      content: '<client-knowledge trust="untrusted">{"status":"unavailable","reason":"source_context_read_failed"}</client-knowledge>',
    };
  }
}
