import { Marked, Renderer } from 'marked';
import sanitizeHtml from 'sanitize-html';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function firstImage(markdown) {
  let image;
  const parser = new Marked();
  parser.walkTokens(parser.lexer(markdown), token => {
    if (!image && token.type === 'image') image = { src: token.href, alt: token.text };
  });
  return image;
}

// Render once at build time: articles stay readable without JavaScript or a CDN.
export function renderMarkdown(markdown, { topImage } = {}) {
  let skippedTopImage = false;
  const renderer = new Renderer();
  const ids = new Map();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const base = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const count = (ids.get(base) || 0) + 1;
    ids.set(base, count);
    return `<h${depth} id="${base}${count > 1 ? `-${count}` : ''}">${text}</h${depth}>\n`;
  };
  renderer.paragraph = function ({ tokens }) {
    if (tokens.length === 1 && tokens[0].type === 'image') {
      const image = tokens[0];
      if (!skippedTopImage && image.href === topImage) { skippedTopImage = true; return ''; }
      return `<figure>${this.image(image)}${image.text ? `<figcaption>${esc(image.text)}</figcaption>` : ''}</figure>\n`;
    }
    return `<p>${this.parser.parseInline(tokens)}</p>\n`;
  };
  const table = Renderer.prototype.table;
  renderer.table = function (token) { return `<div class="table-wrap">${table.call(this, token)}</div>\n`; };
  const parser = new Marked({ gfm: true, renderer });
  return sanitizeHtml(parser.parse(markdown), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'h1': ['id'], 'h2': ['id'], 'h3': ['id'], 'h4': ['id'], 'h5': ['id'], 'h6': ['id'],
      a: ['href', 'name', 'target', 'rel'], div: ['class'], code: ['class'], img: ['src', 'alt', 'title', 'loading'],
    },
    allowedClasses: { div: ['table-wrap'], code: [/^language-/] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      img: (tag, attributes) => ({ tagName: tag, attribs: { ...attributes, loading: 'lazy' } }),
      a: (tag, attributes) => ({ tagName: tag, attribs: /^https?:\/\//.test(attributes.href || '')
        ? { ...attributes, target: '_blank', rel: 'noopener noreferrer' } : attributes }),
    },
  });
}
