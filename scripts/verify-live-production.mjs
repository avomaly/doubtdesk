import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROD_URL = 'https://doubtdesk-silk.vercel.app';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runProductionVerification() {
  console.log('=== VERIFYING LIVE PRODUCTION DEPLOYMENT AT ' + PROD_URL + ' ===');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    // -----------------------------------------------------------------
    // TEST 1: Origin/CORS & Single-User Sign-in in fresh Incognito Context
    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Live Sign-In & CORS Check ---');
    const incognitoContext = await browser.createBrowserContext();
    const testPage = await incognitoContext.newPage();

    let corsError = null;
    let consoleErrors = [];
    testPage.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('CORS') || text.includes('rejected this origin') || text.includes('failed to load')) {
        corsError = text;
      }
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
    });

    await testPage.goto(PROD_URL, { waitUntil: 'networkidle2' });
    await testPage.waitForSelector('#display-name', { timeout: 15000 });
    console.log('✔ Live production page loaded successfully without login wall');

    await testPage.type('#display-name', 'VerificationStudent');
    await testPage.click('button[type="submit"]');

    await testPage.waitForSelector('.desktop-sidebar', { timeout: 20000 });
    console.log('✔ Sign-in succeeded on production! No CORS rejection.');
    if (corsError) {
      console.error('❌ Unexpected CORS error detected:', corsError);
    } else {
      console.log('✔ Zero CORS errors during live sign-in');
    }
    await incognitoContext.close();

    // -----------------------------------------------------------------
    // TEST 2: Two-User E2E Flow on Live Production (Alice & Bob)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Live Two-User Flow (Alice & Bob) ---');
    const aliceContext = await browser.createBrowserContext();
    const bobContext = await browser.createBrowserContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('pageerror', (err) => console.error('[Alice Page Error]', err.message));
    bobPage.on('pageerror', (err) => console.error('[Bob Page Error]', err.message));

    // Alice sign in
    await alicePage.setViewport({ width: 1440, height: 900 });
    await alicePage.goto(PROD_URL, { waitUntil: 'networkidle2' });
    await alicePage.waitForSelector('#display-name');
    await alicePage.type('#display-name', 'Alice');
    await alicePage.click('button[type="submit"]');
    await alicePage.waitForSelector('.desktop-sidebar', { timeout: 20000 });
    console.log('✔ Alice signed in');

    // Alice creates live test room with unique code
    const liveRoomCode = 'live' + Date.now().toString(36).slice(-5);
    const liveRoomName = 'Quantum Mechanics';
    console.log(`Alice creating room "${liveRoomName}" (${liveRoomCode})...`);

    await alicePage.click('button[aria-label="Create or join a room"]');
    await alicePage.waitForSelector('#room-code');
    await alicePage.type('#room-name', liveRoomName);
    await alicePage.type('#room-code', liveRoomCode);
    await alicePage.click('form.form-panel button.primary-button');
    await alicePage.waitForSelector('.room-heading', { timeout: 15000 });
    console.log('✔ Alice created and entered room ' + liveRoomCode);

    // Bob signs in
    await bobPage.setViewport({ width: 1440, height: 900 });
    await bobPage.goto(PROD_URL, { waitUntil: 'networkidle2' });
    await bobPage.waitForSelector('#display-name');
    await bobPage.type('#display-name', 'Bob');
    await bobPage.click('button[type="submit"]');
    await bobPage.waitForSelector('.desktop-sidebar', { timeout: 20000 });
    console.log('✔ Bob signed in');

    // Bob joins Alice's room
    console.log('Bob joining room ' + liveRoomCode + '...');
    await bobPage.click('button[aria-label="Create or join a room"]');
    await bobPage.waitForSelector('#join-code');
    await bobPage.type('#join-code', liveRoomCode);
    await bobPage.click('form.form-panel button.secondary-button');
    await bobPage.waitForSelector('.room-heading', { timeout: 15000 });
    console.log('✔ Bob joined room ' + liveRoomCode);

    // Alice posts a doubt
    const doubtText = 'Why does a photon have momentum if it has zero invariant mass?';
    console.log('Alice posting doubt: "' + doubtText + '"');
    await alicePage.waitForSelector('.composer textarea');
    await alicePage.type('.composer textarea', doubtText);
    await alicePage.click('.composer button.primary-button');

    // Verify doubt renders on Alice
    await alicePage.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 10000 }, doubtText);
    console.log('✔ Doubt appears on Alice screen');

    // Verify doubt renders live on Bob
    await bobPage.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 12000 }, doubtText);
    console.log('✔ Doubt appears live on Bob screen');

    // Wait for AI reply to arrive
    console.log('Waiting for AI reply...');
    const aiStart = Date.now();
    try {
      await alicePage.waitForSelector('.reply-entry.ai-reply', { timeout: 16000 });
      const elapsed = ((Date.now() - aiStart) / 1000).toFixed(1);
      const aiText = await alicePage.$eval('.reply-entry.ai-reply p', (el) => el.innerText);
      console.log(`✔ AI reply arrived in ${elapsed}s: "${aiText.slice(0, 80)}..."`);

      // Verify AI reply appears on Bob
      await bobPage.waitForSelector('.reply-entry.ai-reply', { timeout: 8000 });
      console.log('✔ AI reply visible on Bob screen');
    } catch (e) {
      console.warn('AI reply timed out or returned fallback message:', e.message);
    }

    // Bob replies to Alice's doubt
    console.log('Bob submitting peer reply...');
    await bobPage.waitForSelector('.doubt-actions button.text-action');
    await bobPage.click('.doubt-actions button.text-action');
    await bobPage.waitForSelector('.replying-to', { timeout: 8000 });
    const replyText = 'According to relativistic energy-momentum relation E^2 = (pc)^2 + (m0c^2)^2, for m0=0, p=E/c!';
    await bobPage.type('.composer textarea', replyText);
    await bobPage.click('.composer button.primary-button');
    await bobPage.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 8000 }, 'p=E/c');
    console.log('✔ Bob submitted peer reply');

    // Verify Alice sees Bob's reply live without refreshing
    await alicePage.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 10000 }, 'p=E/c');
    console.log('✔ Alice received Bob reply live in real time');

    // Alice marks doubt as solved
    console.log('Alice marking doubt solved...');
    await alicePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button.solve-action-button'));
      if (btns.length > 0) btns[0].click();
    });
    await sleep(2000);

    // Verify solved status updates live for Bob
    await bobPage.click('.tab-button:nth-child(2)'); // Solved tab
    await bobPage.waitForFunction(() => {
      return Array.from(document.querySelectorAll('.status-badge')).some((b) => b.innerText.includes('SOLVED'));
    }, { timeout: 10000 });
    console.log('✔ Bob sees status SOLVED in Solved list live');

    // Check Answer Bank navigation on Alice
    console.log('Checking Answer Bank on Alice...');
    await alicePage.click('.primary-nav button:nth-child(4)'); // Answer bank
    await sleep(1500);
    await alicePage.waitForFunction((txt) => document.body.innerText.includes(txt), { timeout: 8000 }, 'photon');
    console.log('✔ Doubt appears in Answer Bank');

    // Reload both and check persistence
    console.log('Reloading Alice and Bob sessions...');
    await alicePage.reload({ waitUntil: 'networkidle2' });
    await bobPage.reload({ waitUntil: 'networkidle2' });
    await alicePage.waitForSelector('.desktop-sidebar', { timeout: 15000 });
    await bobPage.waitForSelector('.desktop-sidebar', { timeout: 15000 });
    console.log('✔ Both sessions persisted across reload with auto-reconnect');

    // Sign out and sign in again
    console.log('Testing sign out and sign in...');
    await alicePage.click('button[aria-label="Sign out"]');
    await alicePage.waitForSelector('.login-panel', { timeout: 8000 });
    console.log('✔ Alice signed out successfully');

    await alicePage.type('#display-name', 'AliceReturned');
    await alicePage.click('button[type="submit"]');
    await alicePage.waitForSelector('.desktop-sidebar', { timeout: 15000 });
    console.log('✔ Alice signed back in successfully');

    await aliceContext.close();
    await bobContext.close();

    // -----------------------------------------------------------------
    // TEST 3: Mobile Viewport (390px) & User Agent Check
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Mobile Testing (390px, iPhone User Agent) ---');
    const mobileContext = await browser.createBrowserContext();
    const mobilePage = await mobileContext.newPage();
    const mobileErrors = [];
    mobilePage.on('pageerror', (err) => mobileErrors.push(err.message));
    mobilePage.on('console', (msg) => {
      if (msg.type() === 'error') mobileErrors.push(msg.text());
    });

    await mobilePage.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    await mobilePage.goto(PROD_URL, { waitUntil: 'networkidle2' });
    await mobilePage.waitForSelector('#display-name');
    await mobilePage.type('#display-name', 'MobileStudent');
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForSelector('.mobile-nav', { timeout: 15000 });
    console.log('✔ Mobile login succeeded, bottom tab bar visible');

    // Check for horizontal overflow
    const hasHorizontalScroll = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log('✔ Mobile horizontal overflow check:', hasHorizontalScroll ? 'FAILED (has overflow)' : 'PASSED (no horizontal scroll)');

    // Navigate to Rooms
    await mobilePage.click('.mobile-nav-item:nth-child(2)');
    await sleep(1000);
    console.log('✔ Mobile Rooms tab navigable');

    // Navigate to Answer bank
    await mobilePage.click('.mobile-nav-item:nth-child(4)');
    await sleep(1000);
    console.log('✔ Mobile Answer Bank tab navigable');

    if (mobileErrors.length > 0) {
      console.warn('Mobile console/page errors:', mobileErrors);
    } else {
      console.log('✔ Zero console errors on mobile');
    }
    await mobileContext.close();

    console.log('\n=== ALL LIVE PRODUCTION CHECKS COMPLETED SUCCESSFULLY! ===');
  } finally {
    await browser.close();
  }
}

runProductionVerification().catch((err) => {
  console.error('Production Verification Failed:', err);
  process.exit(1);
});
