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

const NAV = [['#research', 'Agenda'], ['#publications', 'Publications'], ['news/', 'News'], ['projects/', 'Projects'], ['calendar/', 'Calendar'], ['#teaching', 'Teaching'],
  ['#students', 'Students'], ['#service', 'Service'], ['#background', 'Background'], ['#contact', 'Contact']];

const NAV_GROUPS = [
  ['Research', ['#research', '#publications', 'projects/']],
  ['Teaching', ['#teaching', '#students']],
  ['Updates', ['news/', 'calendar/']],
  ['About', ['#background', '#service', '#contact']]
];

export const navigation = (root, current) => NAV_GROUPS.map(([label, destinations]) => `<details class="nav-group" name="main-navigation">
        <summary${destinations.includes(current) ? ' class="current"' : ''}>${label}<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></summary>
        <div class="nav-panel">
          ${destinations.map(href => `<a href="${root}${href}"${href === current ? ' aria-current="page"' : ''}>${NAV.find(([url]) => url === href)[1]}</a>`).join('\n          ')}
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
