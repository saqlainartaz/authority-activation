// Isolated visual/component check. No application login, API or model request.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, server: { middlewareMode: true },
  esbuild: { jsx: 'automatic' },
});
let browser;
try {
  const { default: AssistantMarkdown } = await server.ssrLoadModule('/src/refined/AssistantMarkdown.tsx');
  const text = 'Based on your documents, there are three distinct audiences:\n\n'
    + '1. **Licensed professionals** need practical support and clear information.\n\n'
    + '2. **Business owners** want a focused approach that fits their work.\n\n'
    + '3. **Individual clients** need a clear explanation of the service.\n\n'
    + 'I would lead with **one audience**, rather than mixing all three.\n\n'
    + 'Would you like me to draft a post for that audience?';
  const markup = renderToStaticMarkup(createElement(AssistantMarkdown, { text }));
  const css = await readFile('src/refined/refined.css', 'utf8');
  const dark = await readFile('src/refined/dark.css', 'utf8');
  const output = await mkdtemp(path.join(os.tmpdir(), 'promo-markdown-review-'));
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      await page.setContent(`<html data-refined class="${theme === 'dark' ? 'dark' : ''}"><head><style>${css}\n${dark}
        body{margin:0;padding:24px;font-family:system-ui;background:var(--background)}
        main{max-width:720px;margin:auto}.rf-agent-message{animation:none!important}
        </style></head><body><main><div class="rf-agent-message"><span class="rf-agent-mark">PP</span><div>${markup}</div></div></main></body></html>`);
      const result = await page.evaluate(() => {
        const strong = document.querySelector('.rf-agent-markdown strong');
        return {
          weight: getComputedStyle(strong).fontWeight,
          color: getComputedStyle(strong).color,
          list: document.querySelectorAll('.rf-agent-markdown ol > li').length,
          markers: document.querySelector('.rf-agent-markdown').textContent.includes('**'),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(result.weight, '700');
      assert.equal(result.color, theme === 'dark' ? 'rgb(238, 237, 235)' : 'rgb(23, 23, 23)');
      assert.equal(result.list, 3);
      assert.equal(result.markers, false);
      assert.equal(result.overflow, false);
      const screenshot = path.join(output, `${theme}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(JSON.stringify({ theme, width, ...result, screenshot }));
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
