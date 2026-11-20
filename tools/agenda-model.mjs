// The agenda statechart as a checked model: UML well-formedness rules W1–W9, a readability budget, and
// temporal properties V1–V6 decided by an explicit-state model checker over the model's Kripke structure.
// Port of docs/superpowers/specs/2026-11-20-agenda-checker-prototype.py, driven by data/agenda.statechart.json.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ROLES = { person: 'human', agent: 'ai', contained: 'quarantine', violation: 'withdraw' };
export const BUDGET = { states: 3, transitions: 5, stepsPerArc: 4, dottedArcs: 2, labelChars: 64 };
const STATUS_WORDS = ['submitted', 'accepted', 'published', 'to appear', 'under review', 'in review', 'revision', 'on-going'];
export const ANON_LABEL = '[anonymous for review]';

/* ---------- context: CV data, hero sentence, news, deny-list ---------- */

// The same identifying-terms list the public builder refuses to publish.
export async function hiddenPattern(dir = root) {
  const src = await readFile(join(dir, 'tools', 'build-public.mjs'), 'utf8');
  const m = src.match(/const hidden = \/(.+)\/i;/);
  return m ? new RegExp(m[1], 'i') : null;
}

export function heroProps(html) {
  const m = html.match(/accountable:\s*([a-z ,]+?),\s*so that/i);
  return m ? m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim().toLowerCase()).filter(Boolean) : null;
}

export async function loadContext(dir = root) {
  const dataSrc = await readFile(join(dir, 'assets', 'research-data.js'), 'utf8');
  const sandbox = { window: {} }; vm.runInNewContext(dataSrc, sandbox);
  const postsDir = join(dir, 'news', 'posts');
  const news = existsSync(postsDir) ? (await Promise.all((await readdir(postsDir)).filter(f => f.endsWith('.md')).map(f => readFile(join(postsDir, f), 'utf8')))).join('\n') : '';
  const privatePath = join(dir, 'tools', 'agenda-private.txt');
  const deny = existsSync(privatePath) ? (await readFile(privatePath, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
  const indexPath = join(dir, 'index.html');
  return {
    research: sandbox.window.RESEARCH, researchText: dataSrc, newsText: news,
    hero: existsSync(indexPath) ? heroProps(await readFile(indexPath, 'utf8')) : null,
    hidden: await hiddenPattern(dir), deny, denyFile: existsSync(privatePath),
  };
}

/* ---------- reference resolution (W8) ---------- */

export function resolveRef(ref, R) {
  if (/^anonymous-review-\d+$/.test(ref)) {
    const e = R.submitted.find(s => s.key === ref && s.anonymous);
    return e ? { anon: true, label: ANON_LABEL, entry: e } : null;
  }
  const project = R.projects.find(p => p.name === ref || p.name.split(' / ')[0] === ref || p.name.startsWith(ref));
  const pub = [...R.published, ...R.submitted].find(p => !p.anonymous && p.title && p.title.startsWith(ref));
  if (!project && !pub) return null;
  return { anon: false, label: ref, project, entry: pub, status: [project?.status, pub?.status].filter(Boolean).join(' · ') };
}
export const refLabel = (ref, R) => resolveRef(ref, R)?.label ?? ref;

/* ---------- guards, expressions, effects ---------- */

const guardList = g => g === 'else' ? 'else' : Array.isArray(g) ? g : g == null ? [] : [g];
const UPDATE = /^(\w+)\s*(\+\+|--|:=\s*(\w+))$/;
export const isUpdate = (effect, model) => { const m = String(effect).match(UPDATE); return !!(m && model.variables && m[1] in model.variables); };
export const drawable = (t, model) => (t.effect || []).filter(e => !isUpdate(e, model));

function operand(tok, vars, consts) {
  if (/^-?\d+$/.test(tok)) return Number(tok);
  if (tok in vars) return vars[tok];
  if (consts && tok in consts) return consts[tok];
  throw new Error(`unknown name "${tok}"`);
}
export function evalExpr(expr, vars, consts) {
  const m = String(expr).match(/^\s*(\w+)\s*(<=|>=|==|!=|<|>)\s*(\w+)\s*$/);
  if (!m) throw new Error(`cannot parse expression "${expr}"`);
  const a = operand(m[1], vars, consts), b = operand(m[3], vars, consts);
  return { '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b, '==': a === b, '!=': a !== b }[m[2]];
}

// Env variables: one boolean per env guard, a complementary pair sharing one.
export function envVars(model) {
  const vars = [];
  for (const [id, g] of Object.entries(model.guards || {})) if (g.env && !(g.complement && vars.includes(g.complement))) vars.push(id);
  return vars;
}
export function envValuations(model) {
  const vars = envVars(model); const out = [];
  for (let mask = 0; mask < 1 << vars.length; mask++) out.push(Object.fromEntries(vars.map((v, i) => [v, !!(mask >> i & 1)])));
  return out;
}
function guardValue(model, id, env, vars) {
  const g = model.guards[id];
  if (g.env) return id in env ? env[id] : !env[g.complement];
  return evalExpr(g.expr, vars, model.constants);
}
const guardHolds = (model, t, env, vars) => { const g = guardList(t.guard); return g === 'else' || g.every(id => guardValue(model, id, env, vars)); };

// UML semantics: guarded transitions first; `else` only when none of its siblings is enabled.
export function enabled(model, state, trigger, env, vars) {
  const group = model.transitions.filter(t => t.from === state && (t.trigger ?? null) === trigger);
  const regular = group.filter(t => guardList(t.guard) !== 'else' && guardHolds(model, t, env, vars));
  return regular.length ? regular : group.filter(t => guardList(t.guard) === 'else');
}

function applyUpdates(model, effects, vars, overflow) {
  const v = { ...vars };
  for (const e of effects || []) {
    const m = String(e).match(UPDATE); if (!m || !(m[1] in (model.variables || {}))) continue;
    const dom = model.variables[m[1]];
    let x = m[2] === '++' ? v[m[1]] + 1 : m[2] === '--' ? v[m[1]] - 1 : operand(m[3], v, model.constants);
    if (x > dom.max || x < dom.min) { overflow?.add(`${m[1]} leaves ${dom.min}..${dom.max} on "${e}"`); x = Math.max(dom.min, Math.min(dom.max, x)); }
    v[m[1]] = x;
  }
  return v;
}
const stateOf = (model, id) => model.states.find(s => s.id === id);
function fire(model, t, vars, overflow) {
  const after = applyUpdates(model, t.effect, vars, overflow);
  return applyUpdates(model, stateOf(model, t.to)?.entry, after, overflow);
}
const initVars = model => Object.fromEntries(Object.entries(model.variables || {}).map(([k, d]) => [k, d.init]));
export function varValuations(model) {
  let out = [{}];
  for (const [k, d] of Object.entries(model.variables || {})) { const next = []; for (const v of out) for (let x = d.min; x <= d.max; x++) next.push({ ...v, [k]: x }); out = next; }
  return out;
}

/* ---------- Kripke structure ---------- */

const key = n => `${n.state}|${JSON.stringify(n.vars)}|${n.last ?? ''}`;

export function successors(model, node, overflow) {
  const out = new Map(); const add = (n, via) => { const k = key(n); if (!out.has(k)) out.set(k, { node: n, via }); };
  const triggers = [...new Set(model.transitions.filter(t => t.from === node.state && t.trigger != null).map(t => t.trigger))];
  for (const env of envValuations(model)) {
    // A completion transition fires when the entry behaviour finishes; otherwise any event may arrive.
    const completion = enabled(model, node.state, null, env, node.vars);
    if (completion.length) { for (const t of completion) add({ state: t.to, vars: fire(model, t, node.vars, overflow), last: t.id }, t.id); continue; }
    for (const trig of triggers) {
      const en = enabled(model, node.state, trig, env, node.vars);
      if (!en.length) add(node, null); // event discarded: the machine stays where it is
      for (const t of en) add({ state: t.to, vars: fire(model, t, node.vars, overflow), last: t.id }, t.id);
    }
  }
  return [...out.values()];
}

export function explore(model) {
  const overflow = new Set();
  const init = { state: model.initial, vars: applyUpdates(model, stateOf(model, model.initial)?.entry, initVars(model), overflow), last: null };
  const nodes = new Map([[key(init), init]]), edges = new Map(), parent = new Map([[key(init), null]]);
  const queue = [init];
  while (queue.length) {
    const n = queue.shift(), succ = successors(model, n, overflow);
    edges.set(key(n), succ);
    for (const { node: m, via } of succ) if (!nodes.has(key(m))) { nodes.set(key(m), m); parent.set(key(m), { from: key(n), via }); queue.push(m); }
  }
  return { init, nodes, edges, parent, overflow: [...overflow] };
}

function fixEF(K, pred) {
  const good = new Set([...K.nodes].filter(([, n]) => pred(n)).map(([k]) => k)); let changed = true;
  while (changed) { changed = false; for (const k of K.nodes.keys()) if (!good.has(k) && K.edges.get(k).some(s => good.has(key(s.node)))) { good.add(k); changed = true; } }
  return good;
}
function fixAF(K, pred) {
  const good = new Set([...K.nodes].filter(([, n]) => pred(n)).map(([k]) => k)); let changed = true;
  while (changed) { changed = false; for (const k of K.nodes.keys()) { const s = K.edges.get(k); if (!good.has(k) && s.length && s.every(x => good.has(key(x.node)))) { good.add(k); changed = true; } } }
  return good;
}

/* ---------- counterexamples, printed as runs ---------- */

function prefix(K, k) {
  const steps = []; let cur = k;
  while (K.parent.get(cur)) { const p = K.parent.get(cur); steps.unshift({ via: p.via, to: K.nodes.get(cur) }); cur = p.from; }
  return steps;
}
export function formatRun(K, steps, suffix = '') {
  let s = K.init.state;
  for (const st of steps) s += st.via ? ` -${st.via}-> ${st.to.state}` : ` -(discarded)-> ${st.to.state}`;
  const vars = steps.length ? steps.at(-1).to.vars : K.init.vars;
  if (Object.keys(vars).length) s += ` {${Object.entries(vars).map(([a, b]) => `${a}=${b}`).join(', ')}}`;
  return { text: s + suffix, path: steps.map(x => x.via).filter(Boolean) };
}
// A path that never reaches the person: follow nodes outside AF(person) until one repeats (a cycle) or has no successor.
function lasso(K, start, af) {
  const seen = new Map(), steps = []; let cur = start;
  while (true) {
    seen.set(cur, steps.length);
    const next = K.edges.get(cur).find(s => !af.has(key(s.node)));
    if (!next) return { steps, end: ' (deadlock: no move leads anywhere)' };
    steps.push({ via: next.via, to: next.node }); const nk = key(next.node);
    if (seen.has(nk)) return { steps, end: ` (cycle back to step ${seen.get(nk)}: repeats forever without reaching the person)` };
    cur = nk;
  }
}

/* ---------- temporal properties V1–V6 ---------- */

export function checkProperties(model) {
  const roles = { ...DEFAULT_ROLES, ...(model.roles || {}) };
  const res = {};
  // Without an initial pseudostate (W1 fails) the properties are still decided, from the person's state,
  // so the report shows what else the figure lacks.
  if (!model.initial || !stateOf(model, model.initial)) {
    if (!stateOf(model, roles.person)) { for (const v of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) res[v] = { ok: false, msg: 'no initial pseudostate and no person state: there is no run to check' }; return { results: res, nodes: 0 }; }
    model = { ...model, initial: roles.person };
  }
  const K = explore(model);
  const all = [...K.nodes.entries()];
  const is = id => n => n.state === id;

  const efPerson = fixEF(K, is(roles.person));
  const v1bad = all.find(([k]) => !efPerson.has(k));
  res.V1 = v1bad ? { ok: false, msg: 'the person cannot be reached again after', cex: formatRun(K, prefix(K, v1bad[0])) } : { ok: true };

  const viol = all.filter(([, n]) => n.last === roles.violation);
  const v2bad = viol.find(([, n]) => n.state !== roles.contained);
  res.V2 = !viol.length ? { ok: false, msg: `the violation transition "${roles.violation}" never fires: violations are not handled` }
    : v2bad ? { ok: false, msg: `a violation lands outside ${roles.contained}`, cex: formatRun(K, prefix(K, v2bad[0])) } : { ok: true };

  const v3bad = all.find(([k, n]) => n.state === roles.contained && !K.edges.get(k).some(s => s.node.state !== roles.contained));
  res.V3 = v3bad ? { ok: false, msg: `${roles.contained} is a trap: no move leaves it from`, cex: formatRun(K, prefix(K, v3bad[0])) } : { ok: true };

  const afPerson = fixAF(K, is(roles.person));
  const v4bad = all.find(([k, n]) => n.state === roles.contained && !afPerson.has(k));
  if (v4bad) { const l = lasso(K, v4bad[0], afPerson); res.V4 = { ok: false, msg: 'a containment need not end with the person', cex: formatRun(K, [...prefix(K, v4bad[0]), ...l.steps], l.end) }; }
  else res.V4 = { ok: true };

  const reached = new Set(all.map(([, n]) => n.state));
  const missing = [...new Set([roles.agent, roles.contained, ...model.states.map(s => s.id)])].filter(s => !reached.has(s));
  const efAgent = fixEF(K, is(roles.agent));
  const v5bad = all.find(([k]) => !efAgent.has(k));
  res.V5 = missing.length ? { ok: false, msg: `unreachable from the initial state: ${missing.join(', ')}` }
    : v5bad ? { ok: false, msg: `${roles.agent} cannot be reached again after`, cex: formatRun(K, prefix(K, v5bad[0])) } : { ok: true };

  const problems = [];
  for (const run of model.runs || []) for (const [which, path] of [['path', run.path], ['alt', run.alt]]) {
    if (!path) continue;
    const r = replay(model, path, roles);
    if (r) problems.push(`run "${run.id}" ${which}: ${r}`);
    if (run.every != null && !(Number.isInteger(run.every) && run.every > 1)) problems.push(`run "${run.id}": every must be an integer > 1`);
  }
  if (!(model.runs || []).length) problems.push('no runs: the animation has nothing to show');
  res.V6 = problems.length ? { ok: false, msg: problems.join('; ') } : { ok: true };

  return { results: res, nodes: K.nodes.size, overflow: K.overflow };
}

// V6: a run is valid when each transition leaves the current state, some env valuation lets the machine
// choose it, and the run ends with the person.
export function replay(model, path, roles = { ...DEFAULT_ROLES, ...(model.roles || {}) }) {
  let state = model.initial, vars = applyUpdates(model, stateOf(model, state)?.entry, initVars(model));
  for (const [i, id] of path.entries()) {
    const t = model.transitions.find(x => x.id === id);
    if (!t) return `step ${i + 1}: unknown transition "${id}"`;
    if (t.from !== state) return `step ${i + 1}: "${id}" leaves ${t.from}, but the machine is in ${state}`;
    const choosable = envValuations(model).some(env => {
      const completion = enabled(model, state, null, env, vars);
      const pool = completion.length ? completion : t.trigger == null ? [] : enabled(model, state, t.trigger, env, vars);
      return pool.includes(t);
    });
    if (!choosable) return `step ${i + 1}: no valuation of the guards lets "${id}" fire from ${state} {${Object.entries(vars).map(([a, b]) => `${a}=${b}`).join(', ')}}`;
    vars = fire(model, t, vars); state = t.to;
  }
  return state === roles.person ? null : `ends in ${state}, not with the person (${roles.person})`;
}

/* ---------- well-formedness W1–W9 and the readability budget ---------- */

export function umlLabel(t, model) {
  const g = guardList(t.guard);
  const guard = g === 'else' ? '[else]' : g.length ? `[${g.map(id => model.guards[id]?.text ?? id).join(' ∧ ')}]` : '';
  return [t.trigger, guard].filter(Boolean).join(' ') + ((t.effect || []).length ? ` / ${t.effect.join('; ')}` : '');
}
const plain = s => String(s ?? '').replace(/<[^>]+>/g, '');

export function checkWellFormed(model, ctx) {
  const err = []; const E = (rule, msg) => err.push({ rule, msg });
  const states = new Set(model.states.map(s => s.id));
  const guards = model.guards || {};

  // W1
  if (!model.initial) E('W1', 'no initial pseudostate (the model has no "initial")');
  else if (typeof model.initial !== 'string') E('W1', 'the initial pseudostate must have exactly one outgoing transition, to one state');
  else if (!states.has(model.initial)) E('W1', `the initial pseudostate points to undeclared state "${model.initial}"`);

  // W2
  const seen = new Set();
  for (const s of model.states) { if (seen.has(s.id)) E('W2', `duplicate id "${s.id}"`); seen.add(s.id); }
  for (const t of model.transitions) {
    if (seen.has(t.id)) E('W2', `duplicate id "${t.id}"`); seen.add(t.id);
    if (!states.has(t.from)) E('W2', `transition "${t.id}" leaves undeclared state "${t.from}"`);
    if (!states.has(t.to)) E('W2', `transition "${t.id}" enters undeclared state "${t.to}"`);
  }

  // W3
  for (const [id, g] of Object.entries(guards)) {
    if (!g.env && !g.expr) E('W3', `guard "${id}" is neither an env guard nor an expression`);
    if (g.complement) {
      const c = guards[g.complement];
      if (!c || c.complement !== id || !c.env || !g.env) E('W3', `guard "${id}" declares complement "${g.complement}", which is not its mutual env complement`);
    }
    if (g.expr) { try { evalExpr(g.expr, initVars(model), model.constants); } catch (e) { E('W3', `guard "${id}": ${e.message}`); } }
  }
  const elseCount = new Map();
  for (const t of model.transitions) {
    const g = guardList(t.guard);
    if (g === 'else') { const k = `${t.from}|${t.trigger ?? ''}`; elseCount.set(k, (elseCount.get(k) || 0) + 1); }
    else for (const id of g) if (!guards[id]) E('W3', `transition "${t.id}" uses undeclared guard "${id}"`);
  }
  for (const [k, n] of elseCount) if (n > 1) E('W3', `${n} [else] transitions leave ${k.replace('|', ' on ') || k}`);
  const guardsOk = !err.some(e => e.rule === 'W2' || e.rule === 'W3');

  // W4, W5: decided over every env valuation and every value of the variables.
  if (guardsOk) {
    const groups = new Map();
    for (const t of model.transitions) { const k = `${t.from}\u0000${t.trigger ?? ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    const vals = varValuations(model), envs = envValuations(model);
    for (const [k, group] of groups) {
      const [from, trig] = k.split('\u0000'), trigger = trig || null, what = `${from} on ${trigger ?? 'completion'}`;
      let w4 = null, w5 = null;
      for (const vars of vals) for (const env of envs) {
        const en = enabled(model, from, trigger, env, vars);
        if (en.length > 1 && !w4) w4 = `${en.map(t => t.id).join(' and ')} are both enabled at ${what} when ${describe(env, vars)}`;
        if (!en.length && !w5) w5 = { env, vars };
      }
      if (w4) E('W4', `nondeterministic: ${w4}`);
      const complemented = group.some(t => { const g = guardList(t.guard); return g !== 'else' && g.some(id => guards[id]?.complement); });
      if (w5 && trigger === null) E('W5', `completion at ${from} can get stuck: no transition is enabled when ${describe(w5.env, w5.vars)}`);
      else if (w5 && complemented) E('W5', `incomplete: at ${what} no outcome is enabled when ${describe(w5.env, w5.vars)}`);
      if (complemented) for (const t of group) { const g = guardList(t.guard); if (g === 'else') continue;
        for (const id of g) { const c = guards[id]?.complement; if (c && !group.some(u => { const ug = guardList(u.guard); return ug !== 'else' && ug.includes(c); })) E('W5', `"${t.id}" guards on [${guards[id].text}] but no sibling at ${what} takes [${guards[c].text}]`); } }
    }
  }

  // W6
  for (const t of model.transitions) if (t.trigger == null && !(stateOf(model, t.from)?.entry || []).length) E('W6', `completion transition "${t.id}" leaves ${t.from}, which has no entry behaviour to complete`);

  // W7
  for (const t of model.transitions) {
    if (!t.steps) continue;
    const dots = t.steps.map(s => s.c), eff = drawable(t, model);
    if (dots.join('|') !== eff.join('|')) E('W7', `the dots on "${t.id}" (${dots.join(', ')}) are not its effect steps (${eff.join(', ') || 'none'})`);
  }

  // W8
  if (ctx?.research) {
    const R = ctx.research;
    const refs = [];
    for (const t of model.transitions) { for (const s of t.steps || []) for (const r of s.refs || []) refs.push([r, `step "${s.c}" on ${t.id}`]); for (const r of t.tip?.refs || []) refs.push([r, `tooltip on ${t.id}`]); }
    for (const c of model.cards || []) for (const ch of c.chips || []) refs.push([ch.anon ?? ch.find, `chip "${ch.label ?? ch.anon}" on card ${c.t}`]);
    for (const [r, where] of refs) if (!resolveRef(r, R)) E('W8', `${where}: "${r}" resolves to no project, publication or anonymous key`);
    for (const c of model.cards || []) for (const ch of c.chips || []) if (!ch.anon && /anonymous/i.test(ch.label ?? '')) E('W8', `card ${c.t}: an anonymous chip must use an anonymous-review key, not a label`);
    for (const hit of leaks(JSON.stringify(model), ctx)) E('W8', `the model contains a withheld term (${hit})`);
  }

  // W9
  if (ctx) {
    const props = (model.comment?.props || []).map(p => p.toLowerCase());
    if (!ctx.hero) E('W9', 'the hero sentence lists no accountability properties ("accountable: …, so that")');
    else if ([...props].sort().join('|') !== [...ctx.hero].sort().join('|')) E('W9', `the contract note lists {${props.join(', ') || 'nothing'}} but the hero sentence lists {${ctx.hero.join(', ')}}`);
    if (ctx.research) for (const c of model.cards || []) for (const ch of c.chips || []) {
      if (ch.anon) continue; const r = resolveRef(ch.find, ctx.research); if (!r) continue;
      for (const w of STATUS_WORDS) if ((ch.label || '').toLowerCase().includes(w) && !r.status.toLowerCase().includes(w)) E('W9', `chip "${ch.label}" says "${w}", but the CV status is "${r.status}"`);
    }
    const texts = [...(model.cards || []).flatMap(c => [[c.h3, `card ${c.t} heading`], [c.body, `card ${c.t}`]]),
      ...model.transitions.flatMap(t => [...(t.steps || []).map(s => [s.d, `step "${s.c}"`]), [t.tip?.d, `tooltip on ${t.id}`]]), [model.lead, 'lead'], [model.reading, 'reading sentence']];
    for (const [text, where] of texts) for (const num of plain(text).match(/\d+(?:[.,]\d+)?%?/g) || [])
      if (!ctx.researchText.includes(num) && !ctx.newsText.includes(num)) E('W9', `${where}: the number "${num}" is not in the CV data or any news post`);
  }

  // Readability budget (G1)
  if (model.states.length > BUDGET.states) E('budget', `${model.states.length} states (at most ${BUDGET.states})`);
  if (model.transitions.length > BUDGET.transitions) E('budget', `${model.transitions.length} transitions (at most ${BUDGET.transitions})`);
  const dotted = model.transitions.filter(t => t.steps?.length);
  if (dotted.length > BUDGET.dottedArcs) E('budget', `${dotted.length} arcs carry dots (at most ${BUDGET.dottedArcs})`);
  for (const t of dotted) if (t.steps.length > BUDGET.stepsPerArc) E('budget', `"${t.id}" carries ${t.steps.length} dots (at most ${BUDGET.stepsPerArc})`);
  for (const t of model.transitions) { const l = umlLabel(t, model); if (l.length > BUDGET.labelChars) E('budget', `the UML label of "${t.id}" has ${l.length} characters (at most ${BUDGET.labelChars}): ${l}`); }

  return err;
}
const describe = (env, vars) => [...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)].join(', ') || 'always';

// Withheld terms: the public builder's identifying-terms list and the private deny-list.
export function leaks(text, ctx) {
  const hits = [];
  if (ctx.hidden) { const m = text.match(ctx.hidden); if (m) hits.push('identifying review term'); }
  for (const term of ctx.deny || []) if (text.toLowerCase().includes(term.toLowerCase())) hits.push('deny-list term');
  return hits;
}

export function checkModel(model, ctx) {
  const errors = checkWellFormed(model, ctx);
  // The model checker needs declared states and guards; a malformed model stops at W2/W3.
  if (errors.some(e => e.rule === 'W2' || e.rule === 'W3')) return { ok: false, errors, properties: null, nodes: 0, overflow: [], skipped: 'V1–V6 not checked until W2 and W3 pass' };
  const { results, nodes, overflow } = checkProperties(model);
  for (const [v, r] of Object.entries(results)) if (!r.ok) errors.push({ rule: v, msg: r.msg + (r.cex ? `: ${r.cex.text}` : ''), cex: r.cex });
  return { ok: !errors.length, errors, properties: results, nodes, overflow };
}

export async function loadModel(path) { return JSON.parse(await readFile(path, 'utf8')); }

// CLI: node tools/agenda-model.mjs [model.json] — prints the verdict for each rule.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2] || join(root, 'data', 'agenda.statechart.json'));
  const model = await loadModel(file), ctx = await loadContext();
  const r = checkModel(model, ctx);
  const rules = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'budget', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  console.log(`${file.replace(root, '.')}: ${r.nodes} reachable nodes${ctx.denyFile ? '' : ' (no tools/agenda-private.txt: deny-list skipped)'}`);
  for (const rule of rules) { const es = r.errors.filter(e => e.rule === rule); console.log(`  ${es.length ? 'FAIL' : 'ok  '} ${rule}${es.length ? '' : ''}`); for (const e of es) console.log(`         ${e.msg}`); }
  if (r.skipped) console.log(`  note: ${r.skipped}`);
  if (r.overflow?.length) console.log(`  note: ${r.overflow.join('; ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
