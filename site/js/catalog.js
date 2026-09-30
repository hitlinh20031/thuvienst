/*──────────────────────────────────────────────────────
  CẤU HÌNH NGUỒN ẢNH — Đổi IMAGE_SOURCE để chuyển storage
  'stbook'  : load trực tiếp từ stbook.vn (mặc định)
  'r2'      : Cloudflare R2 bucket
  'custom'  : URL tùy chỉnh (set CUSTOM_BASE)
──────────────────────────────────────────────────────*/
const IMAGE_SOURCE = 'stbook';
const R2_BASE = 'https://pub-thuvienst.r2.dev';
const CUSTOM_BASE = '';

function coverSourceUrl(uuid) {
  if (IMAGE_SOURCE === 'stbook') return `https://stbook.vn/static/covers/${uuid}/thumb.png`;
  if (IMAGE_SOURCE === 'r2') return `${R2_BASE}/covers/${uuid}/thumb.png`;
  return `${CUSTOM_BASE}/covers/${uuid}/thumb.png`;
}

/* ── Bìa tự dựng cho sách tải lên (chưa có ảnh bìa) ── */
const COVER_THEMES = [
  ['#1e3a8a', '#3b82f6'], ['#7c2d12', '#f97316'], ['#064e3b', '#10b981'],
  ['#4c1d95', '#8b5cf6'], ['#7f1d1d', '#ef4444'], ['#0c4a6e', '#0ea5e9'],
  ['#374151', '#9ca3af'], ['#713f12', '#eab308'], ['#134e4a', '#14b8a6'],
  ['#581c87', '#d946ef'],
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function wrapText(str, max) {
  const lines = [];
  let cur = '';
  for (const w of String(str).trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
    while (cur.length > max) { lines.push(cur.slice(0, max)); cur = cur.slice(max); }   // từ quá dài
  }
  if (cur) lines.push(cur);
  return lines;
}

function makeCover(b) {
  const title = (b.title || 'Tài liệu').trim();
  const type = b.pdf ? extOf(b.pdf) : 'PDF';
  const cat = b.category ? leafOf(b.category) : '';
  const th = COVER_THEMES[hashStr(title + '|' + (b.category || '')) % COVER_THEMES.length];
  const all = wrapText(title, 16);
  const lines = all.slice(0, 6);
  if (all.length > 6) lines[5] = lines[5].slice(0, 15) + '…';
  const fs = lines.length > 4 ? 30 : 36;
  const lh = lines.length > 4 ? 38 : 44;
  const y0 = 330 - (lines.length - 1) * lh / 2;
  const tspans = lines.map((l, i) =>
    `<tspan x="44" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join('');

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${th[0]}"/><stop offset="1" stop-color="${th[1]}"/>
</linearGradient></defs>
<rect width="480" height="640" fill="url(#g)"/>
<rect width="18" height="640" fill="rgba(0,0,0,.32)"/>
<rect x="18" width="3" height="640" fill="rgba(255,255,255,.14)"/>
<text x="44" y="66" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="bold" letter-spacing="3" fill="rgba(255,255,255,.72)">THƯ VIỆN SÁCH</text>
<rect x="356" y="38" width="82" height="42" rx="10" fill="rgba(0,0,0,.42)"/>
<text x="397" y="66" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="bold" fill="#fff">${esc(type)}</text>
<rect x="44" y="96" width="72" height="5" rx="2.5" fill="rgba(255,255,255,.55)"/>
<text y="${y0}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="#fff">${tspans}</text>
<text x="44" y="574" font-family="Arial,Helvetica,sans-serif" font-size="21" fill="rgba(255,255,255,.82)">${esc(cat)}</text>
<rect x="44" y="592" width="392" height="2" fill="rgba(255,255,255,.28)"/>
</svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* Ảnh bìa: file đã tải lên → ảnh bìa thật; sách PDF/Word chưa có → bìa tự dựng;
   sách stbook → ảnh bìa từ nguồn cấu hình. */
function getCoverUrl(b) {
  if (!b) return '';
  if (b.cover) return '/' + String(b.cover).replace(/^\/+/, '');
  if (b.pdf) return makeCover(b);
  return coverSourceUrl(b.uuid);
}
/*──────────────────────────────────────────────────────*/

const BOOKS_PER_PAGE = 24;

/* ── danh mục phân cấp (cha – con), phân cách bằng "/" ── */
const SEP = '/';
const leafOf   = n => { const s = String(n); const i = s.lastIndexOf(SEP); return i < 0 ? s : s.slice(i + 1); };
const parentOf = n => { const s = String(n); const i = s.lastIndexOf(SEP); return i < 0 ? '' : s.slice(0, i); };
const kidsOf   = p => categories.filter(c => parentOf(c.name) === p);
const inSubtree = (cat, path) => cat === path || String(cat || '').startsWith(path + SEP);
const catCount = path => allBooks.filter(b => inSubtree(b.category, path)).length;
const extOf = p => String(p || '').split('.').pop().toUpperCase();   // PDF, DOCX…
function rootCats() {
  const names = new Set(categories.map(c => c.name));
  return categories.filter(c => !c.name.includes(SEP) || !names.has(parentOf(c.name)));
}

const CAT_ICONS = {
  'Chủ tịch Hồ Chí Minh':    { svg: 'star',      bg: '#fdf2f2', color: '#b91c1c' },
  'Chính trị':                { svg: 'landmark',   bg: '#fef2f2', color: '#991b1b' },
  'Tư tưởng Hồ Chí Minh':    { svg: 'star',      bg: '#fdf2f2', color: '#b91c1c' },
  'Xây dựng Đảng, Nhà nước': { svg: 'building',  bg: '#fef2f2', color: '#9f1239' },
  'Lãnh đạo Đảng, Nhà nước': { svg: 'users',     bg: '#fff7ed', color: '#c2410c' },
  'Văn kiện Đảng':            { svg: 'file-text', bg: '#fefce8', color: '#a16207' },
  'Pháp luật':                { svg: 'scale',     bg: '#eff6ff', color: '#1d4ed8' },
  'Quốc phòng, an ninh, đối ngoại': { svg: 'shield', bg: '#eef2ff', color: '#4338ca' },
  'Kinh tế':                  { svg: 'trending',  bg: '#fefce8', color: '#a16207' },
  'Văn hóa, xã hội':         { svg: 'globe',     bg: '#ecfdf5', color: '#047857' },
  'Kinh điển':                { svg: 'book-open', bg: '#fdf4ff', color: '#7e22ce' },
  'Tài liệu':                { svg: 'folder',    bg: '#f0f9ff', color: '#0369a1' },
  'Mới':                      { svg: 'sparkles',  bg: '#fffbeb', color: '#d97706' },
  'Các ấn phẩm khác':        { svg: 'layers',    bg: '#f8fafc', color: '#475569' },
  'Những vấn đề quốc tế':    { svg: 'globe',     bg: '#ecfdf5', color: '#047857' },
  'Người cao tuổi':           { svg: 'heart',     bg: '#fff1f2', color: '#e11d48' },
  'Khuyến nông':              { svg: 'plant',     bg: '#ecfdf5', color: '#059669' },
  'Nước ngoài':               { svg: 'globe',     bg: '#eff6ff', color: '#2563eb' },
  'Khoa học, công nghệ, chuyển đổi số': { svg: 'cpu', bg: '#f5f3ff', color: '#7c3aed' },
  'Văn học và đời sống':      { svg: 'book-open', bg: '#fff7ed', color: '#ea580c' },
  'Thiếu nhi':                { svg: 'smile',     bg: '#fefce8', color: '#ca8a04' },
  // danh mục con (Pháp luật)
  'Đất đai':                   { svg: 'building',  bg: '#ecfeff', color: '#0891b2' },
  'Doanh nghiệp, kinh doanh':  { svg: 'trending',  bg: '#fff7ed', color: '#ea580c' },
  'Hôn nhân và gia đình':      { svg: 'heart',     bg: '#fff1f2', color: '#e11d48' },
  'Thừa kế, di chúc':          { svg: 'file-text', bg: '#fefce8', color: '#a16207' },
};
const DEFAULT_CAT = { svg: 'book', bg: '#f8fafc', color: '#475569' };

const SVG_ICONS = {
  star:       '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  landmark:   '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  building:   '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="12" y1="6" x2="12" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/>',
  users:      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  scale:      '<line x1="12" y1="3" x2="12" y2="21"/><polyline points="1 12 5 8 9 12"/><polyline points="15 12 19 8 23 12"/><path d="M1 12a4 4 0 0 0 8 0"/><path d="M15 12a4 4 0 0 0 8 0"/><line x1="5" y1="8" x2="19" y2="8"/>',
  shield:     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  trending:   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  globe:      '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'book-open':'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  folder:     '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  sparkles:   '<path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/><path d="M5 16l.75 2.25L8 19l-2.25.75L5 22l-.75-2.25L2 19l2.25-.75L5 16z"/><path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z"/>',
  layers:     '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  book:       '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  heart:      '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  plant:      '<path d="M12 22v-9"/><path d="M12 13c0-3.9 3.1-7 7-7 0 3.9-3.1 7-7 7z"/><path d="M12 16c0-3.3-2.7-6-6-6 0 3.3 2.7 6 6 6z"/>',
  cpu:        '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/><line x1="20" y1="15" x2="22" y2="15"/>',
  smile:      '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
};

function svgIcon(name, color, size = 22) {
  const path = SVG_ICONS[name] || SVG_ICONS['book'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

let allBooks = [];
let categories = [];
let filteredBooks = [];
let currentPage = 1;
let currentCat = '';
let currentSort = 'title';
let searchQuery = '';

async function init() {
  const resp = await fetch('/data/books.json');
  const data = await resp.json();
  allBooks = data.books;
  categories = data.categories || [];

  // Đồng bộ danh mục: GIỮ NGUYÊN THỨ TỰ trong books.json (admin sắp xếp),
  // đếm lại số sách, và bổ sung danh mục phát sinh (sách có category lạ).
  const counts = {};
  allBooks.forEach(b => { if (b.category) counts[b.category] = (counts[b.category] || 0) + 1; });
  categories.forEach(c => { c.count = counts[c.name] || 0; delete counts[c.name]; });
  Object.keys(counts).forEach(name => categories.push({ name, count: counts[name] }));

  renderStats(data);
  renderCategories();
  renderHome();
  renderChips();
  bindEvents();
  route();
  window.addEventListener('hashchange', route);

  // Cài đặt giao diện do admin sửa (site/data/settings.json)
  try {
    const r = await fetch('/data/settings.json');
    if (r.ok) applySettings(await r.json());
  } catch (e) { /* không có file => dùng giao diện mặc định */ }
}

/* Áp dụng cài đặt giao diện (admin.html → tab "Giao diện") */
function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  const set = (sel, val) => {
    const el = document.querySelector(sel);
    if (el && val != null && String(val).trim() !== '') el.textContent = String(val);
  };
  set('.logo-title', s.siteName);
  set('.logo-sub', s.siteSub);
  set('.logo-icon', s.logoText);
  set('.hero h1', s.heroTitle);
  set('.hero-desc', s.heroDesc);
  set('.footer p', s.footerText);
  if (s.siteName) document.title = s.siteName + ' điện tử';

  const root = document.documentElement;
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(s.accent || '')) ? s.accent : null;
  if (hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const light = (v) => Math.round(v + (255 - v) * 0.35);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-light', `rgb(${light(r)}, ${light(g)}, ${light(b)})`);
    root.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.10)`);
  }
}

function renderStats(data) {
  const el = document.getElementById('heroStats');
  const totalPages = allBooks.reduce((s, b) => s + b.pages, 0);
  el.innerHTML = `
    <div class="hero-stat">
      <div class="hero-stat-num">${data.total}</div>
      <div class="hero-stat-label">Đầu sách</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-num">${categories.length}</div>
      <div class="hero-stat-label">Danh mục</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-num">${totalPages.toLocaleString('vi')}</div>
      <div class="hero-stat-label">Trang sách</div>
    </div>`;
}

function renderCategories() {
  const menu = document.getElementById('catMenu');
  const catFilter = document.getElementById('catFilter');

  // 1 mục cha + các mục con của nó = 1 nhóm (giữ bố cục 2 cột của menu)
  const item = (c, d) => {
    const style = CAT_ICONS[c.name] || CAT_ICONS[leafOf(c.name)] || DEFAULT_CAT;
    const total = catCount(c.name);                 // gồm cả mọi danh mục con
    return `<a class="cat-item${d ? ' cat-sub' : ''}" href="${hrefFor(c.name)}" data-cat="${esc(c.name)}"
        style="padding-left:${10 + d * 20}px">
        <span class="cat-item-icon" style="background:${style.bg};color:${style.color}">${svgIcon(style.svg, style.color, 16)}</span>
        <span class="cat-item-name">${esc(leafOf(c.name))}</span>
        <span class="cat-item-count">${total}</span>
      </a>`;
  };
  const opt = (c, d) => {
    const ind = d ? '&nbsp;'.repeat(d * 3) + '└ ' : '';
    return `<option value="${esc(c.name)}">${ind}${esc(leafOf(c.name))} (${catCount(c.name)})</option>`;
  };

  let groups = '', optHtml = '';
  rootCats().forEach(root => {                      // đi theo cây: cha trước, con lùi vào
    let inner = '';
    const walk = (c, d) => {
      inner += item(c, d);
      optHtml += opt(c, d);
      kidsOf(c.name).forEach(k => walk(k, d + 1));
    };
    walk(root, 0);
    groups += `<div class="cat-group">${inner}</div>`;
  });

  menu.innerHTML =
    `<a class="cat-item cat-item-all" href="${hrefFor('')}" data-cat="">
      <span class="cat-item-name">Tất cả sách</span>
      <span class="cat-item-count">${allBooks.length}</span>
    </a>` + groups;
  catFilter.innerHTML = '<option value="">Tất cả danh mục</option>' + optHtml;
}

/* ═════════ ĐIỀU HƯỚNG HASH: #/ trang chủ · #/tat-ca · #/dm/<danh mục> ═════════ */
const HOME_HASH = '#/';
const ALL_HASH = '#/tat-ca';
const CAT_HASH = '#/dm/';
const hrefFor = cat => (cat ? CAT_HASH + encodeURIComponent(cat) : ALL_HASH);
function go(h) { if (location.hash === h) route(); else location.hash = h; }

function setView(v) { document.body.dataset.view = v; }
function currentView() { return document.body.dataset.view || 'home'; }

/* Trang chủ: lưới ô bấm “Tất cả sách” + từng danh mục (kèm danh mục con) */
function renderHome() {
  const grid = document.getElementById('homeGrid');
  if (!grid) return;

  const logo = (st, big) =>
    `<span class="home-logo"${st.flat ? '' : ` style="background:${st.color}"`}>${svgIcon(st.svg, '#fff', big || 30)}</span>`;

  const head = (href, st, name, count, foot) => `
    <a class="home-card-head" href="${href}">
      <span class="home-card-top">
        ${logo(st)}
        <span class="home-card-name">${name}</span>
        <span class="home-card-count">${count}</span>
      </span>
      ${foot ? `<span class="home-card-foot"><span>${foot}</span><span class="home-go">&rarr;</span></span>` : ''}
    </a>`;

  const subRow = c => {
    const st = CAT_ICONS[c.name] || CAT_ICONS[leafOf(c.name)] || DEFAULT_CAT;
    return `<a class="home-sub" href="${hrefFor(c.name)}">
      <span class="home-sub-dot" style="background:${st.bg};color:${st.color}">${svgIcon(st.svg, st.color, 14)}</span>
      <span class="home-sub-name">${esc(leafOf(c.name))}</span>
      <span class="home-sub-count">${catCount(c.name)}</span>
    </a>`;
  };

  let html = `<div class="home-card home-card-all">
      ${head(ALL_HASH, { svg: 'book-open', color: 'var(--accent)', flat: true },
        'Tất cả sách', allBooks.length, `Xem toàn bộ ${allBooks.length} cuốn sách`)}
    </div>`;

  rootCats().forEach(root => {
    const st = CAT_ICONS[root.name] || CAT_ICONS[leafOf(root.name)] || DEFAULT_CAT;
    const kids = kidsOf(root.name);
    const n = catCount(root.name);
    html += `<div class="home-card">
      ${head(hrefFor(root.name), st, esc(leafOf(root.name)), n,
             kids.length ? '' : `Xem ${n} cuốn sách`)}
      ${kids.length ? `<div class="home-card-kids">${kids.map(subRow).join('')}</div>` : ''}
    </div>`;
  });

  grid.innerHTML = html;
}

/* Thanh chọn danh mục (dính trên đầu) trong trang xem sách */
function renderChips() {
  const bar = document.getElementById('catChips');
  if (!bar) return;
  const chip = (name, count, cls) =>
    `<a class="cat-chip ${cls}" data-chip="${esc(name)}" href="${hrefFor(name)}">${cls === 'cat-chip-all' ? 'Tất cả sách' : esc(leafOf(name))} <span class="cat-chip-n">${count}</span></a>`;
  let html = chip('', allBooks.length, 'cat-chip-all');
  rootCats().forEach(root => {
    html += chip(root.name, catCount(root.name), 'cat-chip-root');
    kidsOf(root.name).forEach(k => { html += chip(k.name, catCount(k.name), 'cat-chip-sub'); });
  });
  bar.innerHTML = html;
}

function updateListingHead() {
  const t = document.getElementById('listingTitle');
  if (!t) return;
  t.textContent = currentCat
    ? (currentCat.includes(SEP) ? `${parentOf(currentCat)} / ${leafOf(currentCat)}` : currentCat)
    : 'Tất cả sách';
  renderCrumbs();
}

function renderCrumbs() {
  const el = document.getElementById('crumbs');
  if (!el) return;
  const root = `<a href="${HOME_HASH}">Trang chủ</a><span class="crumb-sep">&rsaquo;</span>`;
  if (!currentCat) { el.innerHTML = root + `<span class="cur">Tất cả sách</span>`; return; }
  let path = '';
  const links = currentCat.split(SEP).map((p, i, arr) => {
    path = path ? path + SEP + p : p;
    return i === arr.length - 1
      ? `<span class="cur">${esc(p)}</span>`
      : `<a href="${hrefFor(path)}">${esc(p)}</a><span class="crumb-sep">&rsaquo;</span>`;
  }).join('');
  el.innerHTML = root + links;
}

function markActive() {
  const onBooks = currentView() === 'books';
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = (a.dataset.nav === 'home' && !onBooks) ||
                   (a.dataset.nav === 'all' && onBooks && !currentCat);
    a.classList.toggle('active', active);
  });
  document.querySelectorAll('#catChips .cat-chip').forEach(a =>
    a.classList.toggle('active', (a.dataset.chip || '') === currentCat));
}

function route() {
  const h = location.hash || HOME_HASH;
  const prev = currentView();

  if (h.startsWith(CAT_HASH)) {
    const cat = decodeURIComponent(h.slice(CAT_HASH.length));
    currentCat = categories.some(c => c.name === cat) ? cat : '';
    setView('books');
  } else if (h === ALL_HASH || h === '#all-books') {   // #all-books: liên kết cũ
    currentCat = '';
    setView('books');
  } else {
    currentCat = '';
    setView('home');
  }

  const cf = document.getElementById('catFilter');
  if (cf && cf.value !== currentCat) cf.value = currentCat;

  updateListingHead();
  markActive();
  applyFilters();
  if (h !== (route.last || HOME_HASH) || prev !== currentView()) window.scrollTo(0, 0);
  route.last = h;
}

function applyFilters() {
  filteredBooks = allBooks.filter(b => {
    // chọn danh mục cha = xem cả sách của mọi danh mục con
    if (currentCat && !inSubtree(b.category, currentCat)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return b.title.toLowerCase().includes(q) ||
             (b.creator && b.creator.toLowerCase().includes(q)) ||
             (b.category && b.category.toLowerCase().includes(q));
    }
    return true;
  });

  if (currentSort === 'title') {
    filteredBooks.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
  } else if (currentSort === 'pages-desc') {
    filteredBooks.sort((a, b) => b.pages - a.pages);
  } else if (currentSort === 'pages-asc') {
    filteredBooks.sort((a, b) => a.pages - b.pages);
  }

  currentPage = 1;
  renderBooks();
}

function renderBooks() {
  const grid = document.getElementById('bookGrid');
  const end = currentPage * BOOKS_PER_PAGE;
  const visible = filteredBooks.slice(0, end);

  const countEl = document.getElementById('listingCount');
  if (countEl) {
    const base = currentCat ? catCount(currentCat) : allBooks.length;
    countEl.textContent = searchQuery
      ? `${filteredBooks.length} / ${base} cuốn sách`
      : `${base} cuốn sách`;
  }

  grid.innerHTML = visible.length ? visible.map(b => {
    const coverUrl = getCoverUrl(b);
    // Sách tải lên (PDF/Word) → mở trong trình đọc lật trang; liên kết ngoài vẫn mở tab mới
    const remote = /^https?:\/\//i.test(b.pdf || '');
    const href = b.pdf
      ? (remote
          ? b.pdf
          : `/read.html?id=${b.id}&pdf=${encodeURIComponent('/' + String(b.pdf).replace(/^\/+/, ''))}`)
      : `/read.html?id=${b.id}&uuid=${b.uuid}`;
    const target = (b.pdf && remote) ? ' target="_blank" rel="noopener"' : '';
    return `<a class="book-card" href="${href}"${target}>
      <div class="book-cover">
        <img src="${coverUrl}" alt="${esc(b.title)}" loading="lazy"
             onerror="this.parentNode.innerHTML='<div class=\\'book-cover-placeholder\\'><div class=\\'placeholder-icon\\'>&#128214;</div><div class=\\'placeholder-title\\'>${esc(b.title)}</div></div>'">
        <div class="book-badge">${b.pages > 0 ? `${b.pages} trang` : (b.pdf ? extOf(b.pdf) : 'Tài liệu')}</div>
      </div>
      <div class="book-info">
        <div class="book-title">${esc(b.title)}</div>
        <div class="book-meta">
          <span>${b.category
            ? `${parentOf(b.category) ? `<span class="meta-parent">${esc(parentOf(b.category))}/</span>` : ''}${esc(leafOf(b.category))}`
            : ''}</span>
        </div>
      </div>
    </a>`;
  }).join('') : `<div class="empty-state">
      <div class="empty-icon">&#128269;</div>
      <p>Chưa có cuốn sách nào${searchQuery ? ` khớp với “${esc(searchQuery)}”` : (currentCat ? ' trong danh mục này' : '')}.</p>
      <a class="btn btn-outline" href="${currentCat ? ALL_HASH : HOME_HASH}">${currentCat ? 'Xem tất cả sách' : 'Về trang chủ'}</a>
    </div>`;

  const loadMore = document.getElementById('loadMore');
  loadMore.style.display = end < filteredBooks.length ? 'block' : 'none';
}

function bindEvents() {
  // Tìm kiếm: đang ở trang chủ mà bắt đầu gõ → chuyển sang trang xem sách
  document.getElementById('searchInput').addEventListener('input', debounce(e => {
    searchQuery = e.target.value.trim();
    if (currentView() === 'home' && searchQuery) { go(ALL_HASH); return; }
    applyFilters();
  }, 250));

  // Chọn danh mục trong bộ lọc → đổi hash, các nút trên thanh tự đồng bộ
  document.getElementById('catFilter').addEventListener('change', e => {
    go(hrefFor(e.target.value));
  });

  document.getElementById('sortFilter').addEventListener('change', e => {
    currentSort = e.target.value;
    applyFilters();
  });

  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    renderBooks();
  });

  const dropdown = document.getElementById('catDropdown');
  const toggle = dropdown.querySelector('.nav-drop-toggle');

  // Click toggle (cảm ứng / bàn phím) — hover đã xử lý bằng CSS
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    toggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
  });

  // Chọn danh mục trong menu thả xuống (liên kết hash chạy route())
  document.getElementById('catMenu').addEventListener('click', e => {
    const item = e.target.closest('.cat-item');
    if (!item) return;
    dropdown.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (item.getAttribute('href') === location.hash) route();   // hash đã trùng
  });

  // Chọn chip trong thanh danh mục khi đang đứng đúng ở đó
  const chips = document.getElementById('catChips');
  if (chips) chips.addEventListener('click', e => {
    const chip = e.target.closest('.cat-chip');
    if (chip && chip.getAttribute('href') === location.hash) route();
  });

  // Đóng khi click ra ngoài
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

init();
