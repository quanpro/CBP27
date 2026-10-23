// Invented fixtures for the harness (API tests and the dev server). No real items, answer
// keys, names or employee codes: ids look like FX_A2_A_01, codes like T001, text is generic.
'use strict';

const COURSES = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const CASE_COURSES = ['P1', 'P2', 'A1', 'P4', 'C1', 'P3'];
const PIN = '246810';
const pad = (n) => String(n).padStart(2, '0');

function fxItem(id, assessment, course, form, objective, caseId, answer) {
  const o = {
    item_id: id, assessment, course, form, objective: String(objective), case_id: caseId || '',
    stem_en: `Fixture question ${id}: which option fits best?`, stem_vi: `Câu hỏi mẫu ${id}: chọn phương án phù hợp nhất?`,
    why_en: `Fixture reason for ${id}.`, why_vi: `Lý do mẫu cho ${id}.`, active: 'TRUE'
  };
  for (const l of ['a', 'b', 'c', 'd']) { o[l + '_en'] = `Option ${l.toUpperCase()} for ${id}`; o[l + '_vi'] = `Phương án ${l.toUpperCase()} cho ${id}`; }
  o.answer = answer;
  return o;
}

/** 10 courses × (forms A/B of 10, predict 3, baseline 4) + 6 case items = 276 items. */
function buildItems() {
  const items = [];
  for (const c of COURSES) {
    for (const form of ['A', 'B']) {
      for (let i = 1; i <= 10; i++) items.push(fxItem(`FX_${c}_${form}_${pad(i)}`, 'checkpoint', c, form, ((i - 1) % 5) + 1, '', 'abcd'[(i + (form === 'B' ? 1 : 0)) % 4]));
    }
    for (let i = 1; i <= 3; i++) items.push(fxItem(`FX_${c}_PR_${pad(i)}`, 'predict', c, 'PR', i, '', 'abcd'[i % 4]));
    for (let i = 1; i <= 4; i++) items.push(fxItem(`FX_BL_${c}_${pad(i)}`, 'baseline', c, 'BL', i, '', 'abcd'[(i + 2) % 4]));
  }
  CASE_COURSES.forEach((c, i) => items.push(fxItem(`FX_BL_CASE_${pad(i + 1)}`, 'baseline', c, 'BL', 1, 'CASE1', 'abcd'[i % 4])));
  return items;
}

function courseRow(code) {
  const o = { code, name_en: `Fixture course ${code}`, name_vi: `Khóa mẫu ${code}`, self_en: `Fixture self statement for ${code}.`, self_vi: `Câu tự đánh giá mẫu cho ${code}.` };
  for (let n = 1; n <= 5; n++) { o[`obj${n}_en`] = `Fixture objective ${n} of ${code}`; o[`obj${n}_vi`] = `Mục tiêu mẫu ${n} của ${code}`; }
  return o;
}

const CASES = [{ case_id: 'CASE1', title_en: 'Fixture case', title_vi: 'Tình huống mẫu', context_en: 'An invented context for the fixture case.', context_vi: 'Bối cảnh mẫu cho tình huống.' }];

function person(code, name, area, extra) {
  return Object.assign({
    employee_code: code, display_name: name, role_area: area, is_manager: 'FALSE', manager_code: '',
    roles: 'learner', must_change_pin: 'FALSE', failed_logins: '0', active: 'TRUE', lang: 'en',
    session_ver: '1', consent_at: '2026-11-01T09:00:00+07:00', certificate: ''
  }, extra || {});
}

/** Roster for the API tests: groups of 3/3/2/1, a manager, a judge, a newcomer, a test user. */
function testRoster() {
  return [
    person('T001', 'Fixture Learner Alpha', 'demand', { manager_code: 'T010' }),
    person('T002', 'Fixture Learner Bravo', 'demand', { manager_code: 'T010' }),
    person('T003', 'Fixture Learner Charlie', 'demand', { manager_code: 'T010' }),
    person('T004', 'Fixture Learner Delta', 'supply', { manager_code: 'T010', preferred_name: 'Del' }),
    person('T005', 'Fixture Learner Echo', 'supply'),
    person('T006', 'Fixture Learner Foxtrot', 'supply'),
    person('T007', 'Fixture Learner Golf', 'materials'),
    person('T008', 'Fixture Learner Hotel', 'materials'),
    person('T009', 'Fixture Learner India', 'cs'),
    person('T010', 'Fixture Manager Juliet', 'demand', { is_manager: 'TRUE', roles: 'learner;manager' }),
    person('T020', 'Fixture Judge Kilo', '', { roles: 'panel' }),
    person('T030', 'Fixture Newcomer Lima', 'cs', { must_change_pin: 'TRUE', consent_at: '' }),
    person('T040', 'Fixture Tester Mike', 'demand', { roles: 'learner;test', manager_code: 'T010' }),
    person('T050', 'Fixture Admin November', '', { roles: 'admin' }),
    person('T060', 'Fixture Leaver Oscar', 'cs', { active: 'FALSE' })
  ];
}

/** Accounts for the local dev server (backend/dev/server.mjs). */
function devRoster() {
  return [
    person('T001', 'Fixture Learner Alpha', 'demand', { manager_code: 'T010', consent_at: '' }),
    person('T002', 'Fixture Learner Bravo', 'supply', { manager_code: 'T010', consent_at: '' }),
    person('T003', 'Fixture Learner Charlie', 'materials', { manager_code: 'T010', consent_at: '' }),
    person('T004', 'Fixture Learner Delta', 'cs', { consent_at: '' }),
    person('T005', 'Fixture Learner Echo', 'demand', { consent_at: '' }),
    person('T006', 'Fixture Learner Foxtrot', 'supply', { consent_at: '' }),
    person('T010', 'Fixture Manager Juliet', 'demand', { is_manager: 'TRUE', roles: 'learner;manager', consent_at: '' }),
    person('T020', 'Fixture Judge Kilo', '', { roles: 'panel', consent_at: '' }),
    person('T030', 'Fixture Newcomer Lima', 'cs', { must_change_pin: 'TRUE', consent_at: '' })
  ];
}

/**
 * Sets up the fake Sheet and loads the fixtures.
 * opts.roster, opts.courseDates(code) → {online_from, …} overrides, opts.config {key: value},
 * opts.teams.
 */
function loadFixtures(h, opts = {}) {
  h.run('setupSheet');
  for (const c of COURSES) {
    const patch = courseRow(c);
    if (opts.courseDates) Object.assign(patch, opts.courseDates(c));
    h.updateWhere('Courses', 'code', c, patch);
  }
  h.appendObjects('Items', buildItems());
  h.appendObjects('Cases', CASES);
  const roster = (opts.roster || testRoster()).map((p) => {
    const rec = h.run('makePinRecord_', PIN);
    return Object.assign({}, p, { pin_hash: rec.pin_hash, pin_salt: rec.pin_salt });
  });
  h.appendObjects('Roster', roster);
  h.appendObjects('Teams', opts.teams || [
    { team_id: 'TEAM1', project_title: 'Fixture project one', members: 'T001;T002;T003', sponsor_code: 'T010', active: 'TRUE' },
    { team_id: 'TEAM2', project_title: 'Fixture project two', members: 'T004;T005', sponsor_code: 'T010', active: 'TRUE' }
  ]);
  for (const [k, v] of Object.entries(opts.config || {})) h.setConfig(k, v);
  h.run('resetRequest_');
  h.run('clearCaches_');
  return { items: buildItems(), roster };
}

module.exports = { COURSES, CASE_COURSES, PIN, buildItems, courseRow, CASES, testRoster, devRoster, loadFixtures, fxItem };
