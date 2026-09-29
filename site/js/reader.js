/*──────────────────────────────────────────────────────
  NGUỒN NỘI DUNG TRANG
  - stbook : ảnh 4 phần từ stbook.vn (sách gốc)
  - pdf    : file PDF trong /pdfs/   → đọc bằng PDF.js
  - docx   : file Word trong /pdfs/  → đọc bằng docx-preview
──────────────────────────────────────────────────────*/
const IMAGE_SOURCE = 'stbook';
const R2_BASE = 'https://pub-thuvienst.r2.dev';
const CUSTOM_BASE = '';

const PAGE_BASE_W = 550;          // bề ngang chuẩn của 1 trang flipbook
const WINDOW = 3;                 // nạp/render quanh trang hiện tại
const ZOOMS = [0.25, 0.4, 0.5, 0.65, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.5, 3, 4];
const PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const DOCX_CDN = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js';
const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

function getPagePartUrls(uuid, pageIndex) {
  const page = pageIndex + 1;
  if (IMAGE_SOURCE === 'stbook') {
    return [1, 2, 3, 4].map(part =>
      `https://stbook.vn/cbs20/download_preview/img.json/${uuid}/img_short_${part}${page}/_READ`);
  }
  if (IMAGE_SOURCE === 'r2') {
    const idx = String(page).padStart(3, '0');
    return [1, 2, 3, 4].map(part => `${R2_BASE}/pages/${uuid}/page_${idx}_part${part}.png`);
  }
  const idx = String(page).padStart(3, '0');
  return [1, 2, 3, 4].map(part => `${CUSTOM_BASE}/pages/${uuid}/page_${idx}_part${part}.png`);
}

function getCoverUrl(uuid) {
  if (IMAGE_SOURCE === 'stbook') return `https://stbook.vn/static/covers/${uuid}/thumb.png`;
  if (IMAGE_SOURCE === 'r2') return `${R2_BASE}/covers/${uuid}/thumb.png`;
  return `${CUSTOM_BASE}/covers/${uuid}/thumb.png`;
}
/*──────────────────────────────────────────────────────*/

let book = null;
let source = { type: 'stbook', path: '', uuid: '' };
let totalPages = 0;
let currentPage = 0;
let portrait = true;             // true = 1 trang, false = 2 trang
let pageFlip = null;
let pageW = PAGE_BASE_W;         // tỉ lệ trang của cuốn hiện tại
let pageH = 728;
let fitW = 0, fitH = 0;          // kích thước sách khi =100% (vừa màn hình)
let zoom = 1;                    // 1 = vừa màn hình
let pdfDoc = null;
let docxPages = null;            // [{el, w, h}] các trang Word đã dựng
let docxHolder = null;

function getParams() {
  const p = new URLSearchParams(location.search);
  return { id: p.get('id'), uuid: p.get('uuid'), pdf: p.get('pdf') };
}

function setLoading(text) {
  const el = document.getElementById('readerLoading');
  el.style.display = 'flex';
  el.innerHTML = `<div class="spinner"></div><p>${text}</p>`;
}

function loadLib(src, ready) {
  const ok = () => ready();
  return new Promise((resolve, reject) => {
    if (ok()) return resolve();
    const timer = setTimeout(() => reject(new Error('Nạp thư viện đọc sách quá lâu (kiểm tra mạng)')), 20000);
    const done = () => { clearTimeout(timer); resolve(); };
    if (document.querySelector(`script[src="${src}"]`)) {
      const t = setInterval(() => {
        if (ok()) { clearInterval(t); done(); }
      }, 100);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (ok() ? done() : reject(new Error('Thư viện đọc sách không đúng định dạng')));
    s.onerror = () => { clearTimeout(timer); reject(new Error('Không tải được thư viện đọc sách (kiểm tra mạng)')); };
    document.head.appendChild(s);
  });
}

async function init() {
  const p = getParams();

  // Lấy thông tin sách (không bắt buộc — file vẫn đọc được nếu thiếu)
  try {
    const resp = await fetch('/data/books.json');
    const data = await resp.json();
    book = (data.books || []).find(b =>
      (p.uuid && b.uuid === p.uuid) ||
      (p.id && String(b.id) === String(p.id)) ||
      (p.pdf && b.pdf === p.pdf));
  } catch (e) { /* bỏ qua */ }

  if (p.pdf) source = { type: /\.docx?$/i.test(p.pdf) ? 'docx' : 'pdf', path: p.pdf, uuid: '' };
  else if (p.uuid) source = { type: 'stbook', path: '', uuid: p.uuid };
  else { showError('Không tìm thấy sách'); return; }

  const title = (book && book.title)
    ? book.title
    : decodeURIComponent(source.path || '').split('/').pop().replace(/\.[^.]+$/, '');
  document.getElementById('bookTitle').textContent = title;
  document.title = title + ' — Thư viện Sách';

  portrait = window.innerWidth < 900;
  setLoading(source.type === 'pdf' ? 'Đang tải PDF…'
    : source.type === 'docx' ? 'Đang tải file Word…' : 'Đang tải sách...');

  try {
    if (source.type === 'pdf') await loadPdf();
    else if (source.type === 'docx') await loadDocx();
    else {
      if (!source.uuid) throw new Error('Thiếu mã sách');
      totalPages = Math.max(1, (book && book.pages) || 1);
      pageW = PAGE_BASE_W;
      pageH = 728;
    }
  } catch (e) { showError('Không đọc được sách: ' + e.message); return; }

  if (totalPages < 1) { showError('Không tìm thấy trang nào của sách'); return; }

  document.getElementById('readerLoading').style.display = 'none';
  document.getElementById('viewerWrapper').style.display = 'flex';
  updateRawLink();
  updateSlider();
  updateLayoutBtn();
  bindControls();
  // đăng ký TRƯỚC khi tạo flip để thư viện đo lại kích thước sau khi mình tính
  window.addEventListener('resize', onResize);
  layoutAndCreate();
}

/* ── PDF ─────────────────────────────────────────────── */
async function ensurePdfJs() {
  if (!window.pdfjsLib) await loadLib(PDF_CDN, () => !!window.pdfjsLib);
  if (!window.pdfjsLib) throw new Error('Không tải được thư viện đọc PDF');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  return window.pdfjsLib;
}

async function loadPdf() {
  const pdfjs = await ensurePdfJs();
  const resp = await fetch(source.path);
  if (!resp.ok) throw new Error(`Không tải được file (HTTP ${resp.status})`);
  const buf = await resp.arrayBuffer();
  setLoading('Đang mở PDF…');
  pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
  totalPages = pdfDoc.numPages;
  const vp = (await pdfDoc.getPage(1)).getViewport({ scale: 1 });
  pageW = PAGE_BASE_W;
  pageH = Math.max(160, Math.round(PAGE_BASE_W * vp.height / vp.width));
}

async function renderPdfPage(i, fi) {
  try {
    const page = await pdfDoc.getPage(i + 1);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 1400 / vp0.width);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    if (!fi.isConnected) return;             // trang đã bị dọn
    const img = new Image();
    img.alt = '';
    img.src = cv.toDataURL('image/jpeg', 0.86);
    fi.appendChild(img);
    cv.width = cv.height = 0;
  } catch (e) {
    delete fi.dataset.loaded;                 // cho phép thử lại lần sau
  }
}

/* ── WORD (docx) ─────────────────────────────────────── */
async function loadDocx() {
  // docx-preview cần JSZip nạp TRƯỚC (nó nhận window.JSZip lúc được gọi)
  if (!window.JSZip) await loadLib(JSZIP_CDN, () => !!window.JSZip);
  if (!window.JSZip) throw new Error('Không tải được thư viện đọc Word (JSZip)');
  if (!(window.docx && window.docx.renderAsync)) await loadLib(DOCX_CDN, () => !!(window.docx && window.docx.renderAsync));
  if (!(window.docx && window.docx.renderAsync)) throw new Error('Không tải được thư viện đọc Word');
  const resp = await fetch(source.path);
  if (!resp.ok) throw new Error(`Không tải được file (HTTP ${resp.status})`);
  const buf = await resp.arrayBuffer();
  setLoading('Đang dựng trang Word…');

  docxHolder = document.createElement('div');
  docxHolder.style.cssText = 'position:absolute;left:-10000px;top:0;width:794px;visibility:hidden;';
  document.body.appendChild(docxHolder);

  // KHÔNG truyền document.head vào đây: thư viện sẽ xóa sạch nội dung head (link CSS, title)
  let styleBox = document.getElementById('docxStyleBox');
  if (!styleBox) {
    styleBox = document.createElement('div');
    styleBox.id = 'docxStyleBox';
    styleBox.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(styleBox);
  }

  await window.docx.renderAsync(buf, docxHolder, styleBox, {
    inWrapper: false,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true
  });

  const secs = Array.from(docxHolder.querySelectorAll('section.docx'));
  if (!secs.length) throw new Error('Không đọc được nội dung file Word');
  docxPages = secs.map(el => ({ el, w: el.offsetWidth || 794, h: el.offsetHeight || 1033 }));
  totalPages = docxPages.length;
  pageW = PAGE_BASE_W;
  pageH = Math.max(160, Math.round(PAGE_BASE_W * docxPages[0].h / docxPages[0].w));
}

/* ── Dựng DOM các trang (rỗng, nội dung nạp sau) ─────── */
function buildDom() {
  // StPageFlip.destroy() xoá luôn #book, nên tạo mới trong .book-stage mỗi lần
  const stage = document.getElementById('bookStage');
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
    fi.className = 'flip-image' + (source.type === 'stbook' ? '' : ' fit');
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

  if (source.type === 'stbook') {
    getPagePartUrls(source.uuid, i).forEach((url, idx) => {
      const img = document.createElement('img');
      img.className = 'img_' + (idx + 1);
      img.alt = '';
      img.draggable = false;
      img.onerror = () => { img.style.visibility = 'hidden'; };
      img.src = url;
      fi.appendChild(img);
    });
    return;
  }
  if (source.type === 'pdf') { renderPdfPage(i, fi); return; }
  if (source.type === 'docx') {
    const d = docxPages[i];
    if (!d) { delete fi.dataset.loaded; return; }
    const box = document.createElement('div');
    box.className = 'docx-page';
    box.appendChild(d.el);                       // dời trang thật vào (không nhân bản)
    fi.appendChild(box);
    scaleDocxPage(fi, d);                        // co trang Word cho vừa khổ trang thật
  }
}

/* Trang Word có kích thước thật (vd 794×1123) — phải co đúng bề ngang
   thực tế của ô trang (do thư viện stretch theo màn hình). */
function scaleDocxPage(fi, d) {
  const w = fi.clientWidth || pageW;
  d.el.style.transform = `scale(${w / d.w})`;
}

function rescaleDocxPages() {
  if (source.type !== 'docx' || !docxPages) return;
  document.querySelectorAll('#book .page').forEach(pg => {
    const d = docxPages[+pg.dataset.idx];
    const fi = pg.querySelector('.flip-image');
    if (d && fi && fi.clientWidth) scaleDocxPage(fi, d);
  });
}

function clearPage(i) {
  const page = document.querySelector(`#book .page[data-idx="${i}"]`);
  if (!page) return;
  const fi = page.querySelector('.flip-image');
  if (!fi.dataset.loaded) return;
  delete fi.dataset.loaded;
  if (source.type === 'docx' && docxPages && docxPages[i] && docxHolder) {
    docxPages[i].el.style.transform = '';
    docxHolder.appendChild(docxPages[i].el);      // dời về chỗ chứa
  }
  fi.innerHTML = '';
}

function windowImages(center) {
  const lo = Math.max(0, center - WINDOW);
  const hi = Math.min(totalPages - 1, center + WINDOW + 1);
  for (let i = lo; i <= hi; i++) fillPage(i);
  for (let i = 0; i < totalPages; i++) {
    if (i < lo - 2 || i > hi + 2) clearPage(i);
  }
  rescaleDocxPages();                    // trang vừa hiện có thể chưa đúng tỉ lệ
  requestAnimationFrame(rescaleDocxPages);
}

/* ── Kích thước: vừa bề ngang lẫn bề cao của khung ──── */
function computeFit() {
  const sc = document.getElementById('stageScroll');
  const availW = Math.max(120, sc.clientWidth - 8);
  const availH = Math.max(100, sc.clientHeight - 8);
  const ratio = pageH / pageW;                          // cao/rộng của 1 trang
  const blockRatio = portrait ? ratio : ratio / 2;      // của cả khối (1 hoặc 2 trang)
  fitW = Math.round(Math.min(availW, availH / blockRatio));
  fitH = Math.round(fitW * blockRatio);
}

function applyZoom() {
  const holder = document.getElementById('zoomHolder');
  const stage = document.getElementById('bookStage');
  holder.style.width = Math.round(fitW * zoom) + 'px';
  holder.style.height = Math.round(fitH * zoom) + 'px';
  stage.style.width = fitW + 'px';
  stage.style.height = fitH + 'px';
  stage.style.transform = `scale(${zoom})`;
  document.getElementById('zoomLevel').textContent = Math.round(zoom * 100) + '%';
}

function layoutAndCreate() {
  computeFit();
  applyZoom();
  createFlip();
}

function onResize() {
  // bỏ tỉ lệ zoom tạm để thư viện đo đúng kích thước thật rồi mới gắn lại
  document.getElementById('bookStage').style.transform = 'none';
  computeFit();
  applyZoom();
  rescaleDocxPages();
  requestAnimationFrame(rescaleDocxPages);   // sau khi thư viện resize xong
}

function setZoom(z) {
  zoom = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z));
  applyZoom();
}

function stepZoom(dir) {
  if (dir > 0) setZoom(ZOOMS.find(v => v > zoom + 0.001) || ZOOMS[ZOOMS.length - 1]);
  else setZoom([...ZOOMS].reverse().find(v => v < zoom - 0.001) || ZOOMS[0]);
}

/* ── Tạo (hoặc tạo lại) flipbook ─────────────────────── */
function createFlip() {
  if (totalPages < 1) return false;             // chưa có trang nào → đừng dựng flip
  if (pageFlip) { try { pageFlip.destroy(); } catch (e) {} pageFlip = null; }
  buildDom();
  windowImages(currentPage);

  pageFlip = new St.PageFlip(document.getElementById('book'), {
    width: pageW,
    height: pageH,
    size: 'stretch',
    // ép thư viện nằm gọn trong khung đã tính sẵn (fitW × fitH)
    minWidth: Math.max(40, Math.min(140, Math.floor(fitW / (portrait ? 1 : 2)))),
    maxWidth: Math.max(60, Math.ceil(fitW / (portrait ? 1 : 2))),
    minHeight: Math.max(40, Math.min(140, Math.floor(fitW / (portrait ? 1 : 2))) * pageH / pageW),
    maxHeight: Math.max(60, Math.ceil(fitW / (portrait ? 1 : 2))) * pageH / pageW,
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
  rescaleDocxPages();
  requestAnimationFrame(rescaleDocxPages);

  pageFlip.on('flip', e => {
    currentPage = e.data;
    windowImages(currentPage);
    updatePageInfo();
  });

  updatePageInfo();
  return true;
}

/* ── Điều hướng ──────────────────────────────────────── */
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
  if (totalPages < 1 || !document.getElementById('book')) return;
  portrait = !portrait;
  updateLayoutBtn();
  document.getElementById('bookStage').style.transform = 'none';
  computeFit();
  applyZoom();
  createFlip();
}

function updateLayoutBtn() {
  const btn = document.getElementById('btnLayout');
  btn.title = portrait ? 'Xem 2 trang' : 'Xem 1 trang';
  btn.innerHTML = portrait
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="1"/></svg>';
}

function updateRawLink() {
  const btn = document.getElementById('btnRaw');
  if (source.type === 'stbook' || !source.path) { btn.hidden = true; return; }
  btn.href = source.path;
  btn.hidden = false;
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
  document.getElementById('readerLoading').style.display = 'flex';
  document.getElementById('readerLoading').innerHTML =
    `<p style="color:#e57373">${msg}</p><a href="/" style="color:#90caf9;margin-top:8px;display:block">Quay lại thư viện</a>`;
}

function bindControls() {
  document.getElementById('btnPrev').addEventListener('click', goPrev);
  document.getElementById('btnNext').addEventListener('click', goNext);
  document.getElementById('btnLayout').addEventListener('click', toggleLayout);

  document.getElementById('btnZoomIn').addEventListener('click', () => stepZoom(1));
  document.getElementById('btnZoomOut').addEventListener('click', () => stepZoom(-1));
  document.getElementById('btnZoomReset').addEventListener('click', () => setZoom(1));

  document.getElementById('pageSlider').addEventListener('input', e => {
    goPage(parseInt(e.target.value) - 1);
  });

  document.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(-1); }
    else if (e.key === '0') setZoom(1);
  });

  // Ctrl + lăn chuột = zoom
  document.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  document.getElementById('btnFullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
}

init();
