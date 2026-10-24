// First sign-in (own PIN → privacy notice → dashboard), sign-out, wrong PINs and the lock.
import { test, expect } from './helpers/hub.mjs';
import * as dev from './helpers/devapi.mjs';


const NEW_PIN = '135792';

test.describe('onboarding', () => {
  test('first sign-in forces a PIN change, then the privacy notice, then the dashboard', async ({ page, hub }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const code = hub.account('onboarding');
    expect(await hub.signIn(code, { consent: false })).toBe('pin');
    await expect(page.locator('body')).toHaveClass(/onboarding/);
    await expect(page.locator('.nav-primary')).toBeHidden();
    await expect(page.locator('.tabbar')).toBeHidden();

    // another page cannot be reached before the PIN is changed
    await hub.goto('team.html');
    await expect(page).toHaveURL(/index\.html/);
    expect(await hub.homeView()).toBe('pin');

    // weak and mismatching PINs are refused
    const pinForm = async (o, n, r) => {
      await page.locator('#pin-old').fill(o);
      await page.locator('#pin-new').fill(n);
      await page.locator('#pin-rep').fill(r);
      await page.locator('.onboard form button[type="submit"]').click();
    };
    await pinForm(hub.pin, '123456', '123456');
    await expect(page.locator('.onboard .err')).toBeVisible();
    await expect(page.locator('.onboard .err')).toContainText('PIN');
    await pinForm(hub.pin, NEW_PIN, '135790');
    await expect(page.locator('.onboard .err')).toBeVisible();
    expect(await hub.homeView()).toBe('pin');

    await pinForm(hub.pin, NEW_PIN, NEW_PIN);
    await expect(page.locator('#pin-old')).toHaveCount(0);
    expect(await hub.homeView()).toBe('consent');
    await expect(page.locator('.onboard h1')).toHaveText('Your results are private');
    await expect(page.locator('.onboard .who-list li')).toHaveCount(5);

    // still gated: other pages send people back to finish the notice
    await hub.goto('capstone.html');
    await expect(page).toHaveURL(/index\.html/);
    expect(await hub.homeView()).toBe('consent');

    expect(await hub.acceptConsent()).toBe('dash');
    await expect(page.locator('body')).not.toHaveClass(/onboarding/);
    await expect(page.locator('.course-card')).toHaveCount(10);

    // the new PIN works next time and goes straight to the dashboard; the issued PIN no longer does
    await page.locator('.user-btn').click();
    await page.locator('#user-menu [role="menuitem"]').last().click();
    await expect(page.locator('#login-code')).toBeVisible();
    await page.locator('#login-code').fill(code);
    await page.locator('#login-pin').fill(hub.pin);
    await page.locator('#app form button[type="submit"]').click();
    expect(await hub.homeView()).toBe('error');
    expect(await hub.signIn(code, { pin: NEW_PIN, consent: false })).toBe('dash');
  });

  test('before the privacy notice the server refuses other actions (consent_required)', async ({ page, hub }) => {
    let view = await hub.signIn(hub.account('consent'), { consent: false });
    if (view === 'pin') { // the demo account must also change its PIN first
      await page.locator('#pin-old').fill(hub.pin);
      await page.locator('#pin-new').fill(NEW_PIN);
      await page.locator('#pin-rep').fill(NEW_PIN);
      await page.locator('.onboard form button[type="submit"]').click();
      await expect(page.locator('#pin-old')).toHaveCount(0);
      view = await hub.homeView();
    }
    expect(view).toBe('consent');
    const token = await hub.token();
    const r = await hub.callApi('team_summary', {}, token);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('consent_required');
    expect((await hub.callApi('me', {}, token)).ok).toBe(true); // me stays allowed
  });

  test('signing out ends the session on the server too (logout)', async ({ page, hub }) => {
    expect(await hub.signIn(hub.account('shell'))).toBe('dash');
    const token = await hub.token();
    expect((await hub.callApi('me', {}, token)).ok).toBe(true);
    await page.locator('.user-btn').click();
    await page.locator('#user-menu [role="menuitem"]').last().click();
    await expect(page.locator('#login-code')).toBeVisible();
    expect(await hub.payloads('logout').length).toBe(1);
    const after = await hub.callApi('me', {}, token);
    expect(after.ok).toBe(false);
    expect(after.error.code).toBe('session_expired');
    // a shared PC forgets the code unless "Keep me signed in" was ticked
    await expect(page.locator('#login-code')).toHaveValue('');
  });
});

test.describe('sign-in errors', () => {
  test('wrong PIN five times locks the code, and the right PIN is refused while locked', async ({ page, hub }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const code = hub.account('lockout');
    await hub.goto('index.html');
    const err = page.locator('.login-error .callout');
    for (let i = 1; i <= 5; i += 1) {
      await page.locator('#login-code').fill(code);
      await page.locator('#login-pin').fill('000000');
      await page.locator('#app form button[type="submit"]').click();
      await expect(err).toBeVisible();
      await expect(page.locator('#app form button[type="submit"]')).toBeEnabled();
      if (i < 5) await expect(err).toHaveText("That employee code or PIN isn't right.");
    }
    await expect(err).toContainText('Too many tries. This code is locked until');
    await expect(page.locator('#login-pin')).toHaveValue(''); // cleared after a failure
    await page.locator('#login-pin').fill(hub.pin);
    await page.locator('#app form button[type="submit"]').click();
    await expect(err).toContainText('locked until');
    expect(hub.last('login').error.code).toBe('locked');
    await expect(page.locator('.course-card')).toHaveCount(0);
  });

  test('an unknown code gets the same answers as a known one, including the lock', async ({ page, hub }) => {
    test.skip(hub.isMock, 'the demo mock does not count failures for unknown codes');
    const codes = []; // error codes in order
    for (let i = 1; i <= 6; i += 1) codes.push((await dev.call('login', { code: 'ZZ-NOBODY', pin: '000000' })).error.code);
    expect(codes).toEqual(['auth_failed', 'auth_failed', 'auth_failed', 'auth_failed', 'locked', 'locked']);
    void page;
  });

  test('the form checks the code and PIN format before calling the server', async ({ page, hub }) => {
    await hub.goto('index.html');
    await page.locator('#login-code').fill('a b');
    await page.locator('#login-pin').fill('12');
    await page.locator('#app form button[type="submit"]').click();
    await expect(page.locator('.login-error .callout')).toBeVisible();
    await expect(page.locator('#login-code')).toHaveAttribute('aria-invalid', 'true');
    expect(hub.payloads('login')).toHaveLength(0);
  });
});
