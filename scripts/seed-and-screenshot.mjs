import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API_PORT = 8787;
const VITE_PORT = 5173;
const SCREENSHOTS_DIR = path.resolve('screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function waitHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== Starting Seeding & Screenshot Capture via Real App Flow ===');

  const serverProc = spawn('node', ['--env-file=.env', '--env-file=.env.server', 'server.mjs'], {
    stdio: 'inherit',
  });
  const viteProc = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
    stdio: 'inherit',
  });

  let browser;
  try {
    await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`);
    await waitHttp(`http://127.0.0.1:${VITE_PORT}`);
    console.log('✔ Services active (API on 8787, Frontend on 5173)');

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('console', msg => console.log('[Chrome Alice]', msg.text()));
    page.on('pageerror', err => console.log('[Chrome Alice Error]', err.message));

    // 1. Capture Login Screens (Desktop & Mobile, Light & Dark)
    console.log('Capturing Login screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${VITE_PORT}`);
    await page.waitForSelector('.login-panel');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-login-light.png') });

    // Switch to dark mode on login
    await page.click('.login-theme');
    await sleep(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-login-dark.png') });

    // Mobile login
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(200);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-login-dark.png') });
    await page.click('.login-theme'); // switch to light
    await sleep(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-login-light.png') });

    // Switch back to desktop viewport
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await sleep(300);

    // 2. Sign in as Alice through the real UI
    console.log('Signing in as Alice...');
    await page.waitForSelector('#display-name');
    await page.type('#display-name', 'Alice');
    await page.click('button[type="submit"]');
    try {
      await page.waitForSelector('.desktop-sidebar', { timeout: 25000 });
    } catch (e) {
      const text = await page.evaluate(() => document.querySelector('.notice')?.textContent || document.body.innerText);
      console.error('Failed to find .desktop-sidebar. Page content:', text);
      throw e;
    }
    console.log('✔ Alice signed in');

    // 3. Create rooms through real UI
    const roomsToSeed = [
      { code: 'physics101', name: 'Physics 101' },
      { code: 'chemistry101', name: 'Chemistry 101' },
      { code: 'calculus101', name: 'Calculus 101' },
    ];

    for (const r of roomsToSeed) {
      console.log(`Setting up room ${r.code}...`);
      await page.click('button[aria-label="Create or join a room"]');
      await page.waitForSelector('#room-code');
      await page.evaluate(() => {
        const nameInput = document.querySelector('#room-name');
        const codeInput = document.querySelector('#room-code');
        if (nameInput) nameInput.value = '';
        if (codeInput) codeInput.value = '';
      });
      await page.type('#room-name', r.name);
      await page.type('#room-code', r.code);
      await page.click('form.form-panel button.primary-button');
      await sleep(2500);
    }

    // 4. Seed realistic doubts in physics101 through real UI
    console.log('Seeding realistic threads in physics101...');
    // Open physics101
    const sidebarButtons = await page.$$('.sidebar-room');
    for (const btn of sidebarButtons) {
      const text = await btn.evaluate((el) => el.innerText);
      if (text.includes('Physics 101')) {
        await btn.click();
        break;
      }
    }
    await page.waitForSelector('.composer textarea', { timeout: 10000 });

    const questions = [
      {
        q: 'Why does a ball thrown upward slow down?',
        solve: true,
      },
      {
        q: 'In Bernoulli’s equation, why does fluid pressure drop when velocity increases?',
        solve: false,
      },
      {
        q: 'How does Lenz’s law satisfy the conservation of energy in electromagnetic induction?',
        solve: true,
      },
      {
        q: 'What is the physical meaning of the divergence of the electric field being zero in vacuum?',
        solve: false,
      },
    ];

    for (const item of questions) {
      console.log(`Posting: "${item.q.slice(0, 40)}..."`);
      await page.type('.composer textarea', item.q);
      await page.click('.composer button.primary-button');
      await sleep(2500);

      // Wait for AI reply to appear
      try {
        await page.waitForSelector('.reply-entry.ai-reply', { timeout: 12000 });
      } catch {}
      await sleep(1000);

      if (item.solve) {
        // Mark solved
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button.solve-action-button'));
          if (btns.length > 0) btns[0].click();
        });
        await sleep(1500);
      }
    }

    // Now seed chemistry101 and calculus101
    for (const btn of await page.$$('.sidebar-room')) {
      const text = await btn.evaluate((el) => el.innerText);
      if (text.includes('Chemistry 101')) {
        await btn.click();
        break;
      }
    }
    await sleep(1000);
    await page.type('.composer textarea', 'What makes an SN2 reaction invert stereochemistry while SN1 racemizes?');
    await page.click('.composer button.primary-button');
    await sleep(2500);
    try { await page.waitForSelector('.reply-entry.ai-reply', { timeout: 10000 }); } catch {}
    await sleep(1000);

    for (const btn of await page.$$('.sidebar-room')) {
      const text = await btn.evaluate((el) => el.innerText);
      if (text.includes('Calculus 101')) {
        await btn.click();
        break;
      }
    }
    await sleep(1000);
    await page.type('.composer textarea', 'Why must a function have partial derivatives to be differentiable, but having them is not sufficient?');
    await page.click('.composer button.primary-button');
    await sleep(2500);
    try { await page.waitForSelector('.reply-entry.ai-reply', { timeout: 10000 }); } catch {}
    await sleep(1000);

    // Let's connect Bob in a second context to reply to Alice's questions in physics101!
    console.log('Connecting Bob to add peer replies...');
    const bobContext = await browser.createBrowserContext();
    const bobPage = await bobContext.newPage();
    bobPage.on('console', msg => console.log('[Chrome Bob]', msg.text()));
    bobPage.on('pageerror', err => console.log('[Chrome Bob Error]', err.message));
    await bobPage.goto(`http://127.0.0.1:${VITE_PORT}`);
    await bobPage.waitForSelector('#display-name');
    await bobPage.type('#display-name', 'Bob');
    await bobPage.click('button[type="submit"]');
    await bobPage.waitForSelector('.desktop-sidebar', { timeout: 25000 });

    // Bob joins physics101
    await bobPage.click('button[aria-label="Create or join a room"]');
    await bobPage.waitForSelector('#join-code');
    await bobPage.type('#join-code', 'physics101');
    await bobPage.click('form.form-panel button.secondary-button');
    await bobPage.waitForSelector('.room-heading', { timeout: 15000 });
    await sleep(1500);

    // Bob replies to the open question
    await bobPage.click('.doubt-actions button.text-action');
    await bobPage.waitForSelector('.replying-to', { timeout: 10000 });
    await bobPage.type('.composer textarea', 'To accelerate into a constriction, there must be a net force from higher pressure behind to lower pressure ahead!');
    await bobPage.click('.composer button.primary-button');
    await sleep(2500);
    await bobContext.close();
    console.log('✔ Bob peer replies added');

    // Return to Alice page and refresh
    await page.reload();
    await page.waitForSelector('.desktop-sidebar', { timeout: 10000 });
    await sleep(4000);

    // 5. CAPTURE ALL REQUIRED SCREENSHOTS (Desktop 1440px & Mobile 390px, Light & Dark)

    // A. DASHBOARD
    console.log('Capturing Dashboard screenshots...');
    // Navigate to Dashboard
    await page.click('.primary-nav button:first-child');
    await sleep(1200);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-dashboard-light.png') });

    // Dark mode
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-dashboard-dark.png') });

    // Mobile Dashboard
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-dashboard-dark.png') });
    await page.click('.topbar-actions button.icon-action'); // back to light
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-dashboard-light.png') });

    // B. ROOMS LIST
    console.log('Capturing Rooms List screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.click('.primary-nav button:nth-child(2)');
    await sleep(800);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-rooms-light.png') });

    // Dark
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-rooms-dark.png') });

    // Mobile Rooms List
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-rooms-dark.png') });
    await page.click('.topbar-actions button.icon-action'); // back to light
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-rooms-light.png') });

    // C. BUSY ROOM (physics101 with multiple doubts, AI replies, peer replies, open & solved)
    console.log('Capturing Busy Room screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    // Open physics101
    for (const btn of await page.$$('.sidebar-room')) {
      const text = await btn.evaluate((el) => el.innerText);
      if (text.includes('Physics 101')) {
        await btn.click();
        break;
      }
    }
    await sleep(2000);
    // Switch to 'All threads' tab so both open and solved doubts appear
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab-button'));
      const allTab = tabs.find(t => t.textContent && t.textContent.includes('All'));
      if (allTab) allTab.click();
    });
    await sleep(1200);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-busy-room-light.png') });

    // Dark
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-busy-room-dark.png') });

    // Mobile Busy Room
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-busy-room-dark.png') });
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-busy-room-light.png') });

    // D. ANSWER BANK
    console.log('Capturing Answer Bank screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.click('.primary-nav button:nth-child(4)');
    await sleep(800);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-answer-bank-light.png') });

    // Dark
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-answer-bank-dark.png') });

    // Mobile Answer Bank
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-answer-bank-dark.png') });
    await page.click('.topbar-actions button.icon-action');
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-answer-bank-light.png') });

    // E. COMMAND PALETTE (⌘K)
    console.log('Capturing Command Palette screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.click('.search-trigger');
    await page.waitForSelector('.search-dialog');
    await page.type('.search-dialog-input input', 'ball');
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-command-palette-light.png') });

    // Dark
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('.topbar-actions button.icon-action'); // dark mode
    await sleep(300);
    await page.click('.search-trigger');
    await page.waitForSelector('.search-dialog');
    await page.type('.search-dialog-input input', 'ball');
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-command-palette-dark.png') });

    // Mobile Command Palette
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-command-palette-dark.png') });
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('.topbar-actions button.icon-action'); // back to light
    await sleep(300);
    await page.click('.search-trigger');
    await page.waitForSelector('.search-dialog');
    await page.type('.search-dialog-input input', 'ball');
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-command-palette-light.png') });
    await page.keyboard.press('Escape');

    // F. MODAL / CREATE ROOM PANEL
    console.log('Capturing Modal / Form panel screenshots...');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.click('.primary-nav button:nth-child(2)'); // rooms
    await sleep(600);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-modal-light.png') });

    await page.click('.topbar-actions button.icon-action'); // dark
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'desktop-modal-dark.png') });

    // Mobile Modal / Form panel
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-modal-dark.png') });
    await page.click('.topbar-actions button.icon-action'); // back to light
    await sleep(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-modal-light.png') });

    console.log('=== All Screenshots Captured Successfully! ===');
  } finally {
    if (browser) await browser.close();
    try { serverProc.kill('SIGTERM'); } catch {}
    try { viteProc.kill('SIGTERM'); } catch {}
  }
}

main().catch((err) => {
  console.error('Seed and Screenshot failed:', err);
  process.exit(1);
});
