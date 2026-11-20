// Tests for tools/agenda-model.mjs: the real agenda model, today's (legacy) figure, and one seeded faulty
// model (mutant) per rule. Each mutant must fail its rule, with a readable message or counterexample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { root, loadModel, loadContext, checkModel, checkWellFormed, checkProperties, replay, umlLabel, heroProps } from './agenda-model.mjs';
import { build, MODEL } from './build-agenda.mjs';

/* ---------- the generator (tools/build-agenda.mjs) ---------- */

const quiet = () => {};
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'agenda-'));
  for (const p of ['tools', 'data', 'news/posts']) await cp(join(root, p), join(dir, p), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  for (const f of ['research-data.js', 'agenda-data.js', 'agenda.scxml', 'img/agenda-statechart.svg']) { await mkdir(join(dir, 'assets', 'img'), { recursive: true }); await cp(join(root, 'assets', f), join(dir, 'assets', f)); }
  await cp(join(root, 'index.html'), join(dir, 'index.html'));
  return dir;
}

test('the page is up to date with the agenda model (build-agenda --check)', async () => {
  const r = await build({ check: true, log: quiet });
  assert.deepEqual(r.stale, []);
});

test('a hand edit inside the generated block is reported as stale, and a rebuild restores it', async () => {
  const dir = await sandbox(), path = join(dir, 'index.html'), original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('foundational contract</text>', 'a hand-edited contract</text>'));
  await assert.rejects(build({ dir, check: true, log: quiet }), /Stale agenda output: index\.html/);
  await build({ dir, log: quiet });
  assert.deepEqual((await build({ dir, check: true, log: quiet })).stale, []);
  assert.equal((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'), original.replace(/\r\n/g, '\n'));
});

test('the generator refuses a page without the markers', async () => {
  const dir = await sandbox(), path = join(dir, 'index.html');
  await writeFile(path, (await readFile(path, 'utf8')).replace('<!-- BEGIN GENERATED AGENDA -->', ''));
  await assert.rejects(build({ dir, check: true, log: quiet }), /needs the <!-- BEGIN GENERATED AGENDA -->/);
});

test('W8 on the outputs: a withheld term in generated text fails the build', async () => {
  const dir = await sandbox(), path = join(dir, MODEL), m = JSON.parse(await readFile(path, 'utf8'));
  const c = await loadContext();
  m.cards[0].body += ' ' + c.hidden.source.replace(/^\(\?:/, '').split('|')[0];
  await writeFile(path, JSON.stringify(m));
  await assert.rejects(build({ dir, check: true, log: quiet }), /W8: index\.html agenda block contains a withheld term/);
});

test('the SCXML export has the initial state, every state and transition, and the retry bound', async () => {
  const x = await readFile(join(root, 'assets', 'agenda.scxml'), 'utf8');
  assert.match(x, /<scxml xmlns="http:\/\/www\.w3\.org\/2005\/07\/scxml" version="1\.0"[^>]* initial="human">/);
  assert.equal((x.match(/<state id=/g) || []).length, model.states.length);
  assert.equal((x.match(/<transition /g) || []).length, model.transitions.length);
  // ② and ③ share the event and split on complementary conditions; ④ is guarded by the bound, ⑤ is its else.
  assert.match(x, /event="report" cond="_event\.data\.contractHolds" target="human"/);
  assert.match(x, /event="report" cond="!_event\.data\.contractHolds" target="quarantine">.*<assign location="tries" expr="tries \+ 1"\/>/);
  assert.match(x, /<transition cond="screenClean &amp;&amp; tries &lt; k" target="ai">[\s\S]*?<transition target="human">/);
  assert.match(x, /<!-- state invariant: nothing exposed in use -->/);
});

test('the static figure shows every step and no token', async () => {
  const svg = await readFile(join(root, 'assets', 'img', 'agenda-statechart.svg'), 'utf8');
  assert.match(svg, /^<\?xml/);
  const steps = model.transitions.flatMap(t => (t.steps || []).map(s => s.c));
  assert.equal((svg.match(/<g class="node on"/g) || []).length, steps.length);
  for (const s of steps) assert.match(svg, new RegExp(`>${s}</text>`));
  assert.doesNotMatch(svg, /class="tok/);
  assert.match(svg, /<desc id="agenda-desc">UML state machine with 3 states/);
});

const ctx = await loadContext();
const model = await loadModel(join(root, 'data', 'agenda.statechart.json'));
const legacy = await loadModel(join(root, 'tools', 'fixtures', 'agenda-legacy.statechart.json'));
// Mutants are checked against a context whose hero lists the note's properties, so a mutant fails only
// the rule it targets; the live hero sentence is checked against the note by the W9 test.
const ctxAgreed = { ...ctx, hero: model.comment.props };

const mutate = fn => { const m = structuredClone(model); fn(m); return m; };
const T = (m, id) => m.transitions.find(t => t.id === id);
const S = (m, id) => m.states.find(s => s.id === id);
const failing = (m, c = ctxAgreed) => [...new Set(checkModel(m, c).errors.map(e => e.rule))].sort();
const errorsFor = (m, rule, c = ctxAgreed) => checkModel(m, c).errors.filter(e => e.rule === rule);
const failsWith = (m, rule, pattern, c) => {
  const es = errorsFor(m, rule, c);
  assert.ok(es.length, `expected ${rule} to fail; failing rules: ${failing(m, c).join(', ') || 'none'}`);
  if (pattern) assert.match(es.map(e => e.msg).join('\n'), pattern);
};

/* ---------- the real model ---------- */

test('the agenda model passes W1–W8, the budget, and V1–V6, over 7 reachable nodes', () => {
  const r = checkModel(model, ctxAgreed);
  assert.deepEqual(r.errors, []);
  assert.equal(r.nodes, 7);
  assert.deepEqual(r.overflow, []);
});

test('W9: the contract note and the hero sentence list the same properties', () => {
  assert.deepEqual(errorsFor(model, 'W9', ctx), []);
});

test('every UML label fits the budget and reads trigger [guard] / effect', () => {
  assert.equal(umlLabel(T(model, 'bind'), model), 'delegate [concerns modeled] / model; specify; compose; verify');
  assert.equal(umlLabel(T(model, 'withdraw'), model), 'report [contract violated] / withdraw closure; tries++');
  assert.equal(umlLabel(T(model, 'revalidate'), model), '[screen clean ∧ tries < k] / re-admit');
  assert.equal(umlLabel(T(model, 'escalate'), model), '[else] / explain affected set');
});

test('the hero sentence parser reads the property list', () => {
  assert.deepEqual(heroProps('make it accountable: attributable, traceable, and correctable, so that people'), ['attributable', 'traceable', 'correctable']);
  assert.deepEqual(heroProps('accountable: bounded, attributable, traceable, and correctable, so that'), ['bounded', 'attributable', 'traceable', 'correctable']);
});

/* ---------- today's figure ---------- */

test("today's figure fails exactly the rules that motivate the change", () => {
  // W1: no initial pseudostate. W7: its dots are not the steps of any effect. W9: no contract.
  // budget: five dots on ①. V2/V5: no containment, so violations are not handled.
  assert.deepEqual(failing(legacy, ctx), ['V2', 'V5', 'W1', 'W7', 'W9', 'budget']);
});

/* ---------- well-formedness mutants ---------- */

test('W1: a missing or dangling initial pseudostate fails', () => {
  failsWith(mutate(m => delete m.initial), 'W1', /no initial pseudostate/);
  failsWith(mutate(m => { m.initial = 'nowhere'; }), 'W1', /undeclared state "nowhere"/);
  failsWith(mutate(m => { m.initial = ['human', 'ai']; }), 'W1', /exactly one outgoing transition/);
});

test('W2: undeclared states and duplicate ids fail', () => {
  failsWith(mutate(m => { T(m, 'escalate').to = 'person'; }), 'W2', /enters undeclared state "person"/);
  failsWith(mutate(m => { T(m, 'escalate').id = 'bind'; }), 'W2', /duplicate id "bind"/);
});

test('W3: undeclared guards, two [else] branches, and false complements fail', () => {
  failsWith(mutate(m => { T(m, 'bind').guard = ['ready']; }), 'W3', /undeclared guard "ready"/);
  failsWith(mutate(m => { T(m, 'revalidate').guard = 'else'; }), 'W3', /2 \[else\] transitions leave quarantine/);
  failsWith(mutate(m => { m.guards.contractViolated.complement = 'screenClean'; }), 'W3', /not its mutual env complement/);
});

test('W4: two transitions enabled by one report are nondeterministic', () => {
  failsWith(mutate(m => { T(m, 'withdraw').guard = []; }), 'W4', /account and withdraw are both enabled at ai on report when .*contractHolds=true/);
});

test('W5: a completion that can get stuck, or a report with no outcome, fails', () => {
  failsWith(mutate(m => { m.transitions = m.transitions.filter(t => t.id !== 'escalate'); }), 'W5', /completion at quarantine can get stuck/);
  failsWith(mutate(m => { T(m, 'withdraw').guard = ['contractViolated', 'screenClean']; }), 'W5', /at ai on report no outcome is enabled/);
  // A plain guard on a triggered transition discards the event, as UML says: not a W5 failure.
  assert.deepEqual(errorsFor(model, 'W5'), []);
});

test('W6: a completion transition needs an entry behaviour to complete', () => {
  failsWith(mutate(m => { S(m, 'quarantine').entry = []; }), 'W6', /"revalidate" leaves quarantine, which has no entry behaviour/);
});

test('W7: the dots on an arc are exactly its effect steps, in order; variable updates are not dots', () => {
  failsWith(mutate(m => { const s = T(m, 'bind').steps; [s[0], s[1]] = [s[1], s[0]]; }), 'W7', /dots on "bind" \(specify, model/);
  failsWith(mutate(m => { T(m, 'account').steps.push({ c: 'oversee', d: 'x', refs: [] }); }), 'W7', /not its effect steps/);
  failsWith(mutate(m => { T(m, 'withdraw').steps = [{ c: 'withdraw closure', d: 'x', refs: [] }, { c: 'tries++', d: 'x', refs: [] }]; }), 'W7', /\(withdraw closure\)/);
});

test('W8: references resolve to the CV data, and no withheld term appears', () => {
  failsWith(mutate(m => { T(m, 'bind').steps[0].refs = ['NoSuchTool']; }), 'W8', /"NoSuchTool" resolves to no project/);
  failsWith(mutate(m => { m.cards[0].chips.push({ anon: 'anonymous-review-9' }); }), 'W8', /"anonymous-review-9"/);
  failsWith(mutate(m => { m.cards[1].chips.push({ label: '[anonymous for review]', find: 'Agent Slicing' }); }), 'W8', /must use an anonymous-review key/);
  // The public builder's own identifying-terms list, read rather than repeated here.
  const term = ctx.hidden.source.replace(/^\(\?:/, '').split('|')[0];
  failsWith(mutate(m => { m.cards[2].body += ` ${term}`; }), 'W8', /withheld term \(identifying review term\)/);
  failsWith(mutate(m => { m.lead += ' codename-zeta'; }), 'W8', /deny-list term/, { ...ctxAgreed, deny: ['codename-zeta'] });
});

test('W9: hero agreement, chip status words, and published numbers', () => {
  failsWith(model, 'W9', /hero sentence lists \{attributable\}/, { ...ctx, hero: ['attributable'] });
  failsWith(mutate(m => { m.cards[0].chips[0].label = 'SSEVOH-DSL · accepted at TSE'; }), 'W9', /says "accepted", but the CV status is/);
  failsWith(mutate(m => { m.cards[2].body += ' The live study suspended 42.7% of items.'; }), 'W9', /"42\.7%" is not in the CV data/);
  // A number the CV data already states is allowed.
  assert.ok(ctx.researchText.includes('36.1%'));
  assert.deepEqual(errorsFor(mutate(m => { m.cards[1].body += ' Slicing recovers 36.1% of cases.'; }), 'W9'), []);
});

test('budget: more than three states, or a label that is too long, fails', () => {
  failsWith(mutate(m => { m.states.push({ id: 'audit', name: 'Audit', entry: ['log'] }); }), 'budget', /4 states/);
  failsWith(mutate(m => { T(m, 'bind').effect.push('and then several more steps'); }), 'budget', /UML label of "bind"/);
});

/* ---------- temporal-property mutants ----------
   V1–V5 verdicts and node counts match the Python prototype. The prototype has no V6; these mutants also
   fail V6 because the animation's runs use the transitions they delete or redirect. */

const verdicts = m => Object.entries(checkProperties(m).results).filter(([, r]) => !r.ok).map(([v]) => v).sort();
const nodes = m => checkProperties(m).nodes;

test('deleting ④ and ⑤ breaks V1, V3, V4 and V5 (and V6)', () => {
  const m = mutate(m => { m.transitions = m.transitions.filter(t => !['revalidate', 'escalate'].includes(t.id)); });
  assert.deepEqual(verdicts(m), ['V1', 'V3', 'V4', 'V5', 'V6']);
  assert.equal(nodes(m), 4);
});
test('pointing ③ at Human breaks V2 and V5 (and V6)', () => {
  const m = mutate(m => { T(m, 'withdraw').to = 'human'; });
  assert.deepEqual(verdicts(m), ['V2', 'V5', 'V6']);
  assert.equal(nodes(m), 4);
});
test('deleting ③ breaks V2 and V5 (and V6)', () => {
  const m = mutate(m => { m.transitions = m.transitions.filter(t => t.id !== 'withdraw'); });
  assert.deepEqual(verdicts(m), ['V2', 'V5', 'V6']);
  assert.equal(nodes(m), 3);
});
test('dropping the retry bound breaks V4 only, with the Quarantine → AI → Quarantine cycle as counterexample', () => {
  const m = mutate(m => { T(m, 'revalidate').guard = ['screenClean']; });
  assert.deepEqual(verdicts(m), ['V4']);
  const { cex } = checkProperties(m).results.V4;
  assert.match(cex.text, /^human -bind-> ai -withdraw-> quarantine -revalidate-> ai -withdraw-> quarantine/);
  assert.match(cex.text, /cycle back to step \d+: repeats forever without reaching the person/);
  // Printed in the same format as runs, so the witness can be pasted into the model and animated.
  assert.deepEqual(cex.path.slice(0, 4), ['bind', 'withdraw', 'revalidate', 'withdraw']);
  // Every step of the witness is a legal move; it only fails to end with the person.
  assert.match(replay(m, cex.path), /^ends in (ai|quarantine), not with the person/);
});

test('V3: a Quarantine with no way out is a trap, shown as a run', () => {
  const m = mutate(m => { T(m, 'revalidate').to = 'quarantine'; T(m, 'escalate').to = 'quarantine'; });
  const r = checkProperties(m).results.V3;
  assert.equal(r.ok, false);
  assert.match(r.cex.text, /^human -bind-> ai -withdraw-> quarantine/);
});

test('V6: every run is a valid trace that ends with the person', () => {
  assert.equal(replay(model, ['bind', 'account']), null);
  assert.equal(replay(model, ['bind', 'withdraw', 'escalate']), null);
  assert.equal(replay(model, ['bind', 'withdraw', 'revalidate', 'account']), null);
  failsWith(mutate(m => { m.runs[0].path = ['bind', 'escalate']; }), 'V6', /"escalate" leaves quarantine, but the machine is in ai/);
  failsWith(mutate(m => { m.runs[0].path = ['bind', 'withdraw']; }), 'V6', /ends in quarantine, not with the person/);
  // The retry bound is part of the trace semantics: a third re-admission is not a valid run.
  failsWith(mutate(m => { m.runs[1].alt = ['bind', 'withdraw', 'revalidate', 'withdraw', 'revalidate', 'account']; }), 'V6', /no valuation of the guards lets "revalidate" fire from quarantine \{tries=2\}/);
  failsWith(mutate(m => { m.runs = []; }), 'V6', /no runs/);
});

test('the checker is independent of the page: rules W1–W7 and V1–V6 need no CV context', () => {
  assert.deepEqual(checkWellFormed(model, null), []);
});
