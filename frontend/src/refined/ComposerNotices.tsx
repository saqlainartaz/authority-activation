import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { COPY } from '@/shared/data';

/** The new-post suggestion's two actions (Cycle 5 P4.4; spec 10A.6). */
export type NewPostSuggestion = { onStart: () => void; onDismiss: () => void };

/** What the conversation says under the latest reply (Cycle 5 P2.6; spec 10A.3).
 *
 *  - `usageNotice`: 80% of a writing budget is used. Unobtrusive, a status line,
 *    because the reply goes ahead; it names the budget and when it resets.
 *  - `newPost`: the session is near the compaction threshold (P4.4), so a new
 *    post is suggested. The same quiet status line, with a "New post" action
 *    that opens the header's own New post confirmation, and a dismiss.
 *  - `agentNotice`: how the turn ended when it did not end in a reply, a limit
 *    refusal included ("Today's writing limit is reached. It resets at 00:00
 *    UTC."). Every terminal sentence has the same weight: an alert card.
 *
 *  Under M1 and the demo neither limit event nor the session-length event
 *  arrives, so only the existing terminal sentences ever show. */
export default function ComposerNotices({ usageNotice, agentNotice, newPost = null }: { usageNotice: string | null; agentNotice: string | null; newPost?: NewPostSuggestion | null }) {
  return <>
    {usageNotice && <p role="status" className="rf-usage-notice">{usageNotice}</p>}
    {newPost && <div role="status" className="rf-usage-notice rf-new-post-notice">
      <span>{COPY.newPostSuggestion}</span>
      <Button variant="link" size="sm" className="h-auto px-0" onClick={newPost.onStart}>{COPY.newPost}</Button>
      <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Dismiss" onClick={newPost.onDismiss}><X /></Button>
    </div>}
    {agentNotice && <Card role="alert"><CardContent className="p-4 text-sm text-muted-foreground">{agentNotice}</CardContent></Card>}
  </>;
}
