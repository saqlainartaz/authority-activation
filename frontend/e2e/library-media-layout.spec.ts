import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const css = readFileSync(resolve(process.cwd(), 'src/refined/refined.css'), 'utf8');
const largeImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000"><rect width="4000" height="4000" fill="#e9e4db"/><rect x="450" y="450" width="3100" height="3100" rx="160" fill="#d7cabb"/><text x="2000" y="2100" text-anchor="middle" font-family="Arial" font-size="230" fill="#6e6257">Image preview</text></svg>')}`;

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`Library media preview stays usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`
      <html data-refined><body>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #f5f4f2; font-family: Arial, sans-serif; }
        [data-slot="dialog-content"] { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; box-shadow: 0 22px 70px #0002; }
      </style>
      <div data-slot="dialog-content" class="rf-peek bg-popover text-popover-foreground rounded-xl ring-1 ring-foreground/10">
        <div class="rf-peek-preview"><p class="rf-peek-section-label">Post preview</p><article class="rf-peek-post">
          <div class="rf-post-person"><span>SA</span><div><b>Saqlain Artaz</b><p>LinkedIn</p></div></div>
          <div class="rf-peek-body">${'<p>Post body with several lines of content.</p>'.repeat(12)}</div>
          <figure class="rf-library-media"><img src="${largeImage}" alt="Large test image" /></figure>
        </article></div>
        <div class="rf-peek-info"><div class="rf-peek-heading"><p>LinkedIn post</p><h2 data-slot="dialog-title">Scheduled image post</h2></div><div class="rf-peek-property"><span>Status</span><span>Scheduled</span></div><div class="rf-peek-property"><span>Channel</span><span>LinkedIn</span></div><div class="rf-peek-property"><span>Scheduled for</span><span>25 Sep, 10:30<br /><small>Europe/Warsaw</small></span></div></div>
        <div data-slot="dialog-footer"><div class="rf-peek-main-actions"><button>Change schedule</button><button>Return to Draft</button></div><div class="rf-peek-utility-actions"><button>Copy text</button><button class="rf-peek-delete">Delete post</button></div></div>
      </div>
      </body></html>
    `);
    await page.addStyleTag({ content: css });
    const preview = page.locator('.rf-peek');
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    const info = await page.locator('.rf-peek-info').boundingBox();
    const post = await page.locator('.rf-peek-preview').boundingBox();
    expect(info).not.toBeNull();
    expect(post).not.toBeNull();
    if (viewport.width >= 768) expect(info!.x).toBeGreaterThan(post!.x + post!.width - 1);
    else expect(info!.y).toBeLessThan(post!.y);
    await page.getByRole('button', { name: 'Change schedule' }).scrollIntoViewIfNeeded();
    const action = await page.getByRole('button', { name: 'Change schedule' }).boundingBox();
    expect(action).not.toBeNull();
    expect(action!.y + action!.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole('button', { name: 'Delete post' }).scrollIntoViewIfNeeded();
    const deleteAction = await page.getByRole('button', { name: 'Delete post' }).boundingBox();
    const copyAction = await page.getByRole('button', { name: 'Copy text' }).boundingBox();
    expect(deleteAction).not.toBeNull();
    expect(copyAction).not.toBeNull();
    expect(Math.abs(deleteAction!.y - copyAction!.y)).toBeLessThan(1);
    expect(Math.abs(deleteAction!.x - (copyAction!.x + copyAction!.width))).toBeLessThan(1);
    expect(deleteAction!.y + deleteAction!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.locator('.rf-library-media figcaption').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Download image' }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
