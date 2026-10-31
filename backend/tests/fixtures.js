// Invented fixtures for the harness (API tests and the dev server). No real items, answer
// keys, names or employee codes: ids look like FX_A2_A_01, codes like T001, text is generic.
'use strict';

const COURSES = ['A2', 'A3', 'A1', 'P1', 'C1', 'P2', 'P3', 'P4', 'P5', 'P6'];
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

/** 10 courses × (forms A/B of 10, predict 3) = 230 items (the v1 baseline rows are gone: Baseline v2 has its own tab). */
function buildItems() {
  const items = [];
  for (const c of COURSES) {
    for (const form of ['A', 'B']) {
      for (let i = 1; i <= 10; i++) items.push(fxItem(`FX_${c}_${form}_${pad(i)}`, 'checkpoint', c, form, ((i - 1) % 5) + 1, '', 'abcd'[(i + (form === 'B' ? 1 : 0)) % 4]));
    }
    for (let i = 1; i <= 3; i++) items.push(fxItem(`FX_${c}_PR_${pad(i)}`, 'predict', c, 'PR', i, '', 'abcd'[i % 4]));
  }
  return items;
}

// ------------------------------------------------------------ Baseline v2 (invented; ids MOCK-BL-…)
// Same blueprint as specs/22: Part 1 forms A/B/C × (22 case items + 10 logic items), Part 2 15 SJT +
// 23 rating statements (allow_nr on the 3rd, 10th and 13th), Part 3 10 core + 18 per module.
const STEPS = ['1 Define the Problem', '2 Break Problem into Issues', '3 Eliminate non key issues', '4 Issue analysis and workplan',
  '5 Conduct work items', '6 Synthesize finding from analysis'];
const MOVES = ['ASK', 'SHAPE', 'SIZE', 'CHECK', 'SO WHAT'];
const RATE_CHARTERS = ['1', '1', '1', '1', '2', '2', '2', '3', '3', '3', '3', '3', '4', '4', '4', '5', '5', '5', 'QWS', 'QWS', 'QWS', 'QWS', 'QWS'];
const NR_POSITIONS = [3, 10, 13];
const LEVELS_CORE = ['BA', 'BA', 'WK', 'WK', 'WK', 'WK', 'FO', 'FO', 'FO', 'LE'];
const LEVELS_MOD = ['BA', 'BA', 'BA', 'WK', 'WK', 'WK', 'WK', 'WK', 'WK', 'FO', 'FO', 'FO', 'FO', 'FO', 'FO', 'LE', 'LE', 'LE'];
const BL_FORMS = ['A', 'B', 'C'];
const BL_MODULES = ['DP', 'SP', 'RPM', 'CS'];

function blBase(id, assessment, part, section, type, form, order, extra) {
  const o = {
    item_id: id, assessment, part: String(part), section, module: '', item_type: type, form, order: String(order), case_id: '', exhibit_ids: '',
    stem_en: '', stem_vi: '', answer: '', answer_most: '', answer_least: '', why_en: '', why_vi: '', self_en: '', self_vi: '', mgr_en: '', mgr_vi: '',
    anchor1_en: '', anchor1_vi: '', anchor4_en: '', anchor4_vi: '', allow_nr: '', step: '', move: '', objective: '', gate: '', level: '', charter: '', active: 'TRUE'
  };
  for (const l of 'abcd') { o[l + '_en'] = ''; o[l + '_vi'] = ''; }
  return Object.assign(o, extra || {});
}

function withOptions(o) {
  o.stem_en = `Mock question ${o.item_id}: which option is best?`;
  o.stem_vi = `Câu hỏi mẫu ${o.item_id}: phương án nào tốt nhất?`;
  for (const l of 'abcd') { o[l + '_en'] = `Mock option ${l.toUpperCase()} of ${o.item_id}`; o[l + '_vi'] = `Phương án mẫu ${l.toUpperCase()} của ${o.item_id}`; }
  o.why_en = `Mock reason for ${o.item_id}.`;
  o.why_vi = `Lý do mẫu cho ${o.item_id}.`;
  return o;
}

function buildBaselineItems() {
  const items = [];
  BL_FORMS.forEach((form, fi) => {
    for (let i = 1; i <= 22; i++) {
      const caseId = i <= 11 ? 'C1' : 'C2';
      items.push(withOptions(blBase(`MOCK-BL-1${form}-A${pad(i)}`, 'baseline_p1', 1, 'A', 'mcq', form, i, {
        case_id: caseId, exhibit_ids: i % 3 === 0 ? `MOCK-EX-${form}-${caseId}-T1;MOCK-EX-${form}-${caseId}-T2` : `MOCK-EX-${form}-${caseId}-T1`,
        answer: 'abcd'[(i + fi) % 4], step: STEPS[(i - 1) % STEPS.length], move: MOVES[(i - 1) % MOVES.length], objective: 'Mock objective'
      })));
    }
    for (let i = 1; i <= 10; i++) {
      items.push(withOptions(blBase(`MOCK-BL-1${form}-B${pad(i)}`, 'baseline_p1', 1, 'B', 'mcq', form, 22 + i, {
        answer: 'abcd'[(i + fi + 1) % 4], step: 'Logical reasoning', move: '—', objective: 'Mock logic'
      })));
    }
  });
  for (let i = 1; i <= 15; i++) {
    const most = 'abcd'[i % 4], least = 'abcd'[(i + 2) % 4];
    items.push(withOptions(blBase(`MOCK-BL-2S${pad(i)}`, 'baseline_p2', 2, 'SJT', 'sjt', 'ONE', i, {
      answer_most: most, answer_least: least, charter: String(Math.floor((i - 1) / 3) + 1)
    })));
  }
  RATE_CHARTERS.forEach((c, k) => {
    const i = k + 1, id = `MOCK-BL-2R${pad(i)}`;
    items.push(blBase(id, 'baseline_p2', 2, 'RATE', 'rating', 'ONE', i, {
      self_en: `I do mock behaviour ${i}.`, self_vi: `Tôi làm hành vi mẫu ${i}.`,
      mgr_en: `He/she does mock behaviour ${i}.`, mgr_vi: `Anh/chị ấy làm hành vi mẫu ${i}.`,
      anchor1_en: `Rarely shows mock behaviour ${i}.`, anchor1_vi: `Hiếm khi có hành vi mẫu ${i}.`,
      anchor4_en: `Always shows mock behaviour ${i}.`, anchor4_vi: `Luôn có hành vi mẫu ${i}.`,
      allow_nr: NR_POSITIONS.includes(i) ? 'TRUE' : '', charter: c
    }));
  });
  for (let i = 1; i <= 10; i++) {
    items.push(withOptions(blBase(`MOCK-BL-3CORE${pad(i)}`, 'baseline_p3', 3, 'CORE', 'mcq', 'ONE', i, {
      answer: 'abcd'[(i + 3) % 4], level: LEVELS_CORE[i - 1], gate: 'G' + (i % 4), exhibit_ids: i === 4 ? 'MOCK-EX-3-CORE-1' : '', objective: 'Mock core objective'
    })));
  }
  BL_MODULES.forEach((m, mi) => {
    for (let i = 1; i <= 18; i++) {
      items.push(withOptions(blBase(`MOCK-BL-3${m}${pad(i)}`, 'baseline_p3', 3, 'MOD', 'mcq', 'ONE', 10 + mi * 18 + i, {
        module: m, answer: 'abcd'[(i + mi) % 4], level: LEVELS_MOD[i - 1], gate: 'G' + ((i + mi) % 5), objective: 'Mock module objective',
        exhibit_ids: i === 5 ? `MOCK-EX-3-${m}-1` : ''
      })));
    }
  });
  return items;
}

function buildExhibits() {
  const ex = [];
  for (const form of BL_FORMS) {
    for (const c of ['C1', 'C2']) {
      ex.push({ exhibit_id: `MOCK-EX-${form}-${c}-T1`, part: '1', form, title_en: `Mock table 1 (${c})`, title_vi: `Bảng mẫu 1 (${c})`,
        md_en: '| Month | Units |\n|---|---|\n| M1 | 100 |\n| M2 | 120 |', md_vi: '| Tháng | Đơn vị |\n|---|---|\n| M1 | 100 |\n| M2 | 120 |' });
      ex.push({ exhibit_id: `MOCK-EX-${form}-${c}-T2`, part: '1', form, title_en: `Mock facts (${c})`, title_vi: `Dữ kiện mẫu (${c})`,
        md_en: '- Region: North\n- Week: 12', md_vi: '- Vùng: Bắc\n- Tuần: 12' });
    }
  }
  ex.push({ exhibit_id: 'MOCK-EX-3-CORE-1', part: '3', form: 'ONE', title_en: 'Mock core exhibit', title_vi: 'Phụ lục mẫu', md_en: '| Gate | Day |\n|---|---|\n| G1 | Mon |', md_vi: '| Cổng | Ngày |\n|---|---|\n| G1 | T2 |' });
  for (const m of BL_MODULES) ex.push({ exhibit_id: `MOCK-EX-3-${m}-1`, part: '3', form: 'ONE', title_en: `Mock ${m} exhibit`, title_vi: `Phụ lục mẫu ${m}`, md_en: '- Mock: 1', md_vi: '- Mẫu: 1' });
  return ex;
}

function buildBaselineText() {
  const t = [];
  const add = (key, en, vi) => t.push({ key, en, vi: vi || 'VI ' + en });
  add('p1_title', 'Part 1 · Mock problem solving'); add('p1_sec_A', 'Section A · Mock cases'); add('p1_sec_B', 'Section B · Mock logic');
  for (const f of BL_FORMS) {
    add('p1_sec_B_intro_' + f, `Mock logic intro for form ${f}.`);
    add(`p1_case_${f}_C1`, `Mock case one (${f})`); add(`p1_case_${f}_C2`, `Mock case two (${f})`);
  }
  add('p2_title', 'Part 2 · Mock behaviours'); add('p2_sec_SJT', '2A · Mock situations'); add('p2_sec_SJT_intro', 'Pick the most and the least effective option.');
  add('p2_sec_RATE', '2B · Mock self-rating'); add('p2_sec_RATE_intro', 'Rate how often you do each.');
  ['Rarely', 'Sometimes', 'Often', 'Almost always'].forEach((x, i) => add('p2_scale_' + (i + 1), (i + 1) + ' · ' + x));
  add('p2_scale_na', 'N/A · not observed'); add('p2_scale_nr', 'Not my role');
  ['1', '2', '3', '4', '5'].forEach((c) => add('p2_charter_' + c, 'Mock charter ' + c)); add('p2_charter_QWS', 'Mock QWS');
  add('p2_rater_guide', 'Rate what you have **seen** in the last six months.\n1. Use the anchors.\n2. Use *N/A* when you have not seen it.');
  add('p3_title', 'Part 3 · Mock core planning'); add('p3_intro', 'Mock intro for Part 3.'); add('p3_sec_CORE', 'Mock S&OP core');
  for (const m of BL_MODULES) add('p3_sec_' + m, 'Mock module ' + m);
  ['FA: mock forecast accuracy', 'Bias: mock bias', 'FVA: mock value added'].forEach((x, i) => add('p3_glossary_' + (i + 1), x));
  return t;
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
    person('T060', 'Fixture Leaver Oscar', 'cs', { active: 'FALSE', manager_code: 'T010' })
  ];
}

/**
 * Accounts for the local dev server (backend/dev/server.mjs). T007 has all three baseline parts done
 * and T010's manager rating at start-up (profile once results_open is on); T050 (admin) rates T010.
 */
function devRoster() {
  return [
    person('T001', 'Fixture Learner Alpha', 'demand', { manager_code: 'T010', consent_at: '' }),
    person('T002', 'Fixture Learner Bravo', 'supply', { manager_code: 'T010', consent_at: '' }),
    person('T003', 'Fixture Learner Charlie', 'materials', { manager_code: 'T010', consent_at: '' }),
    person('T004', 'Fixture Learner Delta', 'cs', { consent_at: '' }),
    person('T005', 'Fixture Learner Echo', 'demand', { consent_at: '' }),
    person('T006', 'Fixture Learner Foxtrot', 'supply', { consent_at: '' }),
    person('T007', 'Fixture Learner Golf', 'materials', { manager_code: 'T010' }),
    person('T010', 'Fixture Manager Juliet', 'demand', { is_manager: 'TRUE', roles: 'learner;manager', manager_code: 'T050', consent_at: '' }),
    person('T020', 'Fixture Judge Kilo', '', { roles: 'panel', consent_at: '' }),
    person('T030', 'Fixture Newcomer Lima', 'cs', { must_change_pin: 'TRUE', consent_at: '' }),
    person('T050', 'Fixture Admin November', '', { roles: 'admin', consent_at: '' })
  ];
}

/**
 * Sets up the fake Sheet and loads the fixtures.
 * opts.roster, opts.courseDates(code) → {online_from, …} overrides, opts.config {key: value},
 * opts.teams, opts.baseline (false = leave the baseline tabs empty).
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
  if (opts.baseline !== false) {
    h.appendObjects('BaselineItems', buildBaselineItems());
    h.appendObjects('Exhibits', buildExhibits());
    h.appendObjects('BaselineText', buildBaselineText());
  }
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

module.exports = { COURSES, PIN, buildItems, courseRow, CASES, testRoster, devRoster, loadFixtures, fxItem, buildBaselineItems, buildExhibits, buildBaselineText, BL_FORMS, BL_MODULES, NR_POSITIONS };
