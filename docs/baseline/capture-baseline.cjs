const fs = require('node:fs/promises');
const path = require('node:path');

const playwrightRoot = process.env.AA_PLAYWRIGHT_MODULE ||
  'C:\\Users\\saqla\\Desktop\\InsideSuccess\\marketing tool\\Final Front End\\node_modules\\playwright';
const { chromium } = require(playwrightRoot);

const baseUrl = process.env.AA_BASE_URL || 'http://127.0.0.1:4173';
const chromePath = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputRoot = process.env.AA_CAPTURE_OUTPUT
  ? path.resolve(process.env.AA_CAPTURE_OUTPUT)
  : path.resolve(__dirname, 'screenshots');
const reportPath = process.env.AA_CAPTURE_REPORT
  ? path.resolve(process.env.AA_CAPTURE_REPORT)
  : path.resolve(__dirname, 'capture-report.json');
const results = [];

const viewports = {
  phone: { width: 390, height: 844 },
  belowPhone: { width: 767, height: 900 },
  atTablet: { width: 768, height: 900 },
  tablet: { width: 1024, height: 900 },
  belowTwoPane: { width: 1179, height: 900 },
  atTwoPane: { width: 1180, height: 900 },
  desktop: { width: 1440, height: 1000 },
};

function scenario(name, url, viewport, theme = 'light', action) {
  return { name, url, viewport, theme, action };
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
}

function selectLibraryView(view) {
  return async (page) => {
    if (page.viewportSize().width < 768) {
      await page.getByRole('combobox', { name: 'Library view' }).click();
      await page.getByRole('option', { name: view, exact: true }).click();
    } else {
      await page.getByRole('tab', { name: new RegExp(`^${view}`) }).click();
    }
  };
}

async function openFirstLibraryPost(page) {
  await page.locator('.rf-post-open').first().click();
  await page.locator('.rf-peek').waitFor();
}

async function generateDraft(page) {
  const composer = page.getByPlaceholder('Tell it what happened this week, or paste a link.');
  await composer.fill('We reduced onboarding from six weeks to three days after simplifying approvals.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(250);
}

const scenarios = [
  scenario('home-phone-light', '/refined/home', viewports.phone),
  scenario('home-phone-dark', '/refined/home', viewports.phone, 'dark'),
  scenario('home-767-light', '/refined/home', viewports.belowPhone),
  scenario('home-768-light', '/refined/home', viewports.atTablet),
  scenario('home-1179-light', '/refined/home', viewports.belowTwoPane),
  scenario('home-1180-light', '/refined/home', viewports.atTwoPane),
  scenario('home-desktop-light', '/refined/home', viewports.desktop),
  scenario('home-desktop-dark', '/refined/home', viewports.desktop, 'dark'),

  scenario('workspace-empty-phone-light', '/refined/workspace', viewports.phone),
  scenario('workspace-empty-tablet-dark', '/refined/workspace', viewports.tablet, 'dark'),
  scenario('workspace-empty-1179-light', '/refined/workspace', viewports.belowTwoPane),
  scenario('workspace-empty-1180-light', '/refined/workspace', viewports.atTwoPane),
  scenario('workspace-empty-desktop-dark', '/refined/workspace', viewports.desktop, 'dark'),
  scenario('workspace-generated-phone-light', '/refined/workspace', viewports.phone, 'light', generateDraft),
  scenario('workspace-generated-1179-light', '/refined/workspace', viewports.belowTwoPane, 'light', generateDraft),
  scenario('workspace-generated-1180-light', '/refined/workspace', viewports.atTwoPane, 'light', generateDraft),
  scenario('workspace-schedule-desktop-dark', '/refined/workspace', viewports.desktop, 'dark', async (page) => {
    await generateDraft(page);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('heading', { name: 'Schedule', exact: true }).waitFor();
  }),

  scenario('library-table-phone-light', '/refined/library', viewports.phone),
  scenario('library-table-tablet-dark', '/refined/library', viewports.tablet, 'dark'),
  scenario('library-table-desktop-light', '/refined/library', viewports.desktop),
  scenario('library-board-phone-light', '/refined/library', viewports.phone, 'light', selectLibraryView('Board')),
  scenario('library-board-desktop-dark', '/refined/library', viewports.desktop, 'dark', selectLibraryView('Board')),
  scenario('library-calendar-phone-light', '/refined/library', viewports.phone, 'light', selectLibraryView('Calendar')),
  scenario('library-calendar-desktop-dark', '/refined/library', viewports.desktop, 'dark', selectLibraryView('Calendar')),
  scenario('library-post-phone-light', '/refined/library', viewports.phone, 'light', openFirstLibraryPost),
  scenario('library-post-desktop-dark', '/refined/library', viewports.desktop, 'dark', openFirstLibraryPost),

  scenario('training-guidance-phone-dark', '/refined/train?tab=guidance', viewports.phone, 'dark'),
  scenario('training-guidance-desktop-light', '/refined/train?tab=guidance', viewports.desktop),
  scenario('training-questions-phone-light', '/refined/train?tab=questions', viewports.phone),
  scenario('training-questions-desktop-dark', '/refined/train?tab=questions', viewports.desktop, 'dark'),
  scenario('training-knowledge-phone-light', '/refined/train?tab=knowledge', viewports.phone),
  scenario('training-knowledge-desktop-dark', '/refined/train?tab=knowledge', viewports.desktop, 'dark'),
  scenario('knowledge-upload-phone-light', '/refined/train?tab=knowledge', viewports.phone, 'light', async (page) => {
    await page.getByRole('button', { name: 'Add files', exact: true }).click();
    await page.getByRole('heading', { name: 'Add files', exact: true }).waitFor();
  }),
  scenario('knowledge-upload-desktop-dark', '/refined/train?tab=knowledge', viewports.desktop, 'dark', async (page) => {
    await page.getByRole('button', { name: 'Add files', exact: true }).click();
    await page.getByRole('heading', { name: 'Add files', exact: true }).waitFor();
  }),

  scenario('settings-account-phone-light', '/refined/home', viewports.phone, 'light', openSettings),
  scenario('settings-preferences-phone-dark', '/refined/home', viewports.phone, 'dark', async (page) => {
    await openSettings(page);
    await page.getByRole('tab', { name: /Preferences/ }).click();
  }),
  scenario('settings-account-desktop-light', '/refined/home', viewports.desktop, 'light', openSettings),
  scenario('settings-data-desktop-dark', '/refined/home', viewports.desktop, 'dark', async (page) => {
    await openSettings(page);
    await page.getByRole('tab', { name: /Data/ }).click();
  }),

  scenario('signin-phone-light', '/refined/signin', viewports.phone),
  scenario('signin-768-dark', '/refined/signin', viewports.atTablet, 'dark'),
  scenario('signin-desktop-light', '/refined/signin', viewports.desktop),
  scenario('recovery-phone-light', '/refined/signin', viewports.phone, 'light', async (page) => {
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
  }),
  scenario('recovery-desktop-dark', '/refined/signin', viewports.desktop, 'dark', async (page) => {
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
  }),
  scenario('invite-phone-light', '/refined/invite', viewports.phone),
  scenario('invite-desktop-dark', '/refined/invite', viewports.desktop, 'dark'),

  scenario('onboarding-phone-light', '/refined/onboarding', viewports.phone),
  scenario('onboarding-tablet-dark', '/refined/onboarding', viewports.tablet, 'dark'),
  scenario('onboarding-desktop-light', '/refined/onboarding', viewports.desktop),
  scenario('onboarding-context-phone-light', '/refined/onboarding', viewports.phone, 'light', async (page) => {
    await page.getByRole('button', { name: /View source context/ }).click();
  }),
  scenario('onboarding-next-packet-desktop-dark', '/refined/onboarding', viewports.desktop, 'dark', async (page) => {
    await page.getByRole('radio').first().click();
    await page.waitForTimeout(250);
  }),
];

async function capture(browser, item) {
  const consoleErrors = [];
  const pageErrors = [];
  const context = await browser.newContext({ viewport: item.viewport, colorScheme: item.theme });
  await context.addInitScript((theme) => {
    window.localStorage.setItem('authority-refined-appearance', theme);
  }, item.theme);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const started = Date.now();
  try {
    await page.goto(`${baseUrl}${item.url}`, { waitUntil: 'networkidle' });
    if (item.action) await item.action(page);
    await page.waitForTimeout(150);

    const file = `${item.name}.png`;
    await page.screenshot({
      path: path.join(outputRoot, file),
      fullPage: true,
      animations: 'disabled',
    });
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dark: document.documentElement.classList.contains('dark'),
      mobileNav: Boolean(document.querySelector('.rf-mobile-nav, .rf-bottom-nav')),
      sidebar: Boolean(document.querySelector('.rf-sidebar, aside')),
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      title: document.title,
    }));
    results.push({
      ...item,
      action: item.action ? item.action.name || 'anonymous' : null,
      file,
      status: 'captured',
      elapsedMs: Date.now() - started,
      metrics,
      consoleErrors,
      pageErrors,
    });
    process.stdout.write(`captured ${file}\n`);
  } catch (error) {
    results.push({
      ...item,
      action: item.action ? item.action.name || 'anonymous' : null,
      status: 'failed',
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.stack : String(error),
      consoleErrors,
      pageErrors,
    });
    process.stderr.write(`FAILED ${item.name}: ${error.message}\n`);
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const item of scenarios) await capture(browser, item);
  } finally {
    await browser.close();
  }

  const report = {
    capturedAt: new Date().toISOString(),
    sourceRevision: process.env.AA_SOURCE_STATE || 'ec2f05f83dd70b59cc39d3d2240fad9b291d8d17',
    baseUrl,
    browser: { executablePath: chromePath },
    scenarios: results,
    totals: {
      requested: scenarios.length,
      captured: results.filter((result) => result.status === 'captured').length,
      failed: results.filter((result) => result.status === 'failed').length,
      consoleErrors: results.reduce((sum, result) => sum + result.consoleErrors.length, 0),
      pageErrors: results.reduce((sum, result) => sum + result.pageErrors.length, 0),
    },
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (report.totals.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
