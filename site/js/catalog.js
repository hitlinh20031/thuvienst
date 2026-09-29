/*──────────────────────────────────────────────────────
  CẤU HÌNH NGUỒN ẢNH — Đổi IMAGE_SOURCE để chuyển storage
  'stbook'  : load trực tiếp từ stbook.vn (mặc định)
  'r2'      : Cloudflare R2 bucket
  'custom'  : URL tùy chỉnh (set CUSTOM_BASE)
──────────────────────────────────────────────────────*/
const IMAGE_SOURCE = 'stbook';
const R2_BASE = 'https://pub-thuvienst.r2.dev';
const CUSTOM_BASE = '';

function getCoverUrl(uuid) {
  if (IMAGE_SOURCE === 'stbook') return `https://stbook.vn/static/covers/${uuid}/thumb.png`;
  if (IMAGE_SOURCE === 'r2') return `${R2_BASE}/covers/${uuid}/thumb.png`;
  return `${CUSTOM_BASE}/covers/${uuid}/thumb.png`;
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
  applyFilters();
  bindEvents();

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
    return `<a class="cat-item${d ? ' cat-sub' : ''}" data-cat="${esc(c.name)}"
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
    `<a class="cat-item cat-item-all" data-cat="">
      <span class="cat-item-name">Tất cả sách</span>
      <span class="cat-item-count">${allBooks.length}</span>
    </a>` + groups;
  catFilter.innerHTML = '<option value="">Tất cả danh mục</option>' + optHtml;
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

  grid.innerHTML = visible.map(b => {
    const coverUrl = getCoverUrl(b.uuid);
    // Sách PDF tự tải lên → mở file PDF (trình đọc PDF.js sẽ thay thế sau)
    const href = b.pdf
      ? (/^https?:\/\//i.test(b.pdf) ? b.pdf : `/${String(b.pdf).replace(/^\/+/, '')}`)
      : `/read.html?id=${b.id}&uuid=${b.uuid}`;
    const target = b.pdf ? ' target="_blank" rel="noopener"' : '';
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
  }).join('');

  const loadMore = document.getElementById('loadMore');
  loadMore.style.display = end < filteredBooks.length ? 'block' : 'none';
}

function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', debounce(e => {
    searchQuery = e.target.value.trim();
    applyFilters();
  }, 250));

  document.getElementById('catFilter').addEventListener('change', e => {
    currentCat = e.target.value;
    applyFilters();
    document.getElementById('all-books').scrollIntoView({ behavior: 'smooth' });
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

  document.getElementById('catMenu').addEventListener('click', e => {
    const item = e.target.closest('.cat-item');
    if (!item) return;
    currentCat = item.dataset.cat;
    document.getElementById('catFilter').value = currentCat;
    dropdown.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    applyFilters();
    document.getElementById('all-books').scrollIntoView({ behavior: 'smooth' });
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
