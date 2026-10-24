// The Hub's pages as a signed-in person sees them, with who signs in and what "loaded" means.
import { expect } from '@playwright/test';

export const PAGES = [
  { name: 'home', path: 'index.html', as: 'manager', ready: '#courses-title' },
  { name: 'course', path: 'course.html?c=A2', as: 'manager', ready: '#course-title' },
  { name: 'quiz', path: 'quiz.html?type=predict&c=A2', as: 'manager', ready: '#qz-intro-title' },
  { name: 'baseline', path: 'baseline.html', as: 'manager', ready: '#bl-title' },
  { name: 'team', path: 'team.html', as: 'manager', ready: '#gates-title' },
  { name: 'capstone', path: 'capstone.html', as: 'capstone', ready: '#cap-title' },
  { name: 'panel', path: 'panel.html', as: 'panel', ready: '.pn-team' },
  { name: 'about', path: 'about.html', as: 'manager', ready: '#privacy-h' },
];

/** Wait until a page has drawn its data: the ready selector is visible and no skeleton/spinner is left. */
export async function waitReady(page, ready) {
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#app .skeleton, #app .loading-screen')).toHaveCount(0, { timeout: 15_000 });
}

/** Sign in as the page's account (once per account) and open it. */
export async function openPage(hub, p, signedIn = new Set()) {
  const code = hub.account(p.as);
  if (!signedIn.has(code)) {
    signedIn.clear();
    await hub.page.evaluate(() => { try { sessionStorage.removeItem('hub.session'); localStorage.removeItem('hub.session'); } catch (e) { /* ignore */ } }).catch(() => {});
    const view = await hub.signIn(code);
    expect(view, `${code} reaches the dashboard`).toBe('dash');
    signedIn.add(code);
  }
  await hub.goto(p.path);
  await waitReady(hub.page, p.ready);
}
