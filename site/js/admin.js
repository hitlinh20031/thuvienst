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
const SETTINGS_PATH = 'site/data/settings.json';   // file giao diện

const DEFAULT_SETTINGS = {
  logoText: 'ST',
  siteName: 'Thư viện Sách',
  siteSub: 'Sách điện tử — trực tuyến',
  heroTitle: 'Thư viện Sách điện tử',
  heroDesc: 'Kho tàng tri thức các ngành chính trị, pháp luật và lịch sử Việt Nam',
  accent: '#c0392b',
  footerText: 'Thư viện sách điện tử trực tuyến'
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let token = '';
let repo  = { owner: '', name: '' };
let data  = null;               // nội dung books.json
let settings = Object.assign({}, DEFAULT_SETTINGS); // cài đặt giao diện
let filtered = [];
let selected = new Set();       // id sách được tick
let shown = PAGE_SIZE;
let queue = [];                 // hàng đợi file chờ upload
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
  if (opts.body && typeof opts.body === 'string' && !headers['Content-Type'])
    headers['Content-Type'] = 'application/json';

  // KHÔNG dùng cache của trình duyệt: GitHub trả max-age=60 cho GET /git/ref,
  // nếu cache thì commit thứ 2 sẽ đọc ref cũ và bị lỗi "not a fast forward".
  const res = await fetch(url, Object.assign({}, opts, { headers, cache: 'no-store' }));
  if (res.status === 401) { doLogout('Token không hợp lệ hoặc đã hết hạn.'); throw new Error('401'); }
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset');
    let m = 'Bị chặn quyền (403).';
    try { const j = await res.json(); if (j.message) m = j.message; } catch (e) {}
    if (res.headers.get('x-ratelimit-remaining') === '0' && reset)
      m = `Hết hạn mức API GitHub, thử lại sau ${new Date(+reset * 1000).toLocaleTimeString('vi')}.`;
    throw new Error(m);
  }
  if (res.status === 404) {
    throw new Error(`Lỗi 404 tại ${opts.method || 'GET'} ${path.replace(/^\/repos/, '')} — không có quyền ghi. Token thiếu scope "repo": tạo lại token classic (https://github.com/settings/tokens/new) và tick repo.`);
  }
  if (!res.ok) {
    let m = `Lỗi ${res.status}`;
    try { const j = await res.json(); if (j.message) m += ': ' + j.message; } catch (e) {}
    throw new Error(m);
  }
  return res.status === 204 ? null : res.json();
}

/* Đọc scope của token để chẩn đoán quyền */
async function checkScopes() {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`
      }
    });
    const scopes = (res.headers.get('x-oauth-scopes') || '').trim();
    const type = res.headers.get('x-github-authentication-token-type') || '';
    return { scopes, type, ok: /\b(repo|public_repo)\b/.test(scopes) };
  } catch (e) { return { scopes: '', type: '', ok: false }; }
}

const repoApi = (p, opts) => api(`/repos/${repo.owner}/${repo.name}${p}`, opts);

/*──────────────── Thông báo / hộp thoại ────────────────*/
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  const life = type === 'err' ? 9000 : 4200;
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, life);
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
        let val = b.value;
        if (b.onClick) {
          const r = b.onClick(ov);
          if (r === false) return;              // trả false = giữ hộp thoại
          if (r !== undefined) val = r;         // lấy giá trị mà onClick trả về
        }
        ov.remove();
        resolve(val === undefined ? true : val);
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
  // bảo đảm mọi danh mục cha đều tồn tại: có sách/con ở "A/B" thì phải có "A"
  const seen = new Set(data.categories.map(c => c.name));
  data.categories.slice().forEach(c => {
    const parts = String(c.name).split(SEP);
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join(SEP);
      if (!seen.has(p)) { seen.add(p); data.categories.push({ name: p, count: 0, size_gb: 0 }); }
    }
  });
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
  // đọc file giao diện (nếu chưa có thì dùng mặc định)
  try {
    const s = await repoApi(`/contents/${SETTINGS_PATH}?ref=${BRANCH}`);
    settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(b64ToText(s.content)));
  } catch (e) {
    settings = Object.assign({}, DEFAULT_SETTINGS);
  }
}

/* Commit có thử lại: nếu ref vừa bị người khác (hoặc tab khác) cập nhật
   → GitHub trả 422 "not a fast forward" → đọc lại ref rồi làm lại. */
async function commitFiles(files, message) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await commitFilesOnce(files, message);
    } catch (e) {
      lastErr = e;
      const conflict = /fast forward|422/i.test(e.message);
      if (conflict && attempt < 3) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function commitFilesOnce(files, message) {
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

  // chẩn đoán quyền của token
  const sc = await checkScopes();
  const warn = $('#scopeWarn');
  if (sc.ok) {
    warn.hidden = true;
  } else {
    warn.hidden = false;
    warn.innerHTML = `⚠️ <strong>Token chưa có quyền ghi.</strong>
      Scope hiện tại: <code>${esc(sc.scopes || '(trống — nhiều khả năng là token fine-grained)')}</code>.
      Hãy tạo lại <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">token classic</a>,
      tick mục <strong>repo</strong> → copy token mới → đăng nhập lại.
      <button class="btn tiny" id="reloginBtn">Nhập lại token</button>`;
    const rl = document.getElementById('reloginBtn');
    if (rl) rl.addEventListener('click', () => doLogout());
  }
  try {
    await loadData();
    renderAll();
    fillThemeForm();
  } catch (e) {
    doLogout('Không đọc được dữ liệu repo: ' + e.message);
  }
}

/*══════════════ 2. DANH MỤC (có cấp cha – con) ══════════════*/
/* Tên danh mục = đường dẫn phân cấp, phân cách bằng "/" vd: "Văn kiện Đảng/Đại hội XIV" */
const SEP = '/';
const leafOf   = n => { const s = String(n); const i = s.lastIndexOf(SEP); return i < 0 ? s : s.slice(i + 1); };
const parentOf = n => { const s = String(n); const i = s.lastIndexOf(SEP); return i < 0 ? '' : s.slice(0, i); };
const depthOf  = n => String(n).split(SEP).length - 1;
const kidsOf   = p => data.categories.filter(c => parentOf(c.name) === p);
const inSubtree = (cat, path) => cat === path || String(cat || '').startsWith(path + SEP);

function rootCats() {
  const names = new Set(data.categories.map(c => c.name));
  return data.categories.filter(c => !c.name.includes(SEP) || !names.has(parentOf(c.name)));
}
/* Thứ tự hiển thị: cha trước, các con ngay sau (DFS) */
function catTree() {
  const out = [];
  const walk = list => list.forEach(c => { out.push(c); walk(kidsOf(c.name)); });
  walk(rootCats());
  return out;
}
function siblingsOf(c) {
  const p = parentOf(c.name);
  const names = new Set(data.categories.map(x => x.name));
  return (!p || !names.has(p)) ? rootCats() : kidsOf(p);
}

function renderCats() {
  $('#catSummary').textContent = `${data.categories.length} danh mục · ${data.books.length} sách`;
  const tree = catTree();
  $('#catBody').innerHTML = tree.map(c => {
    const i    = data.categories.indexOf(c);
    const d    = depthOf(c.name);
    const kids = kidsOf(c.name);
    const sib  = siblingsOf(c);
    const k    = sib.indexOf(c);
    const total = kids.length
      ? data.books.filter(b => inSubtree(b, c.name)).length
      : c.count;
    return `
    <tr>
      <td>
        <button class="btn tiny" data-act="up"   data-i="${i}" ${k <= 0 ? 'disabled' : ''} title="Lên">↑</button>
        <button class="btn tiny" data-act="down" data-i="${i}" ${k >= sib.length - 1 ? 'disabled' : ''} title="Xuống">↓</button>
      </td>
      <td class="cat-name" style="padding-left:${6 + d * 22}px" title="${esc(c.name)}">${d ? '<span class="branch">└</span>' : '<span class="folder-ic">📁</span>'}${d ? `<span class="muted path">${esc(parentOf(c.name))}/</span>` : ''}<strong>${esc(leafOf(c.name))}</strong></td>
      <td>${c.count}${total !== c.count ? ` <span class="muted">(tổng ${total})</span>` : ''}</td>
      <td>
        <button class="btn tiny" data-act="add"    data-i="${i}" title="Tạo danh mục bên trong">＋ Con</button>
        <button class="btn tiny" data-act="rename" data-i="${i}">Đổi tên</button>
        <button class="btn tiny danger" data-act="del" data-i="${i}">Xóa</button>
      </td>
    </tr>`;
  }).join('');
}

async function catAction(act, i) {
  const c = data.categories[i];
  if (!c) return;
  try {
    /* ---- sắp xếp trong cùng cấp ---- */
    if (act === 'up' || act === 'down') {
      const sib = siblingsOf(c), k = sib.indexOf(c);
      const other = act === 'up' ? sib[k - 1] : sib[k + 1];
      if (!other) return;
      const pi = data.categories.indexOf(c), pj = data.categories.indexOf(other);
      [data.categories[pi], data.categories[pj]] = [data.categories[pj], data.categories[pi]];
      await saveData(`Sắp xếp thứ tự danh mục "${leafOf(c.name)}"`);
      return;
    }

    /* ---- tạo danh mục con ---- */
    if (act === 'add') {
      let np = '';
      const v = await modal({
        title: `Thêm danh mục con trong "${leafOf(c.name)}"`,
        html: `<label>Tên danh mục con</label>
               <input id="mName" placeholder="Ví dụ: Đại hội XIV">
               <p class="hint">Sẽ tạo: <code>${esc(c.name + SEP + 'tên-bạn-nhập')}</code></p>`,
        buttons: [
          { label: 'Hủy', value: null },
          { label: 'Tạo danh mục con', primary: true, onClick: (root) => {
              const nv = root.querySelector('#mName').value.trim();
              if (!nv) return false;
              if (nv.includes(SEP)) { alert('Tên không được chứa dấu "/"'); return false; }
              np = c.name + SEP + nv;
              if (data.categories.some(x => x.name === np)) { alert('Đã có danh mục này rồi.'); return false; }
              return nv;
            }
          }
        ]
      });
      if (v) {
        data.categories.push({ name: np, count: 0, size_gb: 0 });
        await saveData(`Tạo danh mục con "${v}" trong "${leafOf(c.name)}"`);
      }
      return;
    }

    /* ---- đổi tên (đổi cả đường dẫn của mọi thứ bên trong) ---- */
    if (act === 'rename') {
      const oldName = c.name, p = parentOf(oldName);
      let nv = '';
      const v = await modal({
        title: 'Đổi tên danh mục',
        html: `<label>Tên mới</label><input id="mName" value="${esc(leafOf(oldName))}">
               ${kidsOf(oldName).length ? `<p class="hint">Có ${kidsOf(oldName).length} danh mục con — đường dẫn của chúng sẽ tự cập nhật theo.</p>` : ''}`,
        buttons: [
          { label: 'Hủy', value: null },
          { label: 'Lưu', primary: true, onClick: (root) => {
              const t = root.querySelector('#mName').value.trim();
              if (!t) return false;
              if (t.includes(SEP)) { alert('Tên không được chứa dấu "/"'); return false; }
              const np = p ? p + SEP + t : t;
              if (np !== oldName && data.categories.some(x => x.name === np)) { alert('Danh mục "' + t + '" đã tồn tại.'); return false; }
              nv = t; return true;
            }
          }
        ]
      });
      if (v) {
        const np = p ? p + SEP + nv : nv;
        const move = s => s === oldName ? np
          : (s.startsWith(oldName + SEP) ? np + SEP + s.slice(oldName.length + 1) : s);
        data.categories.forEach(x => { x.name = move(x.name); });
        data.books.forEach(b => { if (b.category) b.category = move(b.category); });
        await saveData(`Đổi danh mục "${leafOf(oldName)}" → "${nv}"`);
      }
      return;
    }

    /* ---- xóa ---- */
    if (act === 'del') {
      const oldName = c.name;
      const kids    = kidsOf(oldName);
      const direct  = data.books.filter(b => b.category === oldName).length;
      const targets = data.categories.filter(x => !inSubtree(x.name, oldName));
      if ((direct || kids.length) && !targets.length) {
        alert('Không còn danh mục nào khác để chứa sách/con. Hãy tạo thêm 1 danh mục khác trước.');
        return;
      }
      let movedTo = null;
      const v = await modal({
        title: `Xóa danh mục "${leafOf(oldName)}"?`,
        html: `
          ${direct ? `<p><strong>${direct}</strong> sách đang nằm trực tiếp ở đây → chọn nơi chuyển sang:</p>
                      <select id="mCat">${treeOptions(targets, '')}</select>` : ''}
          ${kids.length ? `<p>Danh mục con (${kids.length}) sẽ <strong>lên cấp trên</strong>, không mất gì cả.</p>` : ''}
          ${!direct && !kids.length ? '<p>Danh mục trống, xóa là mất luôn tên này.</p>' : ''}`,
        buttons: [
          { label: 'Hủy', value: null },
          { label: 'Xóa danh mục', danger: true, onClick: (root) => {
              const sel = root.querySelector('#mCat');
              if (direct) { movedTo = sel.value; if (!movedTo) return false; }
              if (direct) data.books.forEach(b => { if (b.category === oldName) b.category = movedTo; });
              if (kids.length) {
                const fix = s => s.startsWith(oldName + SEP) ? s.slice(oldName.length + 1) : s;
                data.categories.forEach(x => { if (x.name.startsWith(oldName + SEP)) x.name = fix(x.name); });
                data.books.forEach(b => { if (b.category && b.category.startsWith(oldName + SEP)) b.category = fix(b.category); });
              }
              data.categories = data.categories.filter(x => x !== c);
              return true;
            }
          }
        ]
      });
      if (v) {
        let msg = `Xóa danh mục "${leafOf(oldName)}"`;
        if (kids.length) msg += `, ${kids.length} danh mục con lên cấp trên`;
        if (direct) msg += `, chuyển ${direct} sách sang "${movedTo}"`;
        await saveData(msg);
      }
      return;
    }
  } catch (e) { toast(e.message, 'err'); }
}

/*══════════════ 3. SÁCH ══════════════*/
/* Tạo <option> theo cây (cha trên, con lùi vào) — nhận 1 danh sách để loại trừ khi cần */
function treeOptions(list, sel) {
  const names = new Set(list.map(x => x.name));
  const kids  = p => list.filter(x => parentOf(x.name) === p);
  const roots = list.filter(x => !x.name.includes(SEP) || !names.has(parentOf(x.name)));
  const walk = (arr, d) => arr.map(x => {
    const ind = d ? '&nbsp;'.repeat(d * 3) + '└ ' : '';
    return `<option value="${esc(x.name)}" ${x.name === sel ? 'selected' : ''}>${ind}${esc(leafOf(x.name))}</option>`
         + walk(kids(x.name), d + 1);
  }).join('');
  return walk(roots, 0);
}
const catOptions = (sel) => treeOptions(data.categories, sel);

function applyBookFilter() {
  const q = ($('#bookSearch').value || '').trim().toLowerCase();
  const cf = $('#bookCatFilter').value;
  filtered = data.books.filter(b => {
    if (cf && !inSubtree(b.category, cf)) return false;   // chọn cha = gồm cả mọi danh mục con
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
        ${b.pdf ? `<span class="badge${b.pdf.toLowerCase().endsWith('.pdf') ? ' pdf' : ''}">${extLabel(b.pdf)}</span>` : `<span class="badge">stbook</span>`}
        ${b.uuid ? `<span class="badge ghost">${esc(String(b.uuid).slice(0, 8))}…</span>` : ''}
      </td>
      <td>${esc(b.creator || '')}</td>
      <td class="cat-cell" title="${esc(b.category || '')}">${b.category
        ? `${parentOf(b.category) ? `<span class="muted">${esc(parentOf(b.category))}/</span>` : ''}${esc(leafOf(b.category))}`
        : '<span class="muted">—</span>'}</td>
      <td>${b.pages || 0}</td>
      <td>${b.pdf ? extLabel(b.pdf) : 'Ảnh'}</td>
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
        ${b.pdf ? `<label>File đính kèm (không sửa)</label><input id="mPdf" value="${esc(b.pdf)}" readonly>` : ''}`,
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
      ${withPdf.length ? `<label><input type="checkbox" id="mDelPdf"> Xóa cả ${withPdf.length} file đính kèm</label>` : ''}`,
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

/*══════════════ 3b. THÊM SÁCH THỦ CÔNG ══════════════*/
async function addBook() {
  if (!data.categories.length) { toast('Hãy tạo danh mục trước khi thêm sách.', 'err'); return; }
  const v = await modal({
    title: 'Thêm sách mới',
    html: `
      <label>Tên sách *</label><input id="mTitle" placeholder="Tên đầy đủ của sách">
      <label>Tác giả / người biên</label><input id="mCreator" placeholder="Để trống nếu không rõ">
      <label>Danh mục *</label><select id="mCat">${catOptions('')}</select>
      <label>Số trang</label><input id="mPages" type="number" min="1" value="1">
      <label>Đường dẫn file (nếu có, ví dụ: pdfs/sach.pdf hoặc pdfs/sach.docx)</label>
      <input id="mPdf" placeholder="Để trống nếu chưa có file">
      <p class="hint">Sách có file (PDF/Word) sẽ mở khi bấm vào; nếu để trống thì chỉ hiện thông tin.</p>`,
    buttons: [
      { label: 'Hủy', value: null },
      { label: 'Thêm sách', primary: true, onClick: (root) => {
          const t = root.querySelector('#mTitle').value.trim();
          if (!t) { toast('Phải có tên sách.', 'err'); return false; }
          let pdf = root.querySelector('#mPdf').value.trim().replace(/^\/+/, '');
          if (pdf && !/^https?:\/\//i.test(pdf) && !/^pdfs\//i.test(pdf)) pdf = 'pdfs/' + pdf;
          return {
            title: t,
            creator: root.querySelector('#mCreator').value.trim(),
            category: root.querySelector('#mCat').value,
            pages: Math.max(1, parseInt(root.querySelector('#mPages').value, 10) || 1),
            pdf: pdf || ''
          };
        }
      }
    ]
  });
  if (!v) return;
  const id = (data.books.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0) || 0) + 1;
  const book = { id, title: v.title, creator: v.creator, category: v.category, pages: v.pages };
  if (v.pdf) book.pdf = v.pdf;
  data.books.push(book);
  try {
    await saveData(`Thêm sách "${v.title}"`);
    toast(`Đã thêm "${v.title}" vào danh mục "${v.category}".`);
  } catch (e) { toast(e.message, 'err'); }
}

/*══════════════ 3c. GIAO DIỆN (theme) ══════════════*/
const THEME_MAP = {
  thSiteName: 'siteName', thSiteSub: 'siteSub', thLogoText: 'logoText',
  thHeroTitle: 'heroTitle', thHeroDesc: 'heroDesc', thFooterText: 'footerText'
};

function fillThemeForm() {
  Object.keys(THEME_MAP).forEach(id => { $('#' + id).value = settings[THEME_MAP[id]] || ''; });
  const acc = /^#[0-9a-fA-F]{6}$/.test(String(settings.accent || '')) ? settings.accent : '#c0392b';
  $('#thAccent').value = acc;
  $('#thAccentText').value = acc;
  updateThemePreview();
}

function readThemeForm() {
  const o = {};
  Object.keys(THEME_MAP).forEach(id => { o[THEME_MAP[id]] = $('#' + id).value.trim(); });
  const hex = ($('#thAccentText').value || '').trim();
  o.accent = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : (settings.accent || '#c0392b');
  return o;
}

function updateThemePreview() {
  const s = readThemeForm();
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val || ''; };
  set('tpLogo', s.logoText);
  set('tpTitle', s.siteName);
  set('tpSub', s.siteSub);
  set('tpHero', s.heroTitle);
  set('tpHeroDesc', s.heroDesc);
  set('tpFooter', s.footerText);

  const acc = s.accent;
  const r = parseInt(acc.slice(1, 3), 16), g = parseInt(acc.slice(3, 5), 16), b = parseInt(acc.slice(5, 7), 16);
  const light = (v) => Math.round(v + (255 - v) * 0.35);
  const ap = $('#accentPrev');
  ap.style.background = acc;
  ap.style.color = '#fff';
  const btn = $('#tpBtn');
  btn.style.background = acc;
  btn.style.color = '#fff';
  const hero = document.querySelector('.tp-hero');
  if (hero) hero.style.background = `linear-gradient(135deg, ${acc}, rgb(${light(r)}, ${light(g)}, ${light(b)}))`;
  const logo = $('#tpLogo');
  if (logo) { logo.style.background = acc; logo.style.color = '#fff'; }
}

async function saveTheme() {
  const btn = $('#saveThemeBtn');
  btn.disabled = true;
  $('#themeMsg').textContent = 'Đang lưu...';
  try {
    settings = readThemeForm();
    const files = [{ path: SETTINGS_PATH, base64: textToB64(JSON.stringify(settings, null, 2)) }];
    const c = await commitFiles(files, 'Cập nhật giao diện trang chủ');
    toast('Đã lưu giao diện!');
    $('#themeMsg').textContent = '';
    watchDeploy(c.sha);
  } catch (e) {
    toast(e.message, 'err');
    $('#themeMsg').textContent = '';
  } finally { btn.disabled = false; }
}

/*══════════════ 4. TẢI LÊN TÀI LIỆU (PDF / DOCX) ══════════════*/
/* Nhận file PDF và file Word (.docx, .doc) */
const OK_FILE = /\.(pdf|docx|doc)$/i;
const isWordFile = f => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf';
function fileExt(f) { const m = /\.([a-z0-9]+)$/i.exec(f.name); return m ? m[1].toLowerCase() : 'pdf'; }
function extLabel(p) { const e = String(p || '').split('.').pop().toUpperCase(); return e === 'DOCX' ? 'DOCX' : e; }
/* Danh mục đã chọn cho lần tải này (ưu tiên ô đang chọn → lần trước → đầu tiên) */
function defaultCat() {
  const cur = $('#upCat') ? $('#upCat').value : '';
  if (cur) return cur;
  const saved = localStorage.getItem('adm_upcat');
  if (saved && data.categories.some(c => c.name === saved)) return saved;
  return data.categories[0] ? data.categories[0].name : '';
}

function fillUpCat() {
  const sel = $('#upCat');
  if (!sel || !data) return;
  const want = sel.value || localStorage.getItem('adm_upcat');
  sel.innerHTML = catOptions('');
  sel.value = (want && data.categories.some(c => c.name === want))
    ? want
    : (data.categories[0] ? data.categories[0].name : '');
}

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
  const all = Array.from(fileList);
  const files = all.filter(f => OK_FILE.test(f.name) || f.type === 'application/pdf');
  const dropped = all.length - files.length;
  if (!files.length) { toast('Chỉ nhận file PDF hoặc Word (.docx, .doc).', 'err'); return; }
  if (dropped) toast(`Bỏ qua ${dropped} file không phải PDF/Word.`, 'err');
  const tooBig = files.filter(f => f.size > 100 * 1048576);
  if (tooBig.length) {
    toast(`${tooBig.length} file vượt 100MB (giới hạn GitHub): ${tooBig[0].name}`, 'err');
    return;
  }
  files.forEach(f => {
    const base = f.name.replace(/\.[^.]+$/, '');        // bỏ đuôi file (.pdf/.docx/...)
    queue.push({
      file: f,
      title: base,
      creator: '',
      category: defaultCat(),
      pages: 0,
      blobSha: null
    });
  });
  renderQueue();
  detectPages();
}

async function detectPages() {
  // chỉ PDF mới đọc được số trang; file Word để trống cho người nhập tay
  const pending = queue.filter(q => !q.pages && !q.checking && OK_FILE.test(q.file.name) && !isWordFile(q.file));
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

function uniqueDocPath(title, ext) {
  const used = new Set(data.books.filter(b => b.pdf).map(b => b.pdf));
  let slug = slugify(title), n = 1, p = `${PDF_DIR_PUBLIC}/${slug}.${ext}`;
  while (used.has(p)) p = `${PDF_DIR_PUBLIC}/${slug}-${++n}.${ext}`;
  return p;
}

async function doUpload() {
  if (!queue.length) return;
  const total = queue.length;
  const bad = queue.find(q => !q.title.trim() || (!isWordFile(q.file) && !(q.pages > 0)));
  if (bad) {
    toast('Mỗi cuốn cần có tên sách; file PDF cần số trang (>0). File Word để trống cũng được.', 'err');
    return;
  }
  const btn = $('#uploadBtn');
  btn.disabled = true;
  const msg = $('#uploadMsg');

  try {
    msg.textContent = 'Lấy dữ liệu mới nhất...';
    await loadData();                                   // tránh commit trên dữ liệu cũ

    msg.textContent = 'Tạo blob file...';
    const files = [];
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i];
      msg.textContent = `Tạo blob ${i + 1}/${queue.length}: ${it.file.name}`;
      const blob = await repoApi('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: bufToB64(await it.file.arrayBuffer()), encoding: 'base64' })
      });
      const path = uniqueDocPath(it.title, fileExt(it.file));
      files.push({ path: `site/${path}`, sha: blob.sha });
      data.books.push({
        id: (data.books.reduce((m, b) => Math.max(m, Number(b.id) || 0), 0) || 0) + 1,
        title: it.title.trim(),
        creator: it.creator.trim(),
        category: it.category,
        pages: Number(it.pages) || 0,
        size_mb: +(it.file.size / 1048576).toFixed(2),
        pdf: path
      });
    }

    msg.textContent = 'Commit...';
    recount();
    files.push({ path: BOOKS_PATH, base64: textToB64(JSON.stringify(data, null, 2)) });
    const c = await commitFiles(files, `Tải lên ${queue.length} tài liệu (PDF/Word)`);

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
  // bộ lọc danh mục (theo cây)
  const cur = $('#bookCatFilter').value;
  $('#bookCatFilter').innerHTML = '<option value="">Tất cả danh mục</option>' + treeOptions(data.categories, cur);
  $('#bookCatFilter').value = cur;
  $('#bulkCat').innerHTML = catOptions('');
  fillUpCat();
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
    if (name.includes(SEP)) { toast('Tên danh mục không được chứa dấu "/".', 'err'); return; }
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
  $('#addBookBtn').addEventListener('click', () => { addBook().catch(e => toast(e.message, 'err')); });

  // giao diện
  Object.keys(THEME_MAP).forEach(id => $('#' + id).addEventListener('input', updateThemePreview));
  $('#thAccent').addEventListener('input', e => { $('#thAccentText').value = e.target.value; updateThemePreview(); });
  $('#thAccentText').addEventListener('input', e => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) { $('#thAccent').value = v; updateThemePreview(); }
  });
  $('#saveThemeBtn').addEventListener('click', () => { saveTheme(); });

  // upload
  const dz = $('#dropzone'), fi = $('#fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  // danh mục mặc định cho lần tải: chọn 1 lần, áp dụng cho mọi file
  $('#upCat').addEventListener('change', e => {
    const v = e.target.value;
    localStorage.setItem('adm_upcat', v);
    if (queue.length) {
      queue.forEach(q => { q.category = v; });
      renderQueue();
      toast(`Đã đổi danh mục của ${queue.length} file thành "${v}".`);
    }
  });

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
