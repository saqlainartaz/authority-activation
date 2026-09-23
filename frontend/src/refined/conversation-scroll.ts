export type ConversationJump = 'post-up' | 'post-down' | 'response' | null;
/** One scroll owner for the workspace. Never scroll the document/body. */
export class ConversationScroll {
  private following = true;
  private explicitFollow = false;
  private lastTop = 0;
  private observer: ResizeObserver;

  constructor(private panel: HTMLElement, private notify: (unread: boolean, postVisible: boolean, jump: ConversationJump) => void) {
    this.lastTop = panel.scrollTop;
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(panel);
    if (panel.firstElementChild) this.observer.observe(panel.firstElementChild);
    panel.addEventListener('scroll', this.onScroll);
  }

  private draftVisible() {
    const draft = this.panel.querySelector<HTMLElement>('[data-inline-post]');
    if (!draft) return false;
    const bounds = this.panel.getBoundingClientRect();
    const post = draft.getBoundingClientRect();
    return post.bottom > bounds.top && post.top < bounds.bottom;
  }

  private atBottom() {
    return this.panel.scrollHeight - this.panel.scrollTop - this.panel.clientHeight < 32;
  }

  private responseAfterPost() {
    const post = this.panel.querySelector('[data-inline-post]');
    return post ? Array.from(this.panel.querySelectorAll<HTMLElement>('.rf-agent-message'))
      .find(response => Boolean(post.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING)) : undefined;
  }

  private navigation(): ConversationJump {
    const post = this.panel.querySelector<HTMLElement>('[data-inline-post]');
    if (!post) return null;
    const bounds = this.panel.getBoundingClientRect();
    const rect = post.getBoundingClientRect();
    if (rect.top >= bounds.bottom) return 'post-down';
    if (rect.bottom <= bounds.top) return 'post-up';
    const response = this.responseAfterPost();
    return response && response.getBoundingClientRect().top >= bounds.bottom ? 'response' : null;
  }

  private report(unread = !this.atBottom()) {
    this.notify(unread, this.draftVisible(), this.navigation());
  }

  private onScroll = () => {
    const up = this.panel.scrollTop < this.lastTop - 1;
    if (up) this.explicitFollow = false;
    this.following = !up && this.atBottom() && (this.explicitFollow || !this.draftVisible());
    this.lastTop = this.panel.scrollTop;
    this.report();
  };

  update() {
    if (!this.explicitFollow && this.draftVisible()) this.following = false;
    if (this.following) {
      this.panel.scrollTop = this.panel.scrollHeight;
      this.lastTop = this.panel.scrollTop;
      this.report(false);
    } else {
      this.report();
    }
  }

  latest() {
    this.explicitFollow = true;
    this.following = true;
    this.update();
  }

  viewPost() {
    const draft = this.panel.querySelector<HTMLElement>('[data-inline-post]');
    if (draft) this.jumpTo(draft);
  }

  viewResponse() {
    const response = this.responseAfterPost();
    if (response) this.jumpTo(response);
  }

  private jumpTo(target: HTMLElement) {
    this.explicitFollow = false;
    this.following = false;
    this.panel.scrollTop += target.getBoundingClientRect().top - this.panel.getBoundingClientRect().top - 12;
    this.lastTop = this.panel.scrollTop;
    this.report();
  }

  dispose() {
    this.observer.disconnect();
    this.panel.removeEventListener('scroll', this.onScroll);
  }
}
