import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const log = (...a) => console.log(...a);
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const VERBOSE = process.argv.includes('-v');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

for (let i = 1; i <= 3; i++) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', process.env.AUDIT_EMAIL || 'dean@telestar.vn');
  await page.fill('input[type="password"]', process.env.AUDIT_PASSWORD || 'telestar2026');
  await page.click('button[type="submit"]');
  try { await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 }); break; } catch {}
}

const AUDIT = () => {
  const parseRGB = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const [a, b] = [lum(fg) + 0.05, lum(bg) + 0.05];
    return a > b ? a / b : b / a;
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parseRGB(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.85) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const isTinted = (c) => c && c.a > 0.02 && (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) > 24;
  const desc = (el) => `<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 54)}">`;

  const out = {
    lowContrast: [], tiny: [], longLine: [], gradientText: [], glow: [],
    tintedShadow: [], darkSurfaceGlow: [], springy: [],
    headingOrder: [], nestedCards: [], cramped: [], deadTokens: [],
  };
  const fontChars = new Map();
  let totalChars = 0;

  // ── headings: exactly one h1, no skipped levels ──────────────────────────
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter((h) => h.offsetParent !== null && h.textContent.trim());
  const h1s = heads.filter((h) => h.tagName === 'H1');
  if (h1s.length !== 1) out.headingOrder.push(`${h1s.length} <h1> on page: ${h1s.map((h) => `"${h.textContent.trim().slice(0, 24)}"`).join(', ')}`);
  let prev = 0;
  for (const h of heads) {
    const lvl = +h.tagName[1];
    if (prev && lvl > prev + 1) {
      out.headingOrder.push(`h${prev} -> h${lvl} skip: "${h.textContent.trim().slice(0, 30)}"`);
    }
    prev = lvl;
  }

  // ── card chrome / nesting ────────────────────────────────────────────────
  // A "card" is a *container* with its own surface — not a control. Buttons,
  // links, selects and inputs are rounded and filled by nature; counting them
  // made every toolbar look like nesting.
  const CONTROL = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'KBD', 'OPTION', 'SUMMARY']);
  const hasChrome = (el) => {
    if (CONTROL.has(el.tagName) || el.closest('button, a, select, label')) return false;
    const cs = getComputedStyle(el);
    const bg = parseRGB(cs.backgroundColor);
    const opaqueBg = bg && bg.a > 0.03;
    const bordered = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const elevated = cs.boxShadow && cs.boxShadow !== 'none';
    const rounded = parseFloat(cs.borderTopLeftRadius) >= 6;
    const r = el.getBoundingClientRect();
    return r.width >= 140 && r.height >= 56 && el.childElementCount >= 2 && rounded && (opaqueBg || bordered || elevated);
  };
  // An ancestor counts as a surface even without rounding — a bordered/tinted
  // column still reads as a container the inner cards sit inside.
  // The page shell (main/body/aside/nav) is not a card, however it is painted.
  const SHELL = new Set(['MAIN', 'BODY', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'HTML']);
  const isSurface = (el) => {
    if (SHELL.has(el.tagName)) return false;
    const cs = getComputedStyle(el);
    const bg = parseRGB(cs.backgroundColor);
    const bordered = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const elevated = cs.boxShadow && cs.boxShadow !== 'none';
    const rounded = parseFloat(cs.borderTopLeftRadius) >= 6;
    const r = el.getBoundingClientRect();
    return r.width > 100 && r.height > 40 && (rounded || bordered) && ((bg && bg.a > 0.02) || bordered || elevated);
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

    // nesting: a card whose ancestor (within 3 levels) is also a card
    if (hasChrome(el)) {
      let p = el.parentElement, depth = 0;
      while (p && depth < 3) {
        if (isSurface(p)) {
          const wide = /\d+px \d+px (\d\d+)px/.test(getComputedStyle(p).boxShadow);
          out.nestedCards.push(`${desc(el)} inside ${desc(p)}${wide ? ' [wide shadow]' : ''}`);
          break;
        }
        p = p.parentElement; depth++;
      }
    }

    // table density
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const h = el.getBoundingClientRect().height;
      if (padY < 24 || h < 48) out.cramped.push(`${el.tagName.toLowerCase()} padY=${padY} h=${Math.round(h)} "${el.textContent.trim().slice(0, 20)}"`);
    }

    // dead utility classes that resolve to nothing in this theme
    for (const cls of ['text-muted', 'bg-surface', 'text-foreground', 'text-surface', 'bg-muted']) {
      if (el.classList.contains(cls)) out.deadTokens.push(`.${cls} on ${desc(el)}`);
    }

    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join(' ').trim();

    if (own) {
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      totalChars += own.length;
      const fam = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim().toLowerCase();
      fontChars.set(fam, (fontChars.get(fam) || 0) + own.length);

      if (size < 12) out.tiny.push(`${size}px "${own.slice(0, 30)}"`);

      const fg = parseRGB(cs.color);
      if (fg && fg.a > 0.5) {
        const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        const r = ratio(fg, bgOf(el));
        if (r < need) out.lowContrast.push(`${r.toFixed(2)}:1 ${size}px "${own.slice(0, 22)}" fg=${cs.color} ${desc(el)}`);
      }

      // prose measure — width in ch, no character-count precondition
      if (own.length > 40) {
        const ch = el.getBoundingClientRect().width / (size * 0.5);
        if (ch > 90) out.longLine.push(`${Math.round(ch)}ch "${own.slice(0, 30)}"`);
      }

      if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') {
        out.gradientText.push(own.slice(0, 30));
      }
    }

    for (const sh of (cs.boxShadow || 'none').split(/,(?![^(]*\))/).map((s) => s.trim()).filter((s) => s && s !== 'none')) {
      const col = parseRGB(sh);
      const nums = (sh.replace(/rgba?\([^)]*\)/, '').match(/-?\d*\.?\d+px/g) || []).map(parseFloat);
      const blur = nums[2] || 0;
      const zeroOffset = nums.length >= 2 && nums[0] === 0 && nums[1] === 0;
      const tag = `${desc(el)} :: ${sh.slice(0, 46)}`;
      if (zeroOffset && blur > 0) out.glow.push(tag);
      if (isTinted(col) && blur > 0) {
        out.tintedShadow.push(tag);
        if (lum(bgOf(el)) < 0.2) out.darkSurfaceGlow.push(tag);
      }
    }
    if (/drop-shadow\(\s*0px 0px [1-9]/.test(cs.filter)) out.glow.push(`${desc(el)} filter`);

    const timing = cs.animationTimingFunction + ' ' + cs.transitionTimingFunction;
    for (const c of timing.match(/cubic-bezier\([^)]+\)/g) || []) {
      const n = c.match(/-?\d*\.?\d+/g).map(Number);
      if (n[1] < -0.01 || n[3] > 1.01) out.springy.push(`${desc(el)} ${c}`);
    }
    if (cs.animationName && /bounce|ping|elastic/i.test(cs.animationName)) out.springy.push(`${desc(el)} ${cs.animationName}`);
  }

  const GENERATOR_FONTS = ['inter', 'geist', 'geist mono', 'poppins', 'montserrat'];
  const fonts = [...fontChars.entries()]
    .map(([name, n]) => ({ name, pct: +((n / (totalChars || 1)) * 100).toFixed(1) }))
    .sort((a, b) => b.pct - a.pct);

  const uniq = (a) => [...new Set(a)];
  return {
    fonts,
    flaggedFonts: fonts.filter((f) => GENERATOR_FONTS.includes(f.name)),
    ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, uniq(v)])),
  };
};

const KEYS = ['lowContrast', 'tiny', 'longLine', 'gradientText', 'glow', 'tintedShadow',
  'darkSurfaceGlow', 'springy', 'headingOrder', 'nestedCards', 'cramped', 'deadTokens'];

const ROUTES = ONLY || [
  '/', '/director', '/admin/jobs', '/admin/imports', '/admin/outbound', '/admin/worker-health',
  '/leads', '/meetings', '/opportunities', '/client-reports', '/inbox', '/sequences',
  '/sequences/performance', '/templates', '/team', '/automation', '/email-health', '/settings',
  '/leadgen', '/leadgen-manager',
];

const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
const worst = Object.fromEntries(KEYS.map((k) => [k, []]));
let flaggedFonts = [];

for (const r of ROUTES) {
  await page.goto(`${BASE}${r}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1100);
  const robot = page.locator('button[aria-label*="Assistant"]');
  if (await robot.count()) { await robot.click({ force: true }).catch(() => {}); await page.waitForTimeout(900); }

  const a = await page.evaluate(AUDIT);
  for (const k of KEYS) { totals[k] += a[k].length; if (a[k].length) worst[k].push(`${r} (${a[k].length})`); }
  if (a.flaggedFonts.length) flaggedFonts.push(`${r}: ${a.flaggedFonts.map((f) => f.name).join(',')}`);

  const hits = KEYS.filter((k) => a[k].length);
  log(`\n=== ${r} ===  ${hits.length ? hits.map((k) => `${k} ${a[k].length}`).join(' | ') : 'clean'}`);
  if (VERBOSE) for (const k of hits) log('   ' + k + ':\n     ' + a[k].slice(0, 6).join('\n     ') + (a[k].length > 6 ? `\n     …+${a[k].length - 6}` : ''));
}

log(`\n===== TOTALS =====`);
log(`generator-default fonts: ${flaggedFonts.length ? flaggedFonts.join(' ; ') : 'none'}`);
for (const k of KEYS) log(`${k}: ${totals[k]}${totals[k] ? '   <- ' + worst[k].join(', ') : ''}`);

await browser.close();
