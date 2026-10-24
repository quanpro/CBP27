// Who signs in for what. Demo accounts live in docs/js/mock-api.js (fresh localStorage per test, so
// they can be reused freely). Real accounts come from backend/tests/fixtures.js devRoster(); the dev
// server keeps one in-memory state for the whole run, so every real test gets its own account (and
// its own course) and never relies on what another test left behind.
export const PINS = { mock: '270127', real: '246810' };

export const ACCOUNTS = {
  //            demo (mock)  dev server (real)
  shell:      { mock: 'DEMO-L', real: 'T005' }, // My learning, EN/VI, 360 px, themes
  security:   { mock: 'DEMO-L', real: 'T005' }, // payload scans, ?next, hosts (course C1)
  onboarding: { mock: 'DEMO-N', real: 'T030' }, // must change PIN, then privacy consent
  consent:    { mock: 'DEMO-N', real: 'T004' }, // consent_required before the privacy notice (runs before lockout)
  lockout:    { mock: 'DEMO-L', real: 'T004' }, // five wrong PINs
  checkpoint: { mock: 'DEMO-L', real: 'T002' }, // not yet → retake wait → other form → pass → recall (course P4)
  resume:     { mock: 'DEMO-L', real: 'T003' }, // reload (P5), VI mid-quiz (A1), predict (P1), no reveal after close (P6)
  baseline:   { mock: 'DEMO-M', real: 'T006' }, // DEMO-L already took the demo baseline
  manager:    { mock: 'DEMO-M', real: 'T010' }, // team page + manager gate table, most a11y scans
  panel:      { mock: 'DEMO-M', real: 'T020' }, // judge
  capstone:   { mock: 'DEMO-L', real: 'T001' }, // member of TEAM-DEMO / TEAM1
};

/**
 * Courses each flow uses. Real: no two tests share an (account, course) pair on the one dev server.
 * Mock: every test starts from a fresh demo seed, and the demo only has A2, A3 and A1 open
 * (A2/A3 past their late window; DEMO-L has two failed A3 attempts that need a coaching chat).
 */
export const COURSES = {
  checkpoint:  { mock: 'A1', real: 'P4' },
  resume:      { mock: 'A1', real: 'P5' },
  viToggle:    { mock: 'A1', real: 'A1' },
  predict:     { mock: 'A1', real: 'P1' },
  lateReveal:  { mock: 'A3', real: 'P6' },
  security:    { mock: 'A1', real: 'C1' },
  unlock:      { mock: 'A3', real: 'P3' },
  a11yPredict: { mock: 'A2', real: 'A2' },
};

/** Calendar order (specs/19 F15). */
export const ORDER = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'];
