// ScholarPress workspace: small progressive enhancement over server-rendered pages.
// All writes go through api(), which sends the session-bound CSRF token. Text is inserted with textContent only.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const live = msg => { const el = $('#live'); if (el) { el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 30); } };
  const data = (() => { const el = $('#page-data'); return el ? JSON.parse(el.textContent) : {}; })();
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    for (const k of kids) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };

  async function api(method, url, body) {
    const opts = { method, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(url, opts);
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const e = new Error(json.detail || `Request failed (${res.status})`); e.status = res.status; e.errors = json.errors || []; throw e; }
    return json;
  }

  function showErrors(form, err) {
    $$('.err', form).forEach(p => { p.textContent = ''; });
    $$('[aria-invalid]', form).forEach(i => i.removeAttribute('aria-invalid'));
    const general = $('[data-form-err], #form-err', form);
    const unplaced = [];
    for (const e of err.errors || []) {
      const box = $(`[data-field="${CSS.escape(e.field)}"]`, form) || $(`[data-field="${CSS.escape(String(e.field).split('.')[0])}"]`, form);
      const p = box && $('.err', box);
      if (p) { p.textContent = (p.textContent ? p.textContent + ' ' : '') + e.message; const input = $('input,select,textarea', box); if (input) input.setAttribute('aria-invalid', 'true'); }
      else unplaced.push(e.message);
    }
    if (general) general.textContent = [err.message, ...unplaced].filter(Boolean).join(' ');
    live(`Not saved: ${err.message}`);
    const first = $('[aria-invalid="true"]', form); if (first) first.focus();
  }

  /* ---------------- upload (new article / new revision) ---------------- */
  const upload = $('#upload-form');
  if (upload) {
    const supports = [];
    const list = $('#support-list'), tbody = list && $('tbody', list);
    const redraw = () => {
      tbody.replaceChildren(...supports.map((s, i) => {
        const input = el('input', { value: s.path, 'aria-label': `Relative path for ${s.file.name}` });
        input.addEventListener('input', () => { s.path = input.value; });
        const rm = el('button', { type: 'button', class: 'btn small', 'aria-label': `Remove ${s.file.name}` }, '✕');
        rm.addEventListener('click', () => { supports.splice(i, 1); redraw(); });
        return el('tr', {}, el('td', {}, input), el('td', {}, `${(s.file.size / 1024).toFixed(1)} KB`), el('td', {}, rm));
      }));
      list.hidden = supports.length === 0;
    };
    const add = files => { for (const f of files) supports.push({ file: f, path: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name }); redraw(); };
    $('#support').addEventListener('change', e => { add(e.target.files); e.target.value = ''; });
    $('#support-dir').addEventListener('change', e => { add(e.target.files); e.target.value = ''; });
    upload.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData();
      for (const name of ['tex', 'bib']) { const f = upload.elements[name].files[0]; if (f) fd.append(name, f, f.name); }
      for (const s of supports) { fd.append('support', s.file, s.file.name); fd.append('support_paths', s.path); }
      for (const n of ['basis_release_id', 'basis_draft_id', 'slug']) if (upload.elements[n] && upload.elements[n].value) fd.append(n, upload.elements[n].value);
      $$('input[name="remove"]:checked', upload).forEach(c => fd.append('remove', c.value));
      const btn = $('button[type=submit]', upload); btn.disabled = true; live('Uploading…');
      try { const r = await api('POST', upload.dataset.endpoint, fd); live('Draft created.'); location.href = r.url; }
      catch (err) { showErrors(upload, err); btn.disabled = false; }
    });
  }

  /* ---------------- draft workspace ---------------- */
  if (document.body.dataset.page === 'draft') {
    let rev = data.rev;
    const patch = async (form, body) => {
      const r = await api('PATCH', `/api/drafts/${data.draft}`, { rev, ...body });
      rev = r.rev;
      return r;
    };
    const saved = msg => { live(msg); setTimeout(() => location.reload(), 350); };

    // Authors: add / reorder / remove rows
    const authors = $('#authors');
    const authorRow = (name = '', aff = '') => el('li', {},
      el('label', {}, 'Name ', el('input', { name: 'author-name', value: name })), el('label', {}, 'Affiliation ', el('input', { name: 'author-affiliation', value: aff })),
      el('span', { class: 'row-actions' }, el('button', { type: 'button', class: 'btn small', 'data-move': '-1', 'aria-label': 'Move up' }, '↑'),
        el('button', { type: 'button', class: 'btn small', 'data-move': '1', 'aria-label': 'Move down' }, '↓'), el('button', { type: 'button', class: 'btn small', 'data-remove': '', 'aria-label': 'Remove author' }, '✕')));
    $('#add-author').addEventListener('click', () => { const r = authorRow(); authors.append(r); $('input', r).focus(); });
    if (!authors.children.length) authors.append(authorRow());
    authors.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const li = b.closest('li');
      if (b.hasAttribute('data-remove')) { li.remove(); live('Author removed'); return; }
      const dir = Number(b.dataset.move);
      if (dir < 0 && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      if (dir > 0 && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      b.focus(); live('Author moved');
    });

    const metaForm = $('#meta-form');
    metaForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = metaForm.elements;
      const names = $$('input[name="author-name"]', metaForm), affs = $$('input[name="author-affiliation"]', metaForm);
      const body = {
        metadata: { title: f.title.value, abstract: f.abstract.value, slug: f.slug.value, confirmed: f.confirmed.checked,
          disclosureApproved: f.disclosureApproved ? f.disclosureApproved.checked : false,
          authors: names.map((n, i) => ({ name: n.value, affiliation: affs[i].value })) },
        revision_note: f.revision_note.value,
        disclosure: (metaForm.querySelector('input[name="disclosure"]:checked') || {}).value || 'public'
      };
      try { await patch(metaForm, body); saved('Metadata saved.'); } catch (err) { showErrors(metaForm, err); }
    });

    // Build: profile + start + poll
    const profileForm = $('#profile-form');
    const startBuild = async () => {
      try { const r = await api('POST', `/api/drafts/${data.draft}/builds`); live('Build queued.'); poll(r.build_id); }
      catch (err) { live(err.message); $('#build-status').textContent = err.message; }
    };
    profileForm.addEventListener('submit', async e => {
      e.preventDefault();
      try { await patch(profileForm, { profile: { kind: profileForm.elements.kind.value, engine: profileForm.elements.engine.value } }); await startBuild(); }
      catch (err) { $('#build-status').textContent = err.message; live(err.message); }
    });
    $('#build-btn').addEventListener('click', startBuild);
    let lastStatus = data.buildStatus;
    async function poll(id) {
      try {
        const b = await api('GET', `/api/builds/${id}`);
        const status = $('#build-status');
        status.replaceChildren('Build ', el('span', { class: `pill ${b.status}` }, b.status), b.runner ? ` · ${b.runner} runner` : '');
        if (b.status !== lastStatus) { live(`Build ${b.status}`); lastStatus = b.status; }
        if (b.status === 'queued' || b.status === 'running') { setTimeout(() => poll(id), 1500); return; }
        const errs = b.diagnostics.filter(d => d.severity === 'error').length;
        live(b.ready ? `Build ready: ${b.pages} page(s).` : `Build finished with ${errs} blocking problem(s).`);
        setTimeout(() => location.reload(), 600);
      } catch (err) { setTimeout(() => poll(id), 3000); }
    }
    if (data.build && (data.buildStatus === 'queued' || data.buildStatus === 'running')) poll(data.build);

    // Website links + announcement + venue + CV
    const linksForm = $('#links-form');
    $$('button[data-suggest]', linksForm).forEach(b => b.addEventListener('click', () => { linksForm.elements.publicationId.value = b.dataset.suggest; live('Publication selected; save to apply.'); }));
    const modeInputs = $$('input[name="ann-mode"]', linksForm);
    const syncMode = () => { const m = (modeInputs.find(i => i.checked) || {}).value; $('#ann-new').hidden = m !== 'new'; $('#ann-update').hidden = m !== 'update'; };
    modeInputs.forEach(i => i.addEventListener('change', syncMode));
    $('#ann-fill').addEventListener('click', () => {
      const a = data.defaultAnnouncement, f = linksForm.elements;
      f['ann-title'].value = a.title; f['ann-slug'].value = a.newsSlug; f['ann-summary'].value = a.summary; f['ann-body'].value = a.body;
      live('Draft announcement filled in. Review and edit before saving.');
    });
    linksForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = linksForm.elements, checked = n => $$(`input[name="${n}"]:checked`, linksForm).map(i => i.value);
      const mode = (modeInputs.find(i => i.checked) || {}).value || 'none';
      const announcement = mode === 'new' ? { mode, title: f['ann-title'].value, newsSlug: f['ann-slug'].value, summary: f['ann-summary'].value, body: f['ann-body'].value, tags: ['Preprints'] }
        : mode === 'update' ? { mode, newsPostId: f['ann-post'].value, body: f['ann-update-body'].value } : { mode };
      const body = {
        links: { publicationId: f.publicationId.value || null, projectIds: checked('projectIds'), newsPostIds: checked('newsPostIds'), agendaIds: checked('agendaIds') },
        announcement,
        venue: { status: f['v-status'].value, name: f['v-name'].value, kind: f['v-kind'].value, doi: f['v-doi'].value, url: f['v-url'].value,
          date: f['v-date'].value, citation: f['v-citation'].value, confirmed: f['v-confirmed'].checked },
        cv: { section: f['cv-section'].value || null, entryKey: f['cv-key'].value }
      };
      try { await patch(linksForm, body); saved('Website links saved.'); } catch (err) { showErrors(linksForm, err); }
    });

    // Site preview
    const spBtn = $('#site-preview-btn'), spStatus = $('#site-preview-status');
    async function pollPreview() {
      const s = await api('GET', `/api/drafts/${data.draft}/site-preview`);
      if (s.status === 'running') { spStatus.textContent = s.message; setTimeout(pollPreview, 1500); return; }
      if (s.status === 'ready') { spStatus.replaceChildren('Ready: ', el('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'open the article page in the site preview ↗')); live('Site preview ready.'); }
      else if (s.status === 'failed') { spStatus.textContent = `Preview failed: ${s.message}`; live('Site preview failed.'); }
      spBtn.disabled = false;
    }
    spBtn.addEventListener('click', async () => {
      spBtn.disabled = true; spStatus.textContent = 'Building the site preview…'; live('Building the site preview');
      try { await api('POST', `/api/drafts/${data.draft}/site-preview`); pollPreview(); } catch (err) { spStatus.textContent = err.message; spBtn.disabled = false; }
    });

    // Publish: deliberate approval bound to the fingerprint shown on this page
    const approve = $('#pub-approve'), pubBtn = $('#publish-btn'), pubStatus = $('#pub-status');
    approve.addEventListener('change', () => { pubBtn.disabled = !approve.checked; });
    const key = `pub-${data.draft}-${pubBtn.dataset.fingerprint.slice(0, 16)}`;
    const idem = sessionStorageGet(key) || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    pubBtn.addEventListener('click', async () => {
      pubBtn.disabled = true; approve.disabled = true;
      sessionStorageSet(key, idem);
      try {
        const p = await api('POST', `/api/drafts/${data.draft}/publish`, { build_id: pubBtn.dataset.build, fingerprint: pubBtn.dataset.fingerprint, idempotency_key: idem });
        trackPublication(p.id, pubStatus);
      } catch (err) { pubStatus.textContent = err.message; live(`Publish refused: ${err.message}`); approve.disabled = false; }
    });
  }

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

  async function trackPublication(id, box, last) {
    try {
      const p = await api('GET', `/api/publications/${id}`);
      if (p.status !== last) live(`Publication ${p.status}: ${p.message}`);
      box.replaceChildren(el('p', {}, el('span', { class: `pill ${p.status}` }, p.status), ' ', p.message));
      if (p.status === 'published') {
        const urls = p.urls || {};
        const dl = el('dl', { class: 'kv' });
        for (const [label, k] of [['Stable article', 'article'], ['This version', 'version'], ['Version PDF', 'pdf'], ['Latest PDF', 'latest_pdf']]) if (urls[k]) {
          const input = el('input', { value: urls[k], readonly: '', 'aria-label': label, class: 'mono' });
          const copy = el('button', { type: 'button', class: 'btn small' }, 'Copy');
          copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(urls[k]); copy.textContent = 'Copied'; } catch { input.select(); } });
          dl.append(el('dt', {}, label), el('dd', {}, input, ' ', copy, ' ', el('a', { href: urls[k], target: '_blank', rel: 'noopener' }, 'Open ↗')));
        }
        box.append(dl);
        return;
      }
      if (p.status === 'failed') { box.append(el('details', {}, el('summary', {}, 'Steps'), el('pre', {}, (p.steps || []).join('\n\n')))); return; }
      setTimeout(() => trackPublication(id, box, p.status), 1500);
    } catch (err) { setTimeout(() => trackPublication(id, box, last), 3000); }
  }

  /* ---------------- metadata-only update ---------------- */
  const upd = $('#update-form');
  if (upd) {
    let review = null;
    const changes = () => {
      const f = upd.elements;
      return {
        venue: { status: f['v-status'].value, name: f['v-name'].value, kind: f['v-kind'].value, doi: f['v-doi'].value, url: f['v-url'].value,
          date: f['v-date'].value, citation: f['v-citation'].value, confirmed: f['v-confirmed'].checked },
        links: { ...data.links, publicationId: f.publicationId.value || null, projectIds: $$('input[name="projectIds"]:checked', upd).map(i => i.value) }
      };
    };
    $('#update-preview').addEventListener('click', async () => {
      const box = $('#update-review');
      try {
        const c = changes();
        const r = await api('POST', `/api/articles/${data.article}/updates/preview`, c);
        review = { changes: c, fingerprint: r.fingerprint, key: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) };
        box.replaceChildren(el('p', {}, r.ready ? 'Ready. Current public views will show this venue and these associations; no new PDF version is created.' : 'Not ready:'),
          ...(r.reasons || []).map(x => el('p', { class: 'err' }, x)),
          ...(r.cv && r.cv.entry ? [el('p', {}, `CV: ${r.cv.status} · ${r.cv.sectionLabel}`), el('pre', {}, r.cv.entry)] : []));
        $('#update-apply').disabled = !r.ready;
        live(r.ready ? 'Update ready to publish.' : 'Update not ready.');
      } catch (err) { box.textContent = err.message; }
    });
    $('#update-apply').addEventListener('click', async () => {
      if (!review) return;
      $('#update-apply').disabled = true;
      try {
        const p = await api('POST', `/api/articles/${data.article}/updates`, { changes: review.changes, fingerprint: review.fingerprint, idempotency_key: review.key });
        trackPublication(p.id, $('#update-status'));
      } catch (err) { $('#update-status').textContent = err.message; $('#update-apply').disabled = false; }
    });
  }
})();
