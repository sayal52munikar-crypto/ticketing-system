// Takes the README screenshots: npm run screenshots  ->  docs/screenshots/*.png
//
// Starts its own server on a spare port, then drives a real browser (Edge or Chrome, through
// puppeteer-core) like a visitor would: two demo customers log in, hold seats, and one pays.
// Set BROWSER_PATH if your browser is somewhere else.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { pool } = require('../server/db');

const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('server did not start');
}

async function logIn(page, email, name) {
  await page.goto(`${BASE}/login`);
  await page.type('input[name=email]', email);
  await page.type('input[name=full_name]', name);
  await Promise.all([page.waitForNavigation(), page.click('form.stack button')]);
}

async function clickAvailableSeat(page, index) {
  await Promise.all([
    page.waitForNavigation(),
    page.evaluate((i) => document.querySelectorAll('button.seat.available')[i].click(), index),
  ]);
}

async function main() {
  const browserPath = BROWSERS.find((p) => fs.existsSync(p));
  if (!browserPath) throw new Error('No Edge/Chrome found; set BROWSER_PATH');
  fs.mkdirSync(OUT, { recursive: true });

  // An upcoming event about two weeks out: some seats sold, plenty still available.
  const { rows: [event] } = await pool.query(
    "SELECT event_id FROM events WHERE starts_at > now() + interval '14 days' ORDER BY starts_at LIMIT 1",
  );

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });

  try {
    await waitForServer();
    const shot = async (page, name) => {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(`  docs/screenshots/${name}.png`);
    };

    // Someone else holds two seats, so the map shows yellow "held" seats too.
    const other = await (await browser.createBrowserContext()).newPage();
    await logIn(other, 'demo.other@example.com', 'Other Demo');
    await other.goto(`${BASE}/events/${event.event_id}`);
    await clickAvailableSeat(other, 6);
    await clickAvailableSeat(other, 6);

    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/?city=Chicago`);
    await shot(page, 'home');

    await logIn(page, 'demo@example.com', 'Demo Customer');
    await page.goto(`${BASE}/events/${event.event_id}`);
    await clickAvailableSeat(page, 2);
    await clickAvailableSeat(page, 2);
    await clickAvailableSeat(page, 2);
    // Holding redirects to #seat-map (scrolled down); reload at the top to show the title and legend.
    await page.setViewport({ width: 1280, height: 1000 });
    await page.goto(`${BASE}/events/${event.event_id}`);
    await shot(page, 'event-seat-map');
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(`${BASE}/checkout`);
    // Fill in the Mastercard test card (the page's "click to fill" buttons).
    await page.click('.test-cards summary');
    await page.evaluate(() => [...document.querySelectorAll('.fill-card')].find((b) => b.dataset.number.startsWith('5555')).click());
    await page.evaluate(() => { document.querySelector('.test-cards').removeAttribute('open'); window.scrollTo(0, 0); });
    await page.setViewport({ width: 1280, height: 1100 });
    await new Promise((r) => setTimeout(r, 1100)); // let the countdown tick once
    await shot(page, 'checkout');
    await page.setViewport({ width: 1280, height: 900 });

    await Promise.all([page.waitForNavigation(), page.click('.card-form button')]);
    await shot(page, 'my-tickets');

    const admin = await (await browser.createBrowserContext()).newPage();
    await admin.setViewport({ width: 1280, height: 1250 });
    await admin.goto(`${BASE}/login`);
    await admin.type('input[name=email]', 'admin@example.com');
    await Promise.all([admin.waitForNavigation(), admin.click('form.stack button')]);
    await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' });
    await shot(admin, 'admin-dashboard');
  } finally {
    await browser.close();
    server.kill();
    await pool.end();
  }
}

console.log('Taking screenshots...');
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
