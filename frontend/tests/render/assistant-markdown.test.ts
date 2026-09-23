import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssistantMarkdown from '@/refined/AssistantMarkdown';

const render = (text: string) => renderToStaticMarkup(createElement(AssistantMarkdown, { text }));

describe('assistant conversation Markdown', () => {
  it('renders bold audience labels and real numbered lists', () => {
    const html = render('Three audiences:\n\n1. **Licensed professionals** need support.\n\n2. **Business owners** need clarity.');
    expect(html).toContain('<strong>Licensed professionals</strong>');
    expect(html).toContain('<strong>Business owners</strong>');
    expect(html).toContain('<ol>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).not.toContain('**');
  });

  it('supports paragraphs, bullet lists, italics and inline code', () => {
    const html = render('First paragraph.\n\n- *One* idea\n- Use `code`\n\nLast paragraph.');
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<em>One</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('tolerates unfinished streaming emphasis and formats it when complete', () => {
    expect(render('Start **important')).toContain('important');
    expect(render('Start **important**')).toContain('<strong>important</strong>');
  });

  it('does not render raw HTML, remote images or executable links', () => {
    const html = render('<script>alert(1)</script>\n\n<img src="https://tracker.example/x" onerror="alert(1)">\n\n![tracking](https://tracker.example/y)\n\n[bad](javascript:alert%281%29)');
    expect(html).not.toMatch(/<script|<img|onerror=|href="javascript:/i);
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('bad');
  });

  it('opens safe explicit links separately without an opener', () => {
    const html = render('[Source](https://example.com/source)');
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
