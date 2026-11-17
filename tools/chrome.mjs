// Shared page chrome for generated pages (news articles, project pages, calendar entries).
// The hand-written pages (index.html, news/index.html, projects/index.html, calendar/index.html) carry the same markup; keep them alike.
const GTAG = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-1YH193FZ7V"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-1YH193FZ7V');</script>`;

export const headOpen = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${GTAG}`;

// Fonts, theme, styles, and the motion layer. `root` is the relative path to the site root ("../../").
export const headAssets = (root, styles = []) => `<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#f6f3ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1520" media="(prefers-color-scheme: dark)">
<script>try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/style.css">
<link rel="stylesheet" href="${root}assets/motion.css">
${styles.map(s => `<link rel="stylesheet" href="${root}assets/${s}.css">`).join('\n')}
<link rel="stylesheet" href="${root}assets/cv-request.css">
<link rel="expect" href="#page-ready" blocking="render">
<script src="${root}assets/motion.js"></script>`;

// [href, label, one-line description, icon path data (24×24, stroked)]
const NAV = [
  ['#research', 'Agenda', 'Closing the human ⇄ agentic AI loop', '<path d="M4 10a6 6 0 0 1 6-6h5"/><path d="m13 1.5 2.5 2.5L13 6.5"/><path d="M20 14a6 6 0 0 1-6 6H9"/><path d="m11 22.5-2.5-2.5 2.5-2.5"/>'],
  ['#publications', 'Publications', 'Papers &amp; manuscripts', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>'],
  ['projects/', 'Projects', 'Research software &amp; releases', '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'],
  ['#teaching', 'Teaching', 'Courses &amp; educational leadership', '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'],
  ['#students', 'Students', 'Supervision &amp; advising', '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.8-3.5 3.2-5 6-5s5.2 1.5 6 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c1.6.6 2.6 2.2 3 5"/>'],
  ['news/', 'News', 'Progress notes &amp; milestones', '<rect x="3" y="4" width="14" height="16" rx="2"/><path d="M17 8h4v10a2 2 0 0 1-4 0M7 8h6M7 12h6M7 16h3"/>'],
  ['calendar/', 'Calendar', 'Classes, talks &amp; deadlines', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['#background', 'Background', 'Appointments, education &amp; industry', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'],
  ['#service', 'Service', 'Community &amp; partnerships', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3"/>'],
  ['#contact', 'Contact', 'Office &amp; ways to reach me', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>']
];

// [label, tone, destinations]
const NAV_GROUPS = [
  ['Research', 'orange', ['#research', '#publications', 'projects/']],
  ['Teaching', 'teal', ['#teaching', '#students']],
  ['Updates', 'navy', ['news/', 'calendar/']],
  ['About', 'orange', ['#background', '#service', '#contact']]
];

const navLink = (root, current, href) => {
  const [, label, desc, icon] = NAV.find(([url]) => url === href);
  return `<a href="${root}${href}"${href === current ? ' aria-current="page"' : ''}><span class="np-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><span class="np-txt"><span class="np-t">${label}</span><span class="np-d">${desc}</span></span></a>`;
};

export const navigation = (root, current) => NAV_GROUPS.map(([label, tone, destinations], i) => `<details class="nav-group" name="main-navigation" data-tone="${tone}">
        <summary${destinations.includes(current) ? ' class="current"' : ''}>${label}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></summary>
        <div class="nav-panel">
          <p class="np-eyebrow" aria-hidden="true"><span>0${i + 1}</span>${label}</p>
          ${destinations.map(href => navLink(root, current, href)).join('\n          ')}
        </div>
      </details>`).join('\n      ');

export const header = (root, current) => `<header class="site-header" id="top">
  <div class="wrap header-inner">
    <a class="brand" href="${root}" aria-label="Majid Babaei — home">
      <span class="brand-mark">m<span>b</span>.</span>
    </a>
    <nav class="nav" id="nav" aria-label="Main">
      ${navigation(root, current)}
    </nav>
    <div class="header-tools">
      <button class="icon-btn theme-btn" id="theme-btn" type="button" aria-label="Toggle dark mode">
        <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>
        <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <a class="cv-btn" aria-label="Request CV" href="mailto:majid.babaei@ufv.ca?subject=Latest%20CV%20request" data-cv-request>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span class="label">CV</span>
      </a>
      <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h16M4 16h16"/></svg>
      </button>
    </div>
  </div>
</header>`;

export const footer = root => `<footer class="site-foot">
  <div class="wrap">
    <div class="sf-top">
      <p class="sf-line">Let's build software you can <em>check.</em></p>
      <a class="sf-mail u-link" href="mailto:majid.babaei@ufv.ca">majid.babaei@ufv.ca <span class="m-arrow" aria-hidden="true">↗</span></a>
    </div>
    <div class="sf-bot">
      <span>© Majid Babaei</span>
      <nav aria-label="Footer"><a class="u-link" href="${root}">Home</a><a class="u-link" href="${root}news/">Newsroom</a><a class="u-link" href="${root}projects/">Projects</a><a class="u-link" href="${root}calendar/">Calendar</a><a class="u-link" href="${root}news/feed.xml">RSS</a><a class="u-link" href="https://github.com/ai4se4ai-lab">GitHub ↗</a><a class="u-link" href="https://www.linkedin.com/in/majid-babaei-ph-d-20382874/">LinkedIn ↗</a></nav>
    </div>
  </div>
</footer>`;

// Wrap each word of a headline in a mask so it can rise on load (see assets/motion.css). `escape` escapes one word.
export const maskWords = (text, escape) => String(text).split(/\s+/).filter(Boolean)
  .map((w, i) => `<span class="mask"${i ? ` style="--i:${Math.min(i, 3)}"` : ''}><span>${escape(w)}</span></span>`).join(' ');
