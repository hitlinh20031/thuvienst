/*══════════════════════════════════════════════════════════
  QUẢN TRỊ THƯ VIỆN — chạy hoàn toàn trên trình duyệt,
  ghi thẳng vào repo bằng GitHub API, không cần server.

  Quyền cần thiết của token: repo
══════════════════════════════════════════════════════════*/
const DEFAULT_REPO = 'hitlinh20031/thuvienst';
const BRANCH = 'main';
const BOOKS_PATH = 'site/data/books.json';   // đường dẫn trong repo
const PDF_DIR = 'site/pdfs';                 // đường dẫn trong repo
const PDF_DIR_PUBLIC = 'pdfs';               // đường dẫn công khai
const PAGE_SIZE = 100;

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let token = '';
let repo  = { owner: '', name: '' };
let data  = null;               // nội dung books.json
let filtered = [];
let selected = new Set();       // id sách được tick
let shown = PAGE_SIZE;
let queue = [];                 // hàng đợi file PDF chờ upload
let deployTimer = null;

/*──────────────── Encoding ────────────────*/
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
const textToB64 = (s) => bufToB64(new TextEncoder().encode(s));
function b64ToText(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/*──────────────── GitHub API ────────────────*/
async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const headers = Object.assign({
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': `Bearer ${token}`
  }, opts.headers || {});

  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (res.status === 401) { doLogout('Token không hợp lệ hoặc đã hết hạn.'); throw new Error('401'); }
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset');
    let m = 'Bị chặn quyền (403).';
    try { const j = await res.json(); if (j.message) m = j.message; } catch (e) {}
    if (res.headers.get('x-ratelimit-remaining') === '0' && reset)
      m = `Hết hạn mức API GitHub, thử lại sau ${new Date(+reset * 1000).toLocaleTimeString('vi')}.`;
    throw new Error(m);
  }
  if (!res.ok) {
    let m = `Lỗi ${res.status}`;
    try { const j = await res.json(); if (j.message) m += ': ' + j.message; } catch (e) {}
    throw new Error(m);
  }
  return res.status === 204 ? null : res.json();
}

const repoApi = (p) => api(`/repos/${repo.owner}/${repo.name}${p}`);

/*──────────────── Thông báo / hộp thoại ────────────────*/
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* modal trả về Promise: resolve(value) — value = null nếu bấm Hủy/đóng */
function modal({ title, html, buttons }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="modal-body">${html}</div>
        <div class="modal-actions"></div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) { ov.remove(); resolve(null); } });
    const actions = ov.querySelector('.modal-actions');
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.primary ? 'primary ' : '') + (b.danger ? 'danger' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        let keepOpen = false;
        if (b.onClick) keepOpen = b.onClick(ov) === false;   // trả false = giữ hộp thoại
        if (!keepOpen) { ov.remove(); resolve(b.value === undefined ? true : b.value); }
      });
      actions.appendChild(btn);
    });
    document.body.appendChild(ov);
    const first = ov.querySelector('input,select');
    if (first) { first.focus(); if (first.select) first.select(); }
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { ov.remove(); resolve(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const primary = buttons.findIndex(b => b.primary);
        if (primary >= 0) actions.children[primary].click();
      }
    });
  });
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/*──────────────── Dữ liệu ────────────────*/
function recount() {
  if (!data) return;
  const map = {}, size = {};
  data.books.forEach(b => {
    const c = b.category || 'Chưa phân loại';
    map[c] = (map[c] || 0) + 1;
    size[c] = (size[c] || 0) + (Number(b.size_mb) || 0);
  });
  (data.categories || []).forEach(c => {
    c.count = map[c.name] || 0;
    c.size_gb = +( (size[c.name] || 0) / 1024 ).toFixed(2);
    delete map[c.name];
  });
  // sách nằm trong danh mục chưa có trong danh mục → thêm vào
  Object.keys(map).forEach(name => {
    data.categories.push({ name, count: map[name], size_gb: +((size[name] || 0) / 1024).toFixed(2) });
  });
  data.total = data.books.length;
  data.total_size_gb = +(data.books.reduce((s, b) => s + (Number(b.size_mb) || 0), 0) / 1024).toFixed(2);
}

async function loadData() {
  const j = await repoApi(`/contents/${BOOKS_PATH}?ref=${BRANCH}`);
  data = JSON.parse(b64ToText(j.content));
  recount();
}

async function commitFiles(files, message) {
  const ref  = await repoApi(`/git/ref/heads/${BRANCH}`);
  const head = ref.object.sha;
  const headCommit = await repoApi(`/git/commits/${head}`);

  const entries = [];
  for (const f of files) {
    if (f.delete) { entries.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    let sha = f.sha;
    if (!sha) {
      const blob = await repoApi('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: f.base64, encoding: 'base64' })
      });
      sha = blob.sha;
    }
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha });
  }

  const tree = await repoApi('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries })
  });
  const commit = await repoApi('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [head] })
  });
  try {
    await repoApi(`/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha })
    });
  } catch (e) {
    throw new Error('Có người khác vừa commit. Hãy bấm nút tải lại và thử lại. (' + e.message + ')');
  }
  return commit;
}

async function saveData(message, extraFiles = []) {
  recount();
  const files = [{ path: BOOKS_PATH, base64: textToB64(JSON.stringify(data, null, 2)) }]
    .concat(extraFiles);
  const c = await commitFiles(files, message);
  toast('Đã lưu: ' + message);
  watchDeploy(c.sha);
  renderAll();
}

/*──────────────── Theo dõi deploy ────────────────*/
function watchDeploy(sha) {
  const el = $('#deployStatus');
  let n = 0;
  clearInterval(deployTimer);
  el.className = 'deploy working';
  el.textContent = '⏳ Đang triển khai...';
  deployTimer = setInterval(async () => {
    n++;
    try {
      const j = await repoApi(`/actions/runs?head_sha=${sha}&per_page=1`);
      const run = j.workflow_runs && j.workflow_runs[0];
      if (run) {
        if (run.status === 'completed' && run.conclusion === 'success') {
          clearInterval(deployTimer);
          el.className = 'deploy ok';
          el.innerHTML = '✓ Đã cập nhật trang web';
        } else if (run.status === 'completed') {
          clearInterval(deployTimer);
          el.className = 'deploy err';
          el.innerHTML = '✗ Deploy lỗi — <a href="' + run.html_url + '" target="_blank">xem log</a>';
        } else {
          el.textContent = `⏳ Đang triển khai (${run.status})...`;
        }
      }
    } catch (e) { /* bỏ qua lỗi tạm */ }
    if (n > 60) { clearInterval(deployTimer); el.className = 'deploy'; el.textContent = 'Kiểm tra mục Actions của repo'; }
  }, 5000);
}

/*══════════════ 1. ĐĂNG NHẬP ══════════════*/
async function doLogin() {
  token = $('#tokenInput').value.trim();
  if (!token) { $('#loginErr').textContent = 'Nhập token trước.'; return; }
  const parts = ($('#repoInput').value.trim() || DEFAULT_REPO).split('/');
  if (parts.length !== 2) { $('#loginErr').textContent = 'Repo phải dạng owner/name'; return; }
  repo = { owner: parts[0], name: parts[1] };
  $('#loginErr').textContent = 'Đang kiểm tra...';

  try {
    const [user, info] = [await api('/user'), await repoApi('')];
    if (!(info.permissions && info.permissions.push)) throw new Error('Token không có quyền ghi (push) repo này.');
    localStorage.setItem('adm_token', token);
    localStorage.setItem('adm_repo', repo.owner + '/' + repo.name);
    await startApp(user);
  } catch (e) {
    $('#loginErr').textContent = e.message;
  }
}

function doLogout(msg) {
  localStorage.removeItem('adm_token');
  localStorage.removeItem('adm_repo');
  token = ''; data = null;
  $('#appView').hidden = true;
  $('#userBox').hidden = true;
  $('#loginView').style.display = 'flex';
  if (msg) $('#loginErr').textContent = msg;
}

async function startApp(user) {
  $('#loginView').style.display = 'none';
  $('#appView').hidden = false;
  $('#userBox').hidden = false;
  $('#avatar').src = user.avatar_url;
  $('#userName').textContent = user.login;
  $('#viewRepo').href = `https://github.com/${repo.owner}/${repo.name}`;
  $('#loginErr').textContent = '';
  try {
    await loadData();
    renderAll();
  } catch (e) {
    doLogout('Không đọc được dữ liệu repo: ' + e.message);
  }
}

/*══════════════ 2. DANH MỤC ══════════════*/
function renderCats() {
  $('#catSummary').textContent = `${data.categories.length} danh mục · ${data.books.length} sách`;
  $('#catBody').innerHTML = data.categories.map((c, i) => `
    <tr>
      <td>
        <button class="btn tiny" data-act="up"   data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Lên">↑</button>
        <button class="btn tiny" data-act="down" data-i="${i}" ${i === data.categories.length - 1 ? 'disabled' : ''} title="Xuống">↓</button>
      </td>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${c.count}</td>
      <td>
        <button class="btn tiny" data-act="rename" data-i="${i}">Đổi tên</button>
        <button class="btn tiny danger" data-act="del" data-i="${i}">Xóa</button>
      </td>
    </tr>`).join('');
}

async function catAction(act, i) {
  const c = data.categories[i];
  try {
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= data.categories.length) return;
      [data.categories[i], data.categories[j]] = [data.categories[j], data.categories[i]];
      await saveData(`Sắp xếp thứ tự danh mục "${c.name}"`);
      return;
    }

    if (act === 'rename') {
      const v = await modal({
        title: 'Đổi tên danh mục',
        html: `<label>Tên mới</label><input id="mName" value="${esc(c.name)}">`,
        buttons: [
          { label: 'Hủy', value: null },
          { label: 'Lưu', primary: true, onClick: (root) => {
              const nv = root.querySelector('#mName').value.trim();
              if (!nv) return false;
              if (nv !== c.name && data.categories.some(x => x.name === nv)) {
                alert('Danh mục "' + nv + '" đã tồn tại.'); return false;
              }
              data.books.forEach(b => { if (b.category === c.name) b.category = nv; });
              c.name = nv;
              return true;
            }
          }
        ]
      });
      if (v) await saveData(`Đổi tên danh mục → "${c.name}"`);
      return;
    }

    if (act === 'del') {
      if (c.count > 0) {
        const others = data.categories.filter(x => x.name !== c.name);
        if (!others.length) { alert('Không còn danh mục nào khác để chuyển sách vào.'); return; }
        let movedTo = null;
        const v = await modal({
          title: `Danh mục "${c.name}" có ${c.count} sách`,
          html: `<p>Phải chuyển hết sách sang danh mục khác trước khi xóa.</p>
                 <label>Chuyển ${c.count} sách vào</label>
                 <select id="mCat">${others.map(o => `<option>${esc(o.name)}</option>`).join('')}</select>`,
          buttons: [
            { label: 'Hủy', value: null },
            { label: 'Chuyển rồi xóa', danger: true, onClick: (root) => {
                movedTo = root.querySelector('#mCat').value;
                data.books.forEach(b => { if (b.category === c.name) b.category = movedTo; });
                data.categories = data.categories.filter(x => x !== c);
                return true;
              }
            }
          ]
        });
        if (v) await saveData(`Xóa danh mục "${c.name}", chuyển ${c.count} sách sang "${movedTo}"`);
      } else {
        const ok = await modal({
          title: `Xóa danh mục "${c.name}"?`,
          html: `<p>Danh mục trống, xóa là mất luôn tên này.</p>`,
          buttons: [ { label: 'Hủy', value: null }, { label: 'Xóa', danger: true, value: true } ]
        });
        if (ok) {
          data.categories = data.categories.filter(x => x !== c);
          await saveData(`Xóa danh mục "${c.name}"`);
        }
      }
    }
  } catch (e) { toast(e.message, 'err'); }
}

/*══════════════ 3. SÁCH ══════════════*/
function catOptions(sel) {
  return data.categories.map(c =>
    `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function applyBookFilter() {
  const q = ($('#bookSearch').value || '').trim().toLowerCase();
  const cf = $('#bookCatFilter').value;
  filtered = data.books.filter(b => {
    if (cf && b.category !== cf) return false;
    if (!q) return true;
    return (b.title || '').toLowerCase().includes(q)
        || (b.creator || '').toLowerCase().includes(q);
  });
  shown = PAGE_SIZE;
  renderBooks();
}

function renderBooks() {
  $('#bookSummary').textContent = `${filtered.length} / ${data.books.length} sách`;
  const body = $('#bookBody');
  const rows = filtered.slice(0, shown);

  body.innerHTML = rows.map(b => `
    <tr data-id="${b.id}" class="${selected.has(b.id) ? 'sel' : ''}">
      <td><input type="checkbox" class="rowChk" ${selected.has(b.id) ? 'checked' : ''}></td>
      <td>
        <div class="b-title">${esc(b.title)}</div>
        ${b.pdf ? `<span class="badge pdf">PDF</span>` : `<span class="badge">stbook</span>`}
        ${b.uuid ? `<span class="badge ghost">${esc(String(b.uuid).slice(0, 8))}…</span>` : ''}
      </td>
      <td>${esc(b.creator || '')}</td>
      <td>${esc(b.category || '')}</td>
      <td>${b.pages || 0}</td>
      <td>${b.pdf ? 'PDF' : 'Ảnh'}</td>
      <td>
        <button class="btn tiny" data-act="edit">Sửa</button>
        <button class="btn tiny danger" data-act="del">Xóa</button>
      </td>
    </tr>`).join('');

  $('#moreBtn').hidden = shown >= filtered.length;
  updateBulkBar();
}

function updateBulkBar() {
  const n = selected.size;
  $('#bulkBar').hidden = n === 0;
  $('#selCount').textContent = `${n} đã chọn`;
}

async function bookAction(act, id) {
  const b = data.books.find(x => x.id === id);
  if (!b) return;

  if (act === 'edit') {
    const v = await modal({
      title: 'Sửa thông tin sách',
      html: `
        <label>Tên sách</label><input id="mTitle" value="${esc(b.title)}">
        <label>Tác giả / nguồn</label><input id="mCreator" value="${esc(b.creator || '')}">
        <label>Danh mục</label><select id="mCat">${catOptions(b.category)}</select>
        <label>Số trang</label><input id="mPages" type="number" min="1" value="${b.pages || 1}">
        ${b.pdf ? `<label>File PDF (không sửa)</label><input id="mPdf" value="${esc(b.pdf)}" readonly>` : ''}`,
      buttons: [
        { label: 'Hủy', value: null },
        { label: 'Lưu', primary: true, onClick: (root) => {
            const t = root.querySelector('#mTitle').value.trim();
            if (!t) return false;
            b.title = t;
            b.creator = root.querySelector('#mCreator').value.trim();
            b.category = root.querySelector('#mCat').value;
            b.pages = Math.max(1, parseInt(root.querySelector('#mPages').value, 10) || 1);
            return true;
          }
        }
      ]
    });
    if (v) await saveData(`Sửa sách "${b.title}"`);
    return;
  }

  if (act === 'del') {
    const v = await modal({
      title: `Xóa sách "${b.title}"?`,
      html: `<p>Sách sẽ bị gỡ khỏi danh mục và trang chủ.</p>
        ${b.pdf ? `<label><input type="checkbox" id="mDelPdf" checked> Đồng thời xóa file <code>${esc(b.pdf)}</code></label>` : ''}`,
      buttons: [
        { label: 'Hủy', value: null },
        { label: 'Xóa sách', danger: true, onClick: (root) => {
            const chk = root.querySelector('#mDelPdf');
            return { delPdf: !!(chk && chk.checked) };
          }
        }
      ]
    });
    if (v) {
      data.books = data.books.filter(x => x.id !== id);
      selected.delete(id);
      const extra = (b.pdf && v.delPdf) ? [{ path: `site/${b.pdf}`, delete: true }] : [];
      await saveData(`Xóa sách "${b.title}"`, extra);
    }
  }
}

async function bulkMove() {
  const target = $('#bulkCat').value;
  if (!target || !selected.size) return;
  let n = 0;
  data.books.forEach(b => { if (selected.has(b.id)) { b.category = target; n++; } });
  const c = selected.size; selected.clear();
  await saveData(`Chuyển ${c} sách vào danh mục "${target}"`);
}

async function bulkDelete() {
  const ids = new Set(selected);
  const victims = data.books.filter(b => ids.has(b.id));
  const withPdf = victims.filter(b => b.pdf);
  const v = await modal({
    title: `Xóa ${victims.length} sách?`,
    html: `<p>Không hoàn tác được.</p>
      ${withPdf.length ? `<label><input type="checkbox" id="mDelPdf"> Xóa cả ${withPdf.length} file PDF kèm theo</label>` : ''}`,
    buttons: [
      { label: 'Hủy', value: null },
      { label: `Xóa ${victims.length} sách`, danger: true, onClick: (root) => {
          const chk = root.querySelector('#mDelPdf');
          return { delPdf: !!(chk && chk.checked) };
        }
      }
    ]
  });
  if (!v) return;
  data.books = data.books.filter(b => !ids.has(b.id));
  const extra = v.delPdf ? withPdf.map(b => ({ path: `site/${b.pdf}`, delete: true })) : [];
  selected.clear();
  await saveData(`Xóa ${victims.length} sách`, extra);
}

/*══════════════ 4. TẢI LÊN PDF ══════════════*/
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'sach';
}

let pdfjsPromise = null;
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Không tải được PDF.js (kiểm tra mạng)'));
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

async function countPages(file) {
  try {
    const pdfjs = await ensurePdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = doc.numPages;
    await doc.destroy();
    return n;
  } catch (e) { return 0; }
}

function addFiles(fileList) {
  const files = Array.from(fileList).filter(f =>
    f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { toast('Chỉ nhận file PDF.', 'err'); return; }
  const tooBig = files.filter(f => f.size > 100 * 1048576);
  if (tooBig.length) {
    toast(`${tooBig.length} file vượt 100MB (giới hạn GitHub): ${tooBig[0].name}`, 'err');
    return;
  }
  files.forEach(f => {
    const base = f.name.replace(/\.pdf$/i, '');
    queue.push({
      file: f,
      title: base,
      creator: '',
      category: data.categories[0] ? data.categories[0].name : '',
      pages: 0,
      blobSha: null
    });
  });
  renderQueue();
  detectPages();
}

async function detectPages() {
  const pending = queue.filter(q => !q.pages && !q.checking);
  if (!pending.length) return;
  $('#uploadMsg').textContent = 'Đang đọc số trang...';
  for (const it of pending) {
    it.checking = true;
    it.pages = await countPages(it.file);
    it.checking = false;
    renderQueue();
  }
  $('#uploadMsg').textContent = '';
}

function renderQueue() {
  $('#queueWrap').hidden = queue.length === 0;
  $('#queueBody').innerHTML = queue.map((it, i) => `
    <tr>
      <td>
        <div class="b-title">${esc(it.file.name)}</div>
        <span class="badge">${(it.file.size / 1048576).toFixed(2)} MB</span>
      </td>
      <td><input data-i="${i}" data-k="title" value="${esc(it.title)}"></td>
      <td><input data-i="${i}" data-k="creator" value="${esc(it.creator)}" placeholder="tác giả"></td>
      <td><select data-i="${i}" data-k="category">${catOptions(it.category)}</select></td>
      <td><input data-i="${i}" data-k="pages" type="number" min="1" value="${it.pages || ''}" placeholder="?"></td>
      <td><button class="btn tiny danger" data-rm="${i}">✕</button></td>
    </tr>`).join('');
  $('#uploadBtn').textContent = `⬆ Tải lên ${queue.length} cuốn`;
}

function uniquePdfPath(title) {
  const used = new Set(data.books.filter(b => b.pdf).map(b => b.pdf));
  let slug = slugify(title), n = 1, p = `${PDF_DIR_PUBLIC}/${slug}.pdf`;
  while (used.has(p)) p = `${PDF_DIR_PUBLIC}/${slug}-${++n}.pdf`;
  return p;
}

async function doUpload() {
  if (!queue.length) return;
  const total = queue.length;
  const bad = queue.find(q => !q.title.trim() || !(q.pages > 0));
  if (bad) {
    toast('Mỗi cuốn cần có tên sách và số trang (>0). Kiểm tra lại ô trống.', 'err');
    return;
  }
  const btn = $('#uploadBtn');
  btn.disabled = true;
  const msg = $('#uploadMsg');

  try {
    msg.textContent = 'Lấy dữ liệu mới nhất...';
    await loadData();                                   // tránh commit trên dữ liệu cũ

    msg.textContent = 'Tạo blob file PDF...';
    const files = [];
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i];
      msg.textContent = `Tạo blob ${i + 1}/${queue.length}: ${it.file.name}`;
      const blob = await repoApi('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: bufToB64(await it.file.arrayBuffer()), encoding: 'base64' })
      });
      const path = uniquePdfPath(it.title);
      files.push({ path: `site/${path}`, sha: blob.sha });
      data.books.push({
        id: (data.books.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0) || 0) + 1,
        title: it.title.trim(),
        creator: it.creator.trim(),
        category: it.category,
        pages: it.pages,
        size_mb: +(it.file.size / 1048576).toFixed(2),
        pdf: path
      });
    }

    msg.textContent = 'Commit...';
    recount();
    files.push({ path: BOOKS_PATH, base64: textToB64(JSON.stringify(data, null, 2)) });
    const c = await commitFiles(files, `Tải lên ${queue.length} sách PDF`);

    queue = [];
    renderQueue();
    $('#fileInput').value = '';
    toast(`Đã tải lên ${total} cuốn sách!`);
    watchDeploy(c.sha);
    renderAll();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    msg.textContent = '';
  }
}

/*══════════════ CÁC TAB / RENDER TỔNG ══════════════*/
function renderAll() {
  renderCats();
  // bộ lọc danh mục
  const cur = $('#bookCatFilter').value;
  $('#bookCatFilter').innerHTML = '<option value="">Tất cả danh mục</option>' +
    data.categories.map(c => `<option>${esc(c.name)}</option>`).join('');
  $('#bookCatFilter').value = cur;
  $('#bulkCat').innerHTML = catOptions('');
  $('#statLine').textContent = `${data.books.length} sách · ${data.categories.length} danh mục`;
  applyBookFilter();
}

function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

/*══════════════ GẮN SỰ KIỆN ══════════════*/
function bind() {
  $('#loginBtn').addEventListener('click', doLogin);
  $('#tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', () => doLogout());

  $$('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // danh mục
  $('#addCatBtn').addEventListener('click', async () => {
    const name = $('#newCatName').value.trim();
    if (!name) return;
    if (data.categories.some(c => c.name === name)) { toast('Danh mục đã tồn tại.', 'err'); return; }
    data.categories.push({ name, count: 0, size_gb: 0 });
    $('#newCatName').value = '';
    try { await saveData(`Tạo danh mục "${name}"`); } catch (e) { toast(e.message, 'err'); }
  });
  $('#newCatName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#addCatBtn').click(); });
  $('#catBody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (btn) catAction(btn.dataset.act, +btn.dataset.i);
  });

  // sách
  $('#bookSearch').addEventListener('input', applyBookFilter);
  $('#bookCatFilter').addEventListener('change', applyBookFilter);
  $('#moreBtn').addEventListener('click', () => { shown += PAGE_SIZE; renderBooks(); });
  $('#bookBody').addEventListener('click', e => {
    const chk = e.target.closest('.rowChk');
    if (chk) {
      const id = +chk.closest('tr').dataset.id;
      chk.checked ? selected.add(id) : selected.delete(id);
      chk.closest('tr').classList.toggle('sel', chk.checked);
      updateBulkBar();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (btn) bookAction(btn.dataset.act, +btn.closest('tr').dataset.id);
  });
  $('#selAll').addEventListener('change', e => {
    selected.clear();
    if (e.target.checked) filtered.slice(0, shown).forEach(b => selected.add(b.id));
    renderBooks();
  });
  $('#bulkMove').addEventListener('click', () => { bulkMove().catch(e => toast(e.message, 'err')); });
  $('#bulkDel').addEventListener('click', () => { bulkDelete().catch(e => toast(e.message, 'err')); });

  // upload
  const dz = $('#dropzone'), fi = $('#fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  $('#queueBody').addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset.k) return;
    const it = queue[+el.dataset.i];
    if (!it) return;
    it[el.dataset.k] = el.dataset.k === 'pages' ? (parseInt(el.value, 10) || 0) : el.value;
  });
  $('#queueBody').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.k === 'category') {
      const it = queue[+el.dataset.i];
      if (it) it.category = el.value;
    }
  });
  $('#queueBody').addEventListener('click', e => {
    const rm = e.target.closest('button[data-rm]');
    if (rm) { queue.splice(+rm.dataset.rm, 1); renderQueue(); }
  });
  $('#uploadBtn').addEventListener('click', () => { doUpload(); });
}

/*══════════════ KHỞI TẠO ══════════════*/
async function init() {
  bind();
  const savedRepo = localStorage.getItem('adm_repo');
  if (savedRepo) $('#repoInput').value = savedRepo;
  const savedToken = localStorage.getItem('adm_token');
  if (savedToken) {
    token = savedToken;
    const parts = $('#repoInput').value.split('/');
    repo = { owner: parts[0], name: parts[1] };
    try {
      const user = await api('/user');
      await startApp(user);
    } catch (e) { /* đã logout bên trong nếu 401 */ }
  }
}
init();
