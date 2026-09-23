import Markdown from 'react-markdown';

const elements = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'hr'];

/** Presentation only. Stored text, user messages and post evidence stay unchanged.
 * No raw HTML, remote images, embedded content or executable URL schemes.
 */
export default function AssistantMarkdown({ text }: { text: string }) {
  return <div className="rf-agent-markdown">
    <Markdown
      skipHtml
      allowedElements={elements}
      urlTransform={url => /^(https?:\/\/|mailto:)/i.test(url) ? url : undefined}
      components={{ a: ({ children, href }) => href
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        : <span>{children}</span> }}
    >{text}</Markdown>
  </div>;
}
