// Runs once per `playwright test`, after the dev server is up.
// The dev server keeps its state in memory. Locally Playwright reuses a server that is already running
// on the port (reuseExistingServer), and that server may hold state from an earlier run (a changed
// PIN, a submitted baseline …). The real-backend tests need a fresh one, so probe a few fixture accounts
// and, if the state is not fresh, mark it: the real tests then stop with a clear message (the mock
// tests only use the server for static files and still run).
import { call } from './helpers/devapi.mjs';
import { ACCOUNTS, COURSES, PINS } from './helpers/accounts.mjs';

async function probe() {
  const why = [];
  const login = async (code) => {
    const r = await call('login', { code, pin: PINS.real });
    if (!r.ok) why.push(`${code} cannot sign in with the fixture PIN (${r.error && r.error.code})`);
    return r;
  };
  const newcomer = await login(ACCOUNTS.onboarding.real);
  if (newcomer.ok && !newcomer.profile.must_change_pin) why.push(`${ACCOUNTS.onboarding.real} no longer has to change the PIN`);
  await login(ACCOUNTS.lockout.real);
  const bl = await login(ACCOUNTS.baseline.real);
  if (bl.ok) {
    const me = await call('me', { token: bl.token });
    if (!me.ok || me.baseline.status !== 'not_started') why.push(`${ACCOUNTS.baseline.real} already started the baseline`);
  }
  const cp = await login(ACCOUNTS.checkpoint.real);
  if (cp.ok) {
    const me = await call('me', { token: cp.token });
    const c = me.ok && me.courses.find((x) => x.code === COURSES.checkpoint);
    if (!c || c.checkpoint.status !== 'not_started') why.push(`${ACCOUNTS.checkpoint.real} already took the ${COURSES.checkpoint} checkpoint`);
  }
  return why;
}

export default async function globalSetup() {
  let why;
  try { why = await probe(); } catch (e) { why = [`dev server not answering /api (${e.message})`]; }
  if (why.length) {
    process.env.HUB_REAL_STALE = `The dev server on port ${process.env.E2E_PORT || 8787} is not fresh: ${why.join('; ')}. `
      + 'Stop that server (or run with E2E_PORT=<free port>) so Playwright starts a new one, then run the real tests again.';
  }
}
