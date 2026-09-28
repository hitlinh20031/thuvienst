/*──────────────────────────────────────────────────────
  CẤU HÌNH NGUỒN ẢNH — Đổi source để chuyển storage
  'stbook'  : load trực tiếp từ stbook.vn (mặc định)
  'r2'      : Cloudflare R2 bucket
  'custom'  : URL tùy chỉnh (set CUSTOM_BASE)
──────────────────────────────────────────────────────*/
const IMAGE_SOURCE = 'stbook';
const R2_BASE = 'https://pub-thuvienst.r2.dev';
const CUSTOM_BASE = '';

function getPagePartUrls(uuid, pageIndex) {
  const page = pageIndex + 1;
  if (IMAGE_SOURCE === 'stbook') {
    return [1,2,3,4].map(part =>
      `https://stbook.vn/cbs20/download_preview/img.json/${uuid}/img_short_${part}${page}/_READ`
    );
  }
  if (IMAGE_SOURCE === 'r2') {
    const idx = String(page).padStart(3, '0');
    return [1,2,3,4].map(part => `${R2_BASE}/pages/${uuid}/page_${idx}_part${part}.png`);
  }
  const idx = String(page).padStart(3, '0');
  return [1,2,3,4].map(part => `${CUSTOM_BASE}/pages/${uuid}/page_${idx}_part${part}.png`);
}

function getCoverUrl(uuid) {
  if (IMAGE_SOURCE === 'stbook') return `https://stbook.vn/static/covers/${uuid}/thumb.png`;
  if (IMAGE_SOURCE === 'r2') return `${R2_BASE}/covers/${uuid}/thumb.png`;
  return `${CUSTOM_BASE}/covers/${uuid}/thumb.png`;
}
/*──────────────────────────────────────────────────────*/

let book = null;
let totalPages = 0;
let currentPage = 0;
let portrait = true;           // true = 1 trang, false = 2 trang
let pageFlip = null;
const WINDOW = 3;              // số trang nạp ảnh quanh trang hiện tại

function getParams() {
  const p = new URLSearchParams(location.search);
  return { id: p.get('id'), uuid: p.get('uuid') };
}

async function init() {
  const { id, uuid } = getParams();
  if (!uuid) { showError('Không tìm thấy sách'); return; }

  try {
    const resp = await fetch('/data/books.json');
    const data = await resp.json();
    book = data.books.find(b => b.uuid === uuid || String(b.id) === id);
  } catch (e) {
    showError('Lỗi tải dữ liệu');
    return;
  }
  if (!book) { showError('Không tìm thấy sách'); return; }

  document.getElementById('bookTitle').textContent = book.title;
  document.title = book.title + ' — Thư viện Sách';
  totalPages = Math.max(1, book.pages || 1);

  document.getElementById('readerLoading').style.display = 'none';
  document.getElementById('viewerWrapper').style.display = 'flex';

  // màn hình hẹp → mặc định 1 trang
  portrait = window.innerWidth < 900;
  updateLayoutBtn();
  updateSlider();

  createFlip();
  bindControls();
}

/* ── Dựng DOM các trang (rỗng, nạp ảnh sau) ───────────── */
function buildDom() {
  // StPageFlip.destroy() xoá luôn #book, nên tạo mới trong .book-stage mỗi lần
  const stage = document.querySelector('.book-stage');
  let container = document.getElementById('book');
  if (!container) {
    container = document.createElement('div');
    container.id = 'book';
    stage.appendChild(container);
  }
  container.innerHTML = '';
  for (let i = 0; i < totalPages; i++) {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.idx = i;
    const fi = document.createElement('div');
    fi.className = 'flip-image';
    page.appendChild(fi);
    container.appendChild(page);
  }
}

function fillPage(i) {
  const page = document.querySelector(`#book .page[data-idx="${i}"]`);
  if (!page) return;
  const fi = page.querySelector('.flip-image');
  if (fi.dataset.loaded) return;
  fi.dataset.loaded = '1';
  const urls = getPagePartUrls(book.uuid, i);
  urls.forEach((url, idx) => {
    const img = document.createElement('img');
    img.className = 'img_' + (idx + 1);
    img.alt = '';
    img.draggable = false;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    img.src = url;
    fi.appendChild(img);
  });
}

function clearPage(i) {
  const page = document.querySelector(`#book .page[data-idx="${i}"]`);
  if (!page) return;
  const fi = page.querySelector('.flip-image');
  if (!fi.dataset.loaded) return;
  delete fi.dataset.loaded;
  fi.innerHTML = '';
}

function windowImages(center) {
  const lo = Math.max(0, center - WINDOW);
  const hi = Math.min(totalPages - 1, center + WINDOW + 1);
  for (let i = lo; i <= hi; i++) fillPage(i);
  // dọn ảnh xa để tiết kiệm bộ nhớ
  for (let i = 0; i < totalPages; i++) {
    if (i < lo - 2 || i > hi + 2) clearPage(i);
  }
}

/* ── Tạo (hoặc tạo lại) flipbook ──────────────────────── */
function createFlip() {
  if (pageFlip) { try { pageFlip.destroy(); } catch (e) {} pageFlip = null; }
  buildDom();
  windowImages(currentPage);

  // Quy tắc StPageFlip (size 'stretch'): portrait khi blockWidth < 2*minWidth && usePortrait.
  // → Ép 1 trang: cap bề rộng khung < 2*minWidth (420) để block hẹp → portrait.
  //   Ép 2 trang: usePortrait:false → luôn landscape.
  const stage = document.querySelector('.book-stage');
  stage.style.maxWidth = portrait ? '400px' : '';

  pageFlip = new St.PageFlip(document.getElementById('book'), {
    width: 550,
    height: 728,               // tỉ lệ 68/90
    size: 'stretch',
    minWidth: 210,
    maxWidth: 1000,
    minHeight: 278,
    maxHeight: 1320,
    drawShadow: true,
    flippingTime: 650,
    usePortrait: portrait,
    autoSize: true,
    maxShadowOpacity: 0.5,
    showCover: true,
    mobileScrollSupport: false,
    showPageCorners: true,
    swipeDistance: 30,
  });

  pageFlip.loadFromHTML(document.querySelectorAll('#book .page'));
  if (currentPage > 0) pageFlip.turnToPage(currentPage);

  pageFlip.on('flip', e => {
    currentPage = e.data;
    windowImages(currentPage);
    updatePageInfo();
  });

  updatePageInfo();
}

/* ── Điều hướng ───────────────────────────────────────── */
function goNext() { windowImages(currentPage + 1); if (pageFlip) pageFlip.flipNext(); }
function goPrev() { windowImages(currentPage - 1); if (pageFlip) pageFlip.flipPrev(); }

function goPage(idx) {
  idx = Math.max(0, Math.min(idx, totalPages - 1));
  currentPage = idx;
  windowImages(idx);
  if (pageFlip) pageFlip.turnToPage(idx);
  updatePageInfo();
}

function toggleLayout() {
  portrait = !portrait;
  updateLayoutBtn();
  createFlip();
}

function updateLayoutBtn() {
  const btn = document.getElementById('btnLayout');
  btn.title = portrait ? 'Xem 2 trang' : 'Xem 1 trang';
  btn.innerHTML = portrait
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="1"/></svg>';
}

function updateSlider() {
  document.getElementById('totalPages').textContent = totalPages;
  const slider = document.getElementById('pageSlider');
  slider.max = totalPages;
}

function updatePageInfo() {
  document.getElementById('currentPage').textContent = currentPage + 1;
  document.getElementById('pageSlider').value = currentPage + 1;
}

function showError(msg) {
  document.getElementById('readerLoading').innerHTML =
    `<p style="color:#e57373">${msg}</p><a href="/" style="color:#90caf9;margin-top:8px;display:block">Quay lại thư viện</a>`;
}

function bindControls() {
  document.getElementById('btnPrev').addEventListener('click', goPrev);
  document.getElementById('btnNext').addEventListener('click', goNext);
  document.getElementById('btnLayout').addEventListener('click', toggleLayout);

  document.getElementById('pageSlider').addEventListener('input', e => {
    goPage(parseInt(e.target.value) - 1);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  });

  document.getElementById('btnFullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
}

init();
