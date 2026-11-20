// Build the research-agenda figure from its state-machine model. The model is checked first (W1–W9, the
// readability budget, V1–V6; see tools/agenda-model.mjs) and any violation fails the build. It then writes:
//   - index.html, between <!-- BEGIN GENERATED AGENDA --> and <!-- END GENERATED AGENDA -->: the section
//     head, the <figure class="loop"> (horizontal and vertical SVG, the reading sentence, a generated
//     figcaption), and the cards;
//   - assets/agenda-data.js (window.AGENDA): transitions, steps, runs and counts for assets/site.js;
//   - assets/img/agenda-statechart.svg: a static figure (all steps shown, no token) for news and social images;
//   - assets/agenda.scxml: the model in W3C SCXML, readable by standard statechart tools.
// Usage: node tools/build-agenda.mjs [--check] [--model path/to/model.json]
// Model strings are trusted HTML fragments (headings may use <em>/<b>); they come from this repository only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { root, loadModel, loadContext, checkModel, umlLabel, drawable, refLabel, leaks, envVars, ANON_LABEL } from './agenda-model.mjs';

export const MODEL = 'data/agenda.statechart.json';
const BEGIN = '<!-- BEGIN GENERATED AGENDA -->', END = '<!-- END GENERATED AGENDA -->';
const TONES = {
  orange: { k: 'o', title: 'lbl-o', c: 'var(--orange)' },
  teal: { k: 't', title: 'lbl-tl', c: 'var(--teal)' },
  rose: { k: 'r', title: 'lbl-r', c: 'var(--rose)' },
  navy: { k: 'n', title: 'lbl-n', c: 'var(--navy)' },
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pt = p => `${p[0]} ${p[1]}`;
const pathD = P => P.length === 2 ? `M${pt(P[0])} L${pt(P[1])}` : `M${pt(P[0])} C ${pt(P[1])}, ${pt(P[2])}, ${pt(P[3])}`;
const sepOf = model => model.notation?.sep ?? '; ';
const entryText = (st, model, override) => `entry / ${override ?? (st.entry || []).join(sepOf(model))}`;
const tone = t => TONES[t.tone] ?? TONES.navy;
const mid = (x, y, cls, text, anchor = 'middle') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
const titleOf = t => `${CIRCLED[t.n - 1]} ${t.title}`;
const stereo = t => t.stereotype ? ` <tspan class="lbl-p">«${t.stereotype}»</tspan>` : t.subtitle ? ` <tspan class="lbl-p">${t.subtitle}</tspan>` : '';
const tipText = (tip, R) => tip ? tip.d + (tip.refs?.length ? ` · ${tip.refs.map(r => refLabel(r, R)).join(', ')}` : '') : null;
const markers = (model, prefix) => [...new Set([...(model.initial ? ['n'] : []), ...model.transitions.map(t => tone(t).k)])]
  .map(k => `<marker id="${prefix}-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="fill-${k}"/></marker>`);
const arcClass = t => `arc arc-${tone(t).k}${t.style === 'secondary' ? ' arc-2' : ''}`;

function initial(L, prefix) {
  if (!L.initial) return [];
  const { dot, r, path } = L.initial;
  return [`<g class="init" aria-hidden="true"><circle class="init-dot" cx="${dot[0]}" cy="${dot[1]}" r="${r}"/><path class="arc-init" data-arc="initial" d="${pathD(path)}" marker-end="url(#${prefix}-n)"/></g>`];
}

function stateLines(st, model, at, v = {}) {
  const [x, y, w, h] = v.box ?? st.box, cx = x + w / 2, off = v.text ?? at;
  const lines = [mid(cx, y + off[0], 'st-n', st.name), mid(cx, y + off[1], 'st-m', v.meta ?? st.meta), mid(cx, y + off[2], 'st-e', entryText(st, model, v.entry))];
  if (st.invariant) lines.push(mid(cx, y + off[3], 'st-i', `{inv: ${st.invariant}}`));
  return { open: `<g class="st${st.style ? ` st-${st.style}` : ''}" data-st="${st.id}">`, rect: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`, lines };
}

// The contract is a UML comment (a note with a folded corner), not a state: it constrains every transition.
function note(model, N) {
  const c = model.comment; if (!c || !N) return [];
  const [x, y, w, h] = N.box, f = N.fold, cx = x + w / 2, props = c.props.map(p => p.toUpperCase());
  const rows = []; for (let i = 0; i < props.length; i += N.propsPerLine) rows.push(props.slice(i, i + N.propsPerLine).join(' · '));
  const texts = [['note-s', N.head ?? `«${c.stereotype}» context: ${c.context}`], ['note-n', c.name], ...rows.map(r => ['note-p', r]), ['note-l', c.line]];
  return [`<g class="note">`, `  <path class="note-b" d="M${x} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h} H${x} Z"/><path class="note-f" d="M${x + w - f} ${y} V${y + f} H${x + w}"/>`,
    ...texts.map(([cls, t], i) => `  ${mid(cx, N.lines[i], cls, t)}`), '</g>'];
}

function horizontal(model, R, dots) {
  const L = model.layout.h, out = [];
  out.push(`<svg class="loop-h" viewBox="0 0 ${L.viewBox[0]} ${L.viewBox[1]}" role="img" aria-labelledby="loop-cap">`);
  out.push('  <defs>', ...markers(model, 'ar').map(m => `    ${m}`), '  </defs>');
  const parts = {
    initial: () => initial(L, 'ar'),
    transitions: () => model.transitions.flatMap(t => {
      const lt = L.transitions[t.id], tn = tone(t), tip = tipText(t.tip, R), g = [];
      g.push(`<g class="tr-g" data-t="${t.id}">`, `  <path class="${arcClass(t)}" data-arc="${t.id}" d="${pathD(lt.path ?? t.path)}" marker-end="url(#ar-${tn.k})"/>`);
      if (lt.label) {
        const [x, y, w, h] = lt.label, cx = x + w / 2;
        g.push(`  <rect class="lbl" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`,
          `  ${mid(cx, y + 26, `lbl-t ${tn.title}`, titleOf(t) + stereo(t))}`, `  ${mid(cx, y + 48, 'lbl-m', esc(umlLabel(t, model, sepOf(model))))}`);
      } else {
        const [x, y] = lt.text, a = lt.anchor ?? 'start';
        g.push(`  <g class="tr-l" tabindex="0">${tip ? `<title>${esc(tip)}</title>` : ''}${mid(x, y, `lbl-t ${tn.title}`, titleOf(t) + stereo(t), a)}${mid(x, y + 20, 'lbl-m', esc(umlLabel(t, model, sepOf(model))), a)}</g>`);
      }
      if (t.steps) g.push(`  <g class="nodes" data-t="${t.id}" data-side="${lt.side}" data-tone="${tn.k}">${dots?.[t.id] ?? ''}</g>`);
      g.push('</g>');
      return g;
    }),
    states: () => model.states.flatMap(st => {
      const s = stateLines(st, model, L.stateText, L.states?.[st.id]);
      return [s.open, `  ${s.rect}`, ...s.lines.map(l => `  ${l}`), '</g>'];
    }),
    note: () => note(model, L.note),
    middle: () => model.middle ? L.middle.map((p, i) => mid(p[0], p[1], ...[['mid-n', model.middle.name], ['mid-m', model.middle.line], ['mid-s', model.middle.sub]][i])) : [],
  };
  for (const part of L.order ?? ['transitions', 'states', 'middle']) out.push(...parts[part]().map(l => `  ${l}`));
  out.push('</svg>');
  return out;
}

function vertical(model) {
  const L = model.layout.v, out = [];
  out.push(`<svg class="loop-v" viewBox="0 0 ${L.viewBox[0]} ${L.viewBox[1]}" aria-hidden="true">`);
  out.push('  <defs>', ...markers(model, 'vr').map(m => `    ${m}`), '  </defs>');
  const parts = {
    initial: () => initial(L, 'vr'),
    arcs: () => model.transitions.map(t => `<path class="${arcClass(t)}" data-arc="${t.id}" d="${pathD(L.transitions[t.id].path)}" marker-end="url(#vr-${tone(t).k})"/>`),
    nodes: () => model.transitions.filter(t => t.steps).map(t => `<g class="nodes" data-t="${t.id}" data-side="${L.transitions[t.id].side}" data-tone="${tone(t).k}"${L.labels === 'off' ? ' data-labels="off"' : ''}></g>`),
    states: () => model.states.map(st => { const s = stateLines(st, model, L.stateText, L.states[st.id]); return `${s.open}${s.rect}${s.lines.join('')}</g>`; }),
    note: () => note(model, L.note),
    labels: () => model.transitions.flatMap(t => {
      const lv = L.transitions[t.id], [x, y] = lv.label, a = lv.anchor ?? 'middle';
      return [mid(x, y, `lbl-t ${tone(t).title}`, titleOf(t), a), ...(lv.line ? [mid(x, y + 20, 'lbl-m', lv.line, a)] : [])];
    }),
  };
  for (const part of L.order) out.push(...parts[part]().map(l => `  ${l}`));
  out.push('</svg>');
  return out;
}

// The accessible description, generated from the model so it always matches the picture.
export function caption(model) {
  if (model.caption) return model.caption;
  const name = id => model.states.find(s => s.id === id).name;
  const states = model.states.map(s => `${s.name} (${s.meta}${s.invariant ? `; invariant: ${s.invariant}` : ''})`);
  const trans = model.transitions.map(t => `${titleOf(t)}, from ${name(t.from)} to ${name(t.to)}: ${umlLabel(t, model)}.`);
  const c = model.comment;
  return esc(`UML state machine with ${model.states.length} states: ${states.slice(0, -1).join(', ')} and ${states.at(-1)}. Every run starts in ${name(model.initial)}. ${trans.join(' ')}${c ? ` A note, the ${c.name}, applies to every transition: ${c.props.join(', ')}; ${c.line.replace(/ · /g, ', ')}.` : ''}`);
}

function card(c) {
  const tn = TONES[c.tone] ?? TONES.navy, out = [];
  out.push(`<article class="tr${c.dark ? ' tr-loop' : ''}" data-t="${c.t}" style="--c:${tn.c}">`,
    `  <div class="tr-top"><span>${c.kicker}</span><span>${c.tag}</span></div>`,
    `  <h3>${c.h3}</h3>`, `  <p class="body">${c.body}</p>`);
  if (c.chips?.length) out.push(`  <div class="milestones">${c.chips.map(ch => ch.anon ? `<span class="chip">${ANON_LABEL}</span>` : `<a class="chip" data-find="${ch.find}">${ch.label}</a>`).join('')}</div>`);
  if (c.links?.length) out.push(`  <div class="tr-links">${c.links.map(l => `<a class="tr-read" href="${l.href}">${l.label}${l.arrow ? ' <span class="m-arrow" aria-hidden="true">→</span>' : ''}</a>`).join('')}</div>`);
  out.push('</article>');
  return out;
}

export function renderSection(model, R) {
  const ind = (n, lines) => lines.map(l => ' '.repeat(n) + l);
  const steps = model.transitions.reduce((s, t) => s + (t.steps?.length || 0), 0);
  const sig = model.signature ?? `${model.states.length} states · ${model.transitions.length} transitions · ${steps} steps`;
  return [
    '<div class="section-head">',
    `  <div><span class="num">${model.heading.num}</span><h2>${model.heading.h2}</h2></div>`,
    ...(model.lead ? [`  <p>${model.lead}</p>`] : []),
    '</div>',
    '',
    '<figure class="loop" id="loop" aria-labelledby="loop-cap">',
    `  <div class="loop-top"><span>${model.label} · <a class="loop-model" href="assets/agenda.scxml">model (SCXML)</a></span><span><span id="loop-sig">${sig}</span><span class="loop-pass" id="loop-pass" aria-hidden="true"></span></span></div>`,
    '  <!-- Step dots along each arc and the travelling token are added by site.js; the diagram is complete at rest without them. -->',
    ...ind(2, horizontal(model, R)),
    ...ind(2, vertical(model)),
    ...(model.reading ? [`  <p class="loop-read">${model.reading}</p>`] : []),
    `  <figcaption id="loop-cap" class="visually-hidden">${caption(model)}</figcaption>`,
    '</figure>',
    '',
    '<div class="transitions">',
    ...ind(2, (model.cards || []).flatMap(card)),
    '</div>',
  ].map(l => l ? `    ${l}` : l).join('\n');
}

export function renderData(model, R, source) {
  const tip = (d, refs) => tipText({ d, refs }, R);
  const steps = model.transitions.reduce((s, t) => s + (t.steps?.length || 0), 0);
  const data = {
    label: model.label, initial: model.initial ?? null, roles: model.roles,
    // The header counter once the runtime has placed the steps ({steps} is their number).
    signature: (model.liveSignature ?? `${model.states.length} states · ${model.transitions.length} transitions · {steps} steps`).replace('{steps}', steps),
    states: model.states.map(s => ({ id: s.id, name: s.name })),
    transitions: model.transitions.map(t => ({
      id: t.id, n: t.n, from: t.from, to: t.to, tone: tone(t).k, title: t.title, secondary: t.style === 'secondary',
      effect: drawable(t, model), steps: (t.steps || []).map(s => ({ c: s.c, ...(s.s ? { s: s.s } : {}), d: tip(s.d, s.refs) })),
      ...(t.tip ? { tip: tip(t.tip.d, t.tip.refs) } : {}),
    })),
    runs: model.runs,
    counts: { states: model.states.length, transitions: model.transitions.length, steps },
  };
  return `// GENERATED by tools/build-agenda.mjs from ${source}. Do not edit by hand.\nwindow.AGENDA = ${JSON.stringify(data, null, 1)};\n`;
}

/* ---------- static figure: the horizontal SVG with every step shown and no token ---------- */

// Arc-length parametrisation of a cubic Bézier, sampled finely enough for label placement.
function curve(P) {
  const at = t => { const u = 1 - t; return [0, 1].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
  const N = 2000, pts = [at(0)], cum = [0];
  for (let i = 1; i <= N; i++) { pts.push(at(i / N)); cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  const len = cum[N];
  const point = l => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < l) lo = m; else hi = m; } return pts[hi]; };
  return { len, point };
}
// Same placement as assets/site.js: steps spread evenly, labels on the arc's normal toward the inside.
function placeDots(model, R) {
  const L = model.layout.h, out = {};
  for (const t of model.transitions.filter(x => x.steps)) {
    const lt = L.transitions[t.id], c = curve(lt.path ?? t.path), side = lt.side, n = t.steps.length;
    out[t.id] = t.steps.map((s, i) => {
      const at = c.len * (i + 1) / (n + 1), p = c.point(at), a = c.point(Math.max(0, at - 4)), b = c.point(Math.min(c.len, at + 4));
      const tx = b[0] - a[0], ty = b[1] - a[1], m = Math.hypot(tx, ty) || 1; let nx = -ty / m, ny = tx / m;
      const inward = side === 'below' ? ny > 0 : side === 'above' ? ny < 0 : side === 'right' ? nx > 0 : nx < 0;
      if (!inward) { nx = -nx; ny = -ny; }
      const dist = 22 + (i % 2 ? 15 : 0), anchor = p[0] < 440 ? 'start' : p[0] > 560 ? 'end' : 'middle';
      return `<g class="node on" transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})"><title>${esc(`${s.c} — ${tipText({ d: s.d, refs: s.refs }, R)}`)}</title><circle class="nd" r="4.8"/><text class="nd-l" text-anchor="${anchor}" x="${(nx * dist).toFixed(1)}" y="${(ny * dist + 4).toFixed(1)}">${s.c}</text></g>`;
    }).join('');
  }
  return out;
}
const STATIC_CSS = `:root{--paper:#f6f3ec;--card:#fbf9f4;--ink:#14243a;--muted:#596273;--line:#dcd4c3;--navy:#19375f;--teal:#00737d;--orange:#b84f12;--rose:#b3263c;--serif:'Newsreader',Georgia,serif;--mono:'JetBrains Mono',Consolas,monospace}
svg{background:var(--card)}.arc{fill:none;stroke-width:2.6;stroke-dasharray:9 7}.arc-2{stroke-width:2;stroke-dasharray:3 6}
.arc-o{stroke:var(--orange)}.arc-t{stroke:var(--teal)}.arc-r{stroke:var(--rose)}.arc-n{stroke:var(--navy)}.fill-o{fill:var(--orange)}.fill-t{fill:var(--teal)}.fill-r{fill:var(--rose)}.fill-n{fill:var(--navy)}
.init-dot{fill:var(--navy)}.arc-init{fill:none;stroke:var(--navy);stroke-width:2}.lbl{fill:var(--paper);stroke:var(--line)}
.lbl-t{font-family:var(--serif);font-size:19px;font-style:italic}.lbl-o{fill:var(--orange)}.lbl-tl{fill:var(--teal)}.lbl-r{fill:var(--rose)}.lbl-n{fill:var(--navy)}
.lbl-p{font-family:var(--mono);font-style:normal;font-size:10.5px;letter-spacing:.08em;fill:var(--muted)}.lbl-m{font-family:var(--mono);font-size:12px;fill:var(--muted)}
.st rect{fill:var(--paper);stroke:var(--navy);stroke-width:2.2}.st-dashed rect{stroke:var(--rose);stroke-dasharray:7 5}.st-n{font-family:var(--serif);font-size:34px;fill:var(--ink)}
.st-m{font-family:var(--mono);font-size:11.5px;fill:var(--muted)}.st-e,.st-i{font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;fill:var(--muted)}
.note-b{fill:var(--card);stroke:var(--navy);stroke-width:1.4}.note-f{fill:none;stroke:var(--navy);stroke-width:1.4}
.note-s,.note-l{font-family:var(--mono);font-size:10.5px;fill:var(--muted)}.note-n{font-family:var(--serif);font-style:italic;font-size:24px;fill:var(--ink)}.note-p{font-family:var(--mono);font-size:11px;letter-spacing:.08em;fill:var(--orange)}
.nodes[data-tone="o"]{--c:var(--orange)}.nodes[data-tone="t"]{--c:var(--teal)}.nd{fill:var(--c);stroke:var(--c);stroke-width:2}.nd-l{font:500 10.5px var(--mono);fill:var(--ink)}`;

export function renderStaticSvg(model, R) {
  const lines = horizontal(model, R, placeDots(model, R));
  const [w, h] = model.layout.h.viewBox;
  lines[0] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="agenda-title agenda-desc">`;
  lines.splice(1, 0, `  <title id="agenda-title">${esc(model.label)}</title>`, `  <desc id="agenda-desc">${caption(model)}</desc>`, `  <style>${STATIC_CSS}</style>`, `  <rect class="bg" width="${w}" height="${h}" fill="#fbf9f4"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- GENERATED by tools/build-agenda.mjs from the agenda model. Do not edit by hand. -->\n${lines.join('\n')}\n`;
}

/* ---------- SCXML (W3C) export ---------- */

export function renderScxml(model) {
  const vars = new Set(Object.keys(model.variables || {})), base = envVars(model);
  const cond = id => {
    const g = model.guards[id];
    if (g.env) return base.includes(id) ? `_event.data.${id}` : `!_event.data.${g.complement}`;
    return g.expr;
  };
  // Completion transitions carry no event, so their env guards are data the environment sets.
  const eventless = new Set(model.transitions.filter(t => t.trigger == null && Array.isArray(t.guard)).flatMap(t => t.guard).filter(id => model.guards[id].env));
  const condOf = t => {
    if (!Array.isArray(t.guard) || !t.guard.length) return null;
    return t.guard.map(id => t.trigger == null && model.guards[id].env ? (base.includes(id) ? id : `!${model.guards[id].complement}`) : cond(id)).join(' && ');
  };
  const action = e => {
    const m = String(e).match(/^(\w+)\s*(\+\+|--|:=\s*(\w+))$/);
    if (m && vars.has(m[1])) return `<assign location="${m[1]}" expr="${m[2] === '++' ? `${m[1]} + 1` : m[2] === '--' ? `${m[1]} - 1` : m[3]}"/>`;
    return `<log label="${esc(e)}"/>`;
  };
  const x = s => esc(s);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!-- GENERATED by tools/build-agenda.mjs from data/agenda.statechart.json. Do not edit by hand. -->'];
  if (model.comment) out.push(`<!-- «${model.comment.stereotype}» context: ${model.comment.context}. ${model.comment.name}: ${model.comment.props.join(', ')}; ${model.comment.line}. -->`);
  out.push(`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="${x(model.label)}" initial="${model.initial}">`, '  <datamodel>');
  for (const [k, d] of Object.entries(model.variables || {})) out.push(`    <data id="${k}" expr="${d.init}"/>`);
  for (const [k, v] of Object.entries(model.constants || {})) out.push(`    <data id="${k}" expr="${v}"/>`);
  for (const id of eventless) out.push(`    <data id="${id}" expr="false"/><!-- set by the environment: ${x(model.guards[id].text)} -->`);
  out.push('  </datamodel>');
  for (const st of model.states) {
    out.push(`  <state id="${st.id}">`);
    if (st.invariant) out.push(`    <!-- state invariant: ${x(st.invariant)} -->`);
    if (st.entry?.length) out.push(`    <onentry>${st.entry.map(action).join('')}</onentry>`);
    // Guarded transitions first; an [else] branch is the unconditioned transition after them.
    const ts = model.transitions.filter(t => t.from === st.id).sort((a, b) => (a.guard === 'else') - (b.guard === 'else'));
    for (const t of ts) {
      const c = condOf(t);
      out.push(`    <transition${t.trigger ? ` event="${t.trigger}"` : ''}${c ? ` cond="${x(c)}"` : ''} target="${t.to}"><!-- ${CIRCLED[t.n - 1]} ${x(t.title)}: ${x(umlLabel(t, model))} -->${(t.effect || []).map(action).join('')}</transition>`);
    }
    out.push('  </state>');
  }
  out.push('</scxml>', '');
  return out.join('\n');
}

/* ---------- write / check ---------- */

const norm = s => s.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();

export function splice(html, section) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error(`index.html needs the ${BEGIN} … ${END} markers around the agenda block`);
  const start = html.indexOf('\n', a) + 1, end = html.lastIndexOf('\n', b) + 1;
  return { before: html.slice(start, end), html: html.slice(0, start) + section + '\n' + html.slice(end) };
}

export async function build({ dir = root, check = false, modelPath = MODEL, log = console.log } = {}) {
  const model = await loadModel(join(dir, modelPath)), ctx = await loadContext(dir);
  const verdict = checkModel(model, ctx), problems = [];
  for (const e of verdict.errors) (model.legacy ? log : problems.push.bind(problems))(model.legacy ? `warning ${e.rule}: ${e.msg}` : `${e.rule}: ${e.msg}`);
  const R = ctx.research;
  const outputs = { 'assets/agenda-data.js': renderData(model, R, modelPath) };
  if (model.initial && model.layout?.h && !model.legacy) { outputs['assets/img/agenda-statechart.svg'] = renderStaticSvg(model, R); outputs['assets/agenda.scxml'] = renderScxml(model); }
  const section = renderSection(model, R);
  for (const [name, text] of [['index.html agenda block', section], ...Object.entries(outputs)]) for (const hit of leaks(text, ctx)) problems.push(`W8: ${name} contains a withheld term (${hit})`);
  if (problems.length) throw new Error(`The agenda model fails its checks:\n  ${problems.join('\n  ')}`);

  const indexPath = join(dir, 'index.html');
  const html = await readFile(indexPath, 'utf8'), spliced = splice(html, section);
  const stale = [];
  if (norm(spliced.before) !== norm(section)) stale.push('index.html');
  for (const [rel, text] of Object.entries(outputs)) { let old = ''; try { old = await readFile(join(dir, rel), 'utf8'); } catch { /* first build */ } if (norm(old) !== norm(text)) stale.push(rel); }
  if (check) {
    if (stale.length) throw new Error(`Stale agenda output: ${stale.join(', ')}. Run node tools/build-agenda.mjs.`);
    log(`Agenda up to date (${relative(dir, join(dir, modelPath))}: ${verdict.nodes} reachable nodes; W1–W9, budget and V1–V6 ${model.legacy ? 'reported as warnings' : 'pass'}).`);
    return { stale };
  }
  if (stale.includes('index.html')) await writeFile(indexPath, spliced.html);
  for (const rel of stale.filter(r => r !== 'index.html')) { await mkdir(dirname(join(dir, rel)), { recursive: true }); await writeFile(join(dir, rel), outputs[rel]); }
  log(stale.length ? `Agenda rebuilt: ${stale.join(', ')}.` : 'Agenda already up to date.');
  return { stale };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2), mi = args.indexOf('--model');
  try { await build({ check: args.includes('--check'), modelPath: mi >= 0 ? args[mi + 1] : MODEL }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
