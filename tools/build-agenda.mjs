// Build the research-agenda figure from its state-machine model. The model is checked first (W1–W9, the
// readability budget, V1–V6; see tools/agenda-model.mjs) and any violation fails the build. It then writes:
//   - index.html, between <!-- BEGIN GENERATED AGENDA --> and <!-- END GENERATED AGENDA -->: the section
//     head, the <figure class="loop"> (horizontal and vertical SVG, generated figcaption), and the cards;
//   - assets/agenda-data.js (window.AGENDA): transitions, steps, runs and counts for assets/site.js.
// Usage: node tools/build-agenda.mjs [--check] [--model path/to/model.json]
// Model strings are trusted HTML fragments (headings may use <em>/<b>); they come from this repository only.
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { root, loadModel, loadContext, checkModel, umlLabel, drawable, refLabel, leaks, ANON_LABEL } from './agenda-model.mjs';

// The model the page is built from. Phases 2–3 rebuild today's figure; phase 4 switches to the new model.
export const MODEL = 'data/agenda-legacy.statechart.json';
const BEGIN = '<!-- BEGIN GENERATED AGENDA -->', END = '<!-- END GENERATED AGENDA -->';
const TONES = {
  orange: { k: 'o', title: 'lbl-o', c: 'var(--orange)' },
  teal: { k: 't', title: 'lbl-tl', c: 'var(--teal)' },
  rose: { k: 'r', title: 'lbl-r', c: 'var(--rose)' },
  navy: { k: 'n', title: 'lbl-n', c: 'var(--navy)' },
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const pt = p => `${p[0]} ${p[1]}`;
const pathD = P => `M${pt(P[0])} C ${pt(P[1])}, ${pt(P[2])}, ${pt(P[3])}`;
const sepOf = model => model.notation?.sep ?? '; ';
const entryText = (st, model, override) => `entry / ${override ?? (st.entry || []).join(sepOf(model))}`;
const tone = t => TONES[t.tone] ?? TONES.navy;
const mid = (x, y, cls, text) => `<text class="${cls}" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;
const markers = (model, prefix) => [...new Set(model.transitions.map(t => tone(t).k))]
  .map(k => `<marker id="${prefix}-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="fill-${k}"/></marker>`);

function horizontal(model) {
  const L = model.layout.h, [tx1, tx2, tx3] = L.stateText, out = [];
  out.push(`<svg class="loop-h" viewBox="0 0 ${L.viewBox[0]} ${L.viewBox[1]}" role="img" aria-labelledby="loop-cap">`);
  out.push('  <defs>', ...markers(model, 'ar').map(m => `    ${m}`), '  </defs>');
  for (const t of model.transitions) {
    const lt = L.transitions[t.id], [x, y, w, h] = lt.label, cx = x + w / 2, tn = tone(t);
    out.push(`  <g class="tr-g" data-t="${t.id}">`,
      `    <path class="arc arc-${tn.k}" data-arc="${t.id}" d="${pathD(lt.path ?? t.path)}" marker-end="url(#ar-${tn.k})"/>`,
      `    <rect class="lbl" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`,
      `    <text class="lbl-t ${tn.title}" x="${cx}" y="${y + 26}" text-anchor="middle">${CIRCLED[t.n - 1]} ${t.title}${t.subtitle ? ` <tspan class="lbl-p">${t.subtitle}</tspan>` : ''}</text>`,
      `    ${mid(cx, y + 48, 'lbl-m', umlLabel(t, model, sepOf(model)))}`);
    if (t.steps) out.push(`    <g class="nodes" data-t="${t.id}" data-side="${lt.side}"></g>`);
    out.push('  </g>');
  }
  for (const st of model.states) {
    const [x, y, w, h] = st.box, cx = x + w / 2;
    out.push(`  <g class="st" data-st="${st.id}">`, `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`,
      `    ${mid(cx, y + tx1, 'st-n', st.name)}`, `    ${mid(cx, y + tx2, 'st-m', st.meta)}`, `    ${mid(cx, y + tx3, 'st-e', entryText(st, model))}`, '  </g>');
  }
  if (model.middle) out.push(...middle(model, L.middle).map(s => `  ${s}`));
  out.push('</svg>');
  return out;
}

function middle(model, at) {
  const lines = [['mid-n', model.middle.name], ['mid-m', model.middle.line], ['mid-s', model.middle.sub]];
  return at.map((p, i) => mid(p[0], p[1], ...lines[i]));
}

function vertical(model) {
  const L = model.layout.v, [tx1, tx2, tx3] = L.stateText, out = [];
  out.push(`<svg class="loop-v" viewBox="0 0 ${L.viewBox[0]} ${L.viewBox[1]}" aria-hidden="true">`);
  out.push('  <defs>', ...markers(model, 'vr').map(m => `    ${m}`), '  </defs>');
  for (const t of model.transitions) { const tn = tone(t); out.push(`  <path class="arc arc-${tn.k}" data-arc="${t.id}" d="${pathD(L.transitions[t.id].path)}" marker-end="url(#vr-${tn.k})"/>`); }
  for (const t of model.transitions) if (t.steps) out.push(`  <g class="nodes" data-t="${t.id}" data-side="${L.transitions[t.id].side}"></g>`);
  for (const st of model.states) {
    const v = L.states[st.id], [x, y, w, h] = v.box, cx = x + w / 2;
    out.push(`  <g class="st" data-st="${st.id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>${mid(cx, y + tx1, 'st-n', st.name)}${mid(cx, y + tx2, 'st-m', v.meta ?? st.meta)}${mid(cx, y + tx3, 'st-e', entryText(st, model, v.entry))}</g>`);
  }
  for (const item of L.overlay) {
    if (item === 'middle') { out.push(...middle(model, L.middle).map(s => `  ${s}`)); continue; }
    const t = model.transitions.find(x => x.id === item.slice('label:'.length)), lv = L.transitions[t.id], [x, y] = lv.label;
    out.push(`  ${mid(x, y, `lbl-t ${tone(t).title}`, `${CIRCLED[t.n - 1]} ${t.title}`)}`, `  ${mid(x, y + 22, 'lbl-m', lv.line)}`);
  }
  out.push('</svg>');
  return out;
}

export function caption(model) {
  return model.caption ?? 'Generated in phase 4 from the model.';
}

function card(c, R) {
  const tn = TONES[c.tone] ?? TONES.navy, out = [];
  out.push(`<article class="tr${c.dark ? ' tr-loop' : ''}" data-t="${c.t}" style="--c:${tn.c}">`,
    `  <div class="tr-top"><span>${c.kicker}</span><span>${c.tag}</span></div>`,
    `  <h3>${c.h3}</h3>`, `  <p class="body">${c.body}</p>`);
  if (c.chips?.length) out.push(`  <div class="milestones">${c.chips.map(ch => ch.anon ? `<span class="chip">${ANON_LABEL}</span>` : `<a class="chip" data-find="${ch.find}">${ch.label}</a>`).join('')}</div>`);
  for (const l of c.links || []) out.push(`  <a class="tr-read" href="${l.href}">${l.label}${l.arrow ? ' <span class="m-arrow" aria-hidden="true">→</span>' : ''}</a>`);
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
    `  <p>${model.lead}</p>`,
    '</div>',
    '',
    '<figure class="loop" id="loop" aria-labelledby="loop-cap">',
    `  <div class="loop-top"><span>${model.label}</span><span><span id="loop-sig">${sig}</span><span class="loop-pass" id="loop-pass" aria-hidden="true"></span></span></div>`,
    '  <!-- Concept nodes along each arc and the travelling token are added by site.js; the diagram is complete at rest without them. -->',
    ...ind(2, horizontal(model)),
    ...ind(2, vertical(model)),
    `  <figcaption id="loop-cap" class="visually-hidden">${caption(model)}</figcaption>`,
    '</figure>',
    '',
    '<div class="transitions">',
    ...ind(2, (model.cards || []).flatMap(c => card(c, R))),
    '</div>',
  ].map(l => l ? `    ${l}` : l).join('\n');
}

export function renderData(model, R, source) {
  const tip = (d, refs) => d + (refs?.length ? ` · ${refs.map(r => refLabel(r, R)).join(', ')}` : '');
  const data = {
    label: model.label, initial: model.initial ?? null, roles: model.roles,
    states: model.states.map(s => ({ id: s.id, name: s.name })),
    transitions: model.transitions.map(t => ({
      id: t.id, n: t.n, from: t.from, to: t.to, tone: tone(t).k, title: t.title, secondary: t.style === 'secondary',
      effect: drawable(t, model), steps: (t.steps || []).map(s => ({ c: s.c, ...(s.s ? { s: s.s } : {}), d: tip(s.d, s.refs) })),
      ...(t.tip ? { tip: tip(t.tip.d, t.tip.refs) } : {}),
    })),
    runs: model.runs,
    counts: { states: model.states.length, transitions: model.transitions.length, steps: model.transitions.reduce((s, t) => s + (t.steps?.length || 0), 0) },
  };
  return `// GENERATED by tools/build-agenda.mjs from ${source}. Do not edit by hand.\nwindow.AGENDA = ${JSON.stringify(data, null, 1)};\n`;
}

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
  const section = renderSection(model, ctx.research), data = renderData(model, ctx.research, modelPath);
  for (const [name, text] of [['index.html agenda block', section], ['assets/agenda-data.js', data]]) for (const hit of leaks(text, ctx)) problems.push(`W8: ${name} contains a withheld term (${hit})`);
  if (problems.length) throw new Error(`The agenda model fails its checks:\n  ${problems.join('\n  ')}`);

  const indexPath = join(dir, 'index.html'), dataPath = join(dir, 'assets', 'agenda-data.js');
  const html = await readFile(indexPath, 'utf8'), spliced = splice(html, section);
  let oldData = ''; try { oldData = await readFile(dataPath, 'utf8'); } catch { /* first build */ }
  const stale = [];
  if (norm(spliced.before) !== norm(section)) stale.push('index.html');
  if (norm(oldData) !== norm(data)) stale.push('assets/agenda-data.js');
  if (check) {
    if (stale.length) throw new Error(`Stale agenda output: ${stale.join(', ')}. Run node tools/build-agenda.mjs.`);
    log(`Agenda up to date (${relative(dir, join(dir, modelPath))}: ${verdict.nodes} reachable nodes${model.legacy ? ', legacy model: rule failures are warnings' : ''}).`);
    return { stale };
  }
  if (stale.includes('index.html')) await writeFile(indexPath, spliced.html);
  if (stale.includes('assets/agenda-data.js')) await writeFile(dataPath, data);
  log(stale.length ? `Agenda rebuilt: ${stale.join(', ')}.` : 'Agenda already up to date.');
  return { stale };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2), mi = args.indexOf('--model');
  try { await build({ check: args.includes('--check'), modelPath: mi >= 0 ? args[mi + 1] : MODEL }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
