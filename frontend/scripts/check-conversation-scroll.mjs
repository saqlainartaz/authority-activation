// Synthetic local browser test of the actual scroll controller. No API/model calls.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'scroll-fixture', configureServer(vite) {
    vite.middlewares.use('/scroll-check', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html><body style="margin:0"><div id="panel" style="height:400px;overflow:auto;overflow-anchor:none"><div id="content"><div style="height:700px">Earlier messages</div><div id="reply" style="height:200px">Response</div></div></div><button id="latest">New response</button><button id="post">View post</button><script type="module">
      import { ConversationScroll } from '/src/refined/conversation-scroll.ts';
      const panel = document.querySelector('#panel');
      window.control = new ConversationScroll(panel, unread => { document.querySelector('#latest').hidden = !unread; });
      document.querySelector('#latest').onclick = () => window.control.latest();
      document.querySelector('#post').onclick = () => window.control.viewPost();
      window.control.update(); window.ready = true;
      </script></body></html>`);
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`${server.resolvedUrls.local[0]}scroll-check`);
    await page.waitForFunction(() => window.ready);
    const top = () => page.locator('#panel').evaluate(el => el.scrollTop);
    const grow = () => page.locator('#reply').evaluate(el => { el.style.height = `${el.offsetHeight + 200}px`; });
    await page.waitForFunction(() => document.querySelector('#panel').scrollTop === 500);
    await grow();
    await page.waitForFunction(() => document.querySelector('#panel').scrollTop === 700);
    // Explicit scroll away from the live edge must survive subsequent deltas.
    await page.locator('#panel').evaluate(el => { el.scrollTop = 100; });
    await page.waitForTimeout(60);
    await grow();
    await page.locator('#latest').waitFor({ state: 'visible' });
    assert.equal(await top(), 100);
    await page.click('#latest');
    await grow();
    await page.waitForFunction(() => document.querySelector('#panel').scrollTop === 1100);
    // A post now enters the viewport before the response, as in compact Workspace.
    await page.evaluate(() => {
      window.control.dispose();
      document.querySelector('#content').innerHTML = '<div style="height:100px">Request</div><div data-inline-post style="height:700px">Post</div><div id="reply" style="height:200px">Response</div>';
      document.querySelector('#panel').scrollTop = 0;
    });
    await page.evaluate(async () => {
      const { ConversationScroll } = await import('/src/refined/conversation-scroll.ts');
      window.control = new ConversationScroll(document.querySelector('#panel'), unread => { document.querySelector('#latest').hidden = !unread; });
      window.control.update();
    });
    await grow();
    await page.waitForTimeout(60);
    assert.equal(await top(), 0, 'visible post must not be pulled offscreen');
    await page.click('#latest');
    await grow();
    await page.waitForFunction(() => document.querySelector('#panel').scrollTop === 1000);
    await page.click('#post');
    const postTop = await top();
    assert.equal(postTop, 88);
    await grow();
    await page.waitForTimeout(60);
    assert.equal(await top(), postTop, 'View post pauses following');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'never scroll the page');
    await page.evaluate(async () => {
      window.control.dispose();
      document.querySelector('#content').innerHTML = '<div style="height:700px">Earlier</div><div data-inline-post style="height:700px">Post</div><div class="rf-agent-message" id="reply" style="height:1200px">Response</div>';
      const { ConversationScroll } = await import('/src/refined/conversation-scroll.ts');
      window.control = new ConversationScroll(document.querySelector('#panel'), (_unread, _visible, jump) => { window.jump = jump; });
      window.control.viewPost();
    });
    await page.waitForFunction(() => window.jump === 'response');
    await page.locator('#panel').evaluate(el => { el.scrollTop = 0; });
    await page.waitForFunction(() => window.jump === 'post-down');
    await page.evaluate(() => window.control.viewPost());
    await page.waitForFunction(() => window.jump === 'response');
    await page.evaluate(() => window.control.viewResponse());
    assert.equal(await top(), 1388, 'response navigation starts at the reply, not its last line');
    await grow();
    await page.waitForTimeout(60);
    assert.equal(await top(), 1388, 'reading the reply must not resume following');
    await page.locator('#panel').evaluate(el => { el.scrollTop = 1800; });
    await page.waitForFunction(() => window.jump === 'post-up');
    await page.evaluate(() => window.control.dispose());
    await page.close();
    console.log(`PASS ${width}px: following, pause, resume, visible post, View post, page position`);
  }
} finally {
  await browser?.close();
  await server.close();
}
