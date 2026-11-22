import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = 8787;
const VITE_PORT = 5173;

async function waitHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function runE2E() {
  console.log('=== Starting E2E Two-User Test ===');

  // 1. Start backend server
  console.log('Starting backend server...');
  const serverProc = spawn('node', ['--env-file=.env', '--env-file=.env.server', 'server.mjs'], {
    stdio: 'inherit',
  });

  // 2. Start Vite server
  console.log('Starting Vite frontend...');
  const viteProc = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
    stdio: 'inherit',
  });

  let browser;
  try {
    await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`);
    console.log('✔ Backend API is healthy on port', API_PORT);

    await waitHttp(`http://127.0.0.1:${VITE_PORT}`);
    console.log('✔ Vite frontend is ready on port', VITE_PORT);

    // Launch Chrome with two separate contexts
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    console.log('Step a: Alice signs in, creates room physics101; Bob signs in (separate context) and joins.');
    const aliceContext = await browser.createBrowserContext();
    const bobContext = await browser.createBrowserContext();

    const alicePage = await aliceContext.newPage();
    alicePage.on('console', (msg) => console.log('[Alice Console]', msg.type(), msg.text()));
    alicePage.on('pageerror', (err) => console.error('[Alice Error]', err));
    await alicePage.setViewport({ width: 1280, height: 800 });
    await alicePage.goto(`http://127.0.0.1:${VITE_PORT}`);

    // Alice sign in
    await alicePage.waitForSelector('#display-name');
    await alicePage.type('#display-name', 'Alice');
    await alicePage.click('button[type="submit"]');
    await alicePage.waitForSelector('.desktop-sidebar', { timeout: 10000 });
    console.log('✔ Alice signed in successfully');

    // Alice creates room physics101
    await alicePage.click('button[aria-label="Create or join a room"]');
    await alicePage.waitForSelector('#room-code');
    await alicePage.type('#room-name', 'Physics 101');
    await alicePage.type('#room-code', 'physics101');
    await alicePage.click('form.form-panel button.primary-button');
    await alicePage.waitForSelector('.room-heading', { timeout: 10000 });
    console.log('✔ Alice created room physics101');

    // Bob signs in in separate context
    const bobPage = await bobContext.newPage();
    bobPage.on('console', (msg) => console.log('[Bob Console]', msg.type(), msg.text()));
    bobPage.on('pageerror', (err) => console.error('[Bob Error]', err));
    await bobPage.setViewport({ width: 1280, height: 800 });
    await bobPage.goto(`http://127.0.0.1:${VITE_PORT}`);

    await bobPage.waitForSelector('#display-name');
    await bobPage.type('#display-name', 'Bob');
    await bobPage.click('button[type="submit"]');
    await bobPage.waitForSelector('.desktop-sidebar', { timeout: 10000 });
    console.log('✔ Bob signed in successfully');

    // Bob joins room physics101
    await bobPage.click('button[aria-label="Create or join a room"]');
    await bobPage.waitForSelector('#join-code');
    await bobPage.type('#join-code', 'physics101');
    await bobPage.click('form.form-panel button.secondary-button');
    await bobPage.waitForSelector('.room-heading', { timeout: 10000 });
    console.log('✔ Bob joined room physics101');

    console.log('Step b: Alice posts doubt and AI reply appears for both users within ~10 seconds.');
    await alicePage.waitForSelector('.composer textarea');
    await alicePage.type('.composer textarea', 'Why does a ball thrown upward slow down?');
    await alicePage.click('.composer button.primary-button');

    // Verify doubt appears on Alice
    await alicePage.waitForFunction(() => document.body.innerText.includes('Why does a ball thrown upward slow down?'), { timeout: 8000 });
    console.log('✔ Alice posted doubt: "Why does a ball thrown upward slow down?"');

    // Wait for AI reply to arrive
    console.log('Waiting for AI reply...');
    await alicePage.waitForSelector('.reply-entry.ai-reply', { timeout: 15000 });
    const aliceAiText = await alicePage.$eval('.reply-entry.ai-reply p', (el) => el.innerText);
    console.log('✔ Alice received AI reply:', aliceAiText.slice(0, 80) + '...');

    // Verify Bob sees both the doubt and AI reply
    await bobPage.waitForFunction(() => document.body.innerText.includes('Why does a ball thrown upward slow down?'), { timeout: 10000 });
    await bobPage.waitForSelector('.reply-entry.ai-reply', { timeout: 10000 });
    console.log('✔ Bob sees the doubt and the AI reply live');

    console.log('Step c: Bob replies; Alice sees it live.');
    await bobPage.click('.doubt-actions button.text-action'); // Click Reply
    await bobPage.waitForSelector('.replying-to');
    await bobPage.type('.composer textarea', 'Because gravity constantly exerts a downward gravitational acceleration on the ball.');
    await bobPage.click('.composer button.primary-button');
    await bobPage.waitForFunction(() => document.body.innerText.includes('gravitational acceleration'), { timeout: 8000 });
    console.log('✔ Bob submitted reply');

    // Check Alice sees Bob's reply live
    await alicePage.waitForFunction(() => document.body.innerText.includes('gravitational acceleration'), { timeout: 10000 });
    console.log('✔ Alice saw Bob’s reply live');

    console.log('Step d: Alice marks it solved; Bob sees it live; it appears in Solved list and search.');
    // Alice clicks Mark solved
    await alicePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button.solve-action-button, button.text-action'));
      const solveBtn = btns.find((b) => b.innerText.includes('Mark solved'));
      if (!solveBtn) throw new Error('Mark solved button not found on Alice page');
      solveBtn.click();
    });

    // Alice switches to Solved tab
    await alicePage.click('.status-tabs button:nth-child(2)');

    // Verify Alice sees SOLVED status
    await alicePage.waitForFunction(() => {
      const labels = Array.from(document.querySelectorAll('.status-label'));
      return labels.some((l) => l.innerText.includes('SOLVED'));
    }, { timeout: 10000 });
    console.log('✔ Alice sees status SOLVED in Solved list');

    // Bob switches to Solved tab and sees it live
    await bobPage.click('.status-tabs button:nth-child(2)');
    await bobPage.waitForFunction(() => {
      const labels = Array.from(document.querySelectorAll('.status-label'));
      return labels.some((l) => l.innerText.includes('SOLVED'));
    }, { timeout: 10000 });
    console.log('✔ Bob sees status SOLVED live');

    // Check Answer Bank navigation
    const navItems = await alicePage.$$('.nav-item');
    for (const item of navItems) {
      const text = await item.evaluate((el) => el.innerText);
      if (text.includes('Answer bank')) {
        await item.click();
        break;
      }
    }
    await alicePage.waitForSelector('.search-field input');
    await alicePage.type('.search-field input', 'gravity');
    await alicePage.waitForFunction(() => document.body.innerText.includes('Why does a ball thrown upward slow down?'));
    console.log('✔ Doubt found in Answer bank search for "gravity"');

    console.log('Step e: Reload both; everything persists.');
    await alicePage.reload({ waitUntil: 'networkidle0' });
    await bobPage.reload({ waitUntil: 'networkidle0' });

    await alicePage.waitForSelector('.desktop-sidebar', { timeout: 10000 });
    await bobPage.waitForSelector('.desktop-sidebar', { timeout: 10000 });

    const aliceName = await alicePage.$eval('.account-name', (el) => el.innerText);
    const bobName = await bobPage.$eval('.account-name', (el) => el.innerText);

    if (!aliceName.includes('Alice') || !bobName.includes('Bob')) {
      throw new Error(`Session failed to persist: Alice was "${aliceName}", Bob was "${bobName}"`);
    }
    console.log('✔ Alice and Bob sessions persisted after reload (Alice:', aliceName, ', Bob:', bobName, ')');

    console.log('Step f: Kill API briefly: UI shows a clear message and recovers when it returns.');
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 6000)); // wait for health check interval (5s)

    await alicePage.waitForFunction(() => {
      return document.body.innerText.includes('API server unreachable');
    }, { timeout: 10000 });
    console.log('✔ UI displayed clear API unreachable banner when server was killed');

    // Restart backend server
    console.log('Restarting backend server...');
    const serverProc2 = spawn('node', ['--env-file=.env', '--env-file=.env.server', 'server.mjs'], {
      stdio: 'inherit',
    });
    await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`);
    await new Promise((r) => setTimeout(r, 6000)); // wait for recovery check

    await alicePage.waitForFunction(() => {
      return !document.body.innerText.includes('API server unreachable');
    }, { timeout: 10000 });
    console.log('✔ UI recovered automatically when API server returned');

    serverProc2.kill('SIGTERM');
  } finally {
    if (browser) await browser.close();
    try { serverProc.kill('SIGTERM'); } catch {}
    try { viteProc.kill('SIGTERM'); } catch {}
  }

  console.log('=== All Two-User Test Steps PASSED! ===');
}

runE2E().catch((err) => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
