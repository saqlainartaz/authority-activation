import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationScroll, type ConversationJump } from './conversation-scroll';

export function useConversationScroll() {
  const controller = useRef<ConversationScroll | null>(null);
  const [unread, setUnread] = useState(false);
  const [postVisible, setPostVisible] = useState(false);
  const [jump, setJump] = useState<ConversationJump>(null);
  const ref = useCallback((panel: HTMLDivElement | null) => {
    controller.current?.dispose();
    controller.current = panel ? new ConversationScroll(panel, (nextUnread, visible, nextJump) => { setUnread(nextUnread); setPostVisible(visible); setJump(nextJump); }) : null;
  }, []);
  // Text updates are not always a resize (e.g. a delta fits the existing line).
  useEffect(() => { controller.current?.update(); });
  return { ref, unread, postVisible, jump, latest: () => controller.current?.latest(), viewPost: () => controller.current?.viewPost(), viewResponse: () => controller.current?.viewResponse() };
}
