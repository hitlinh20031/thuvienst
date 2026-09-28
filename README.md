# Thư viện Sách điện tử

Website đọc sách trực tuyến dạng **web tĩnh** (không cần backend), host miễn phí trên
Cloudflare Pages. Catalog gồm ~390 đầu sách, trình đọc có hiệu ứng **giở sách thật**
(cuộn góc, bóng đổ) bằng thư viện StPageFlip, hỗ trợ xem 1 trang / 2 trang.

> Bản gốc đang chạy tại `thuvien.x.org.vn`.

---

## 1. Kiến trúc tổng quan

- **Web tĩnh thuần** HTML/CSS/JS — không có server, không build step. Push file là chạy.
- **Catalog** nằm trong 1 file JSON tĩnh: [`site/data/books.json`](site/data/books.json).
- **Ảnh trang sách** không nằm trong repo — được load từ nguồn ngoài, cấu hình qua
  hằng `IMAGE_SOURCE` (xem mục 5). Bản gốc load trực tiếp từ `stbook.vn`.
- **Trình đọc** (`read.html`) ghép 4 mảnh ảnh cho mỗi trang rồi dựng thành sách lật
  bằng StBook/StPageFlip ([`site/js/page-flip.browser.js`](site/js/page-flip.browser.js), self-host).
- **Hosting**: Cloudflare Pages (miễn phí). Deploy bằng `wrangler`.

```
Trình duyệt ──> Cloudflare Pages (HTML/CSS/JS + books.json)
                      │
                      └─ ảnh trang sách ──> stbook.vn  (hoặc R2 / custom)
```

---

## 2. Yêu cầu môi trường

| Thành phần | Dùng để | Ghi chú |
|---|---|---|
| **Node.js** (≥18) | chạy `wrangler` CLI | https://nodejs.org |
| **Cloudflare account** | host trên Pages | miễn phí |
| **`wrangler`** | deploy | `npx wrangler ...` (không cần cài global) |
| **Python 3** | chạy web server local | chỉ để xem thử máy mình |
| **git** | clone / push | — |

---

## 3. Chạy thử ở máy local

Site dùng đường dẫn tuyệt đối (`/css/...`, `/data/books.json`) nên **phải chạy qua HTTP
server**, không mở file trực tiếp bằng `file://`.

```bash
python3 -m http.server 8080 --directory site
```

Mở trình duyệt: http://localhost:8080

---

## 4. Cấu trúc thư mục

```
.
├── site/                     # Toàn bộ web tĩnh (đây là thư mục được deploy)
│   ├── index.html            # Trang chủ: catalog + dropdown danh mục + tìm kiếm
│   ├── read.html             # Trang đọc sách (giở sách thật)
│   ├── css/
│   │   ├── style.css         # Style trang chủ
│   │   └── reader.css        # Style trình đọc
│   ├── js/
│   │   ├── catalog.js        # Logic trang chủ (render catalog, lọc, tìm kiếm)
│   │   ├── reader.js         # Logic trình đọc + tích hợp StPageFlip
│   │   └── page-flip.browser.js  # Thư viện lật trang (self-host)
│   └── data/
│       └── books.json        # Dữ liệu catalog (danh sách sách + danh mục)
├── scripts/
│   └── upload_to_r2.py       # Script upload ảnh sách lên Cloudflare R2 (tùy chọn)
├── wrangler.toml             # Cấu hình Cloudflare (Pages + R2 binding)
├── DEPLOY.md                 # Hướng dẫn deploy chi tiết
├── .env.example              # Mẫu biến môi trường (copy thành .env)
└── README.md
```

---

## 5. Cấu hình nguồn ảnh (`IMAGE_SOURCE`)

Ở đầu **cả hai** file [`site/js/catalog.js`](site/js/catalog.js) và
[`site/js/reader.js`](site/js/reader.js) có khối cấu hình:

```js
const IMAGE_SOURCE = 'stbook';   // 'stbook' | 'r2' | 'custom'
const R2_BASE = 'https://pub-xxxx.r2.dev';
const CUSTOM_BASE = '';
```

- `stbook` — load trực tiếp từ stbook.vn (mặc định của bản gốc).
- `r2` — load từ Cloudflare R2 bucket của bạn (khi tự host ảnh).
- `custom` — URL tùy ý (set `CUSTOM_BASE`).

**Format URL** (chế độ `stbook`): mỗi trang gồm 4 mảnh, part đứng **trước** page:
`https://stbook.vn/cbs20/download_preview/img.json/{uuid}/img_short_{part}{page}/_READ`
(ví dụ part 3 của trang 12 = `img_short_312`).

---

## 6. Định dạng `books.json`

```jsonc
{
  "total": 390,
  "categories": [
    { "name": "Chủ tịch Hồ Chí Minh", "count": 134 }
    // ...
  ],
  "books": [
    {
      "id": 146,
      "uuid": "facf3d40bf104ffdbf6b97ab94a9d489",
      "title": "130 câu nói của Chủ tịch Hồ Chí Minh...",
      "category": "Xây dựng Đảng, Nhà nước",
      "creator": "Đại tướng, GS.TS. Tô Lâm",
      "pages": 78,          // số trang THẬT (rất quan trọng cho trình đọc)
      "size_mb": 1.46
    }
    // ...
  ]
}
```

> Thêm/sửa sách = sửa file này. `pages` phải là số trang thật thì trình đọc mới
> hiển thị đúng và slider mới chuẩn.

---

## 7. Deploy lên Cloudflare Pages

Chi tiết đầy đủ ở [DEPLOY.md](DEPLOY.md). Tóm tắt:

```bash
# 1. Copy mẫu env rồi điền token của bạn
cp .env.example .env
#    -> điền CLOUDFLARE_API_TOKEN và CLOUDFLARE_ACCOUNT_ID trong .env

# 2. Deploy (đọc token từ .env)
source .env
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
npx wrangler pages deploy site --project-name <ten-project-cua-ban>
```

Sau đó vào Cloudflare Dashboard → Pages → project → **Custom domains** để gắn domain.

> ⚠️ **KHÔNG commit file `.env`** — nó chứa token. File này đã có trong `.gitignore`.

---

## 8. Thêm tính năng "Tự thêm sách PDF"

Trình đọc hiện tại **chỉ đọc ảnh 4 mảnh theo format stbook.vn**, chưa đọc PDF. Muốn dùng
sách PDF của riêng mình phải đổi cách hiển thị. Có 2 hướng:

### Hướng A — Thêm thủ công (giữ web tĩnh, khuyến nghị bắt đầu ở đây)

Ý tưởng: tự host nội dung, thêm sách bằng script rồi deploy lại. Không cần backend, chi phí ~$0.

**Cần:**
- **Cloudflare R2** (miễn phí 10GB, không tính phí băng thông) để chứa file.
- Đổi trình đọc sang **[PDF.js](https://mozilla.github.io/pdf.js/)** để render PDF, hoặc
  convert PDF → ảnh từng trang.

**Các bước:**
1. Tạo R2 bucket + bật public access (xem DEPLOY.md mục 4).
2. Chọn 1 trong 2 cách đọc:
   - **PDF.js (đơn giản hơn):** để nguyên file `.pdf` trên R2. Sửa `reader.js` dùng
     PDF.js render từng trang ra canvas; muốn giữ hiệu ứng lật thì đưa canvas mỗi trang
     vào StPageFlip. Ưu điểm: không cần xử lý ảnh. Nhược điểm: file PDF nặng hơn ảnh.
   - **Convert sang ảnh:** dùng `pdftoppm`/ImageMagick tách PDF thành `page_001.png...`,
     upload lên R2 (tham khảo [`scripts/upload_to_r2.py`](scripts/upload_to_r2.py)), rồi
     đặt `IMAGE_SOURCE = 'r2'`.
3. Thêm 1 bản ghi vào `site/data/books.json` (id, uuid/slug, title, `pages`, ...).
4. `npx wrangler pages deploy site` để cập nhật.

Có thể viết 1 script `scripts/add_book.py` gộp bước 2–3: nhận 1 file PDF → tách/upload →
tự chèn dòng vào `books.json`.

### Hướng B — Tự upload qua web (có trang admin thật sự)

Ý tưởng: có trang admin để upload PDF ngay trên web, không cần deploy lại. Phức tạp hơn,
cần thêm backend serverless.

**Cần thêm (ngoài Hướng A):**
- **Cloudflare Workers** — API nhận upload, ghi file vào R2, ghi metadata vào DB
  (free 100k request/ngày).
- **Cloudflare D1** (SQLite) hoặc **KV** — lưu danh sách sách thay cho `books.json` tĩnh.
- **Xác thực** để không ai cũng upload được: **Cloudflare Access** (miễn phí ≤50 user)
  hoặc tự làm trang login + mật khẩu.

**Luồng hoạt động:**
```
Trang admin ──(upload PDF)──> Worker ──> lưu file vào R2
                                   └────> ghi metadata vào D1
Trang chủ ──(gọi API)──> Worker ──> đọc danh sách sách từ D1  (thay cho books.json)
```

**Các bước lớn:**
1. Tạo R2 bucket + D1 database (`npx wrangler d1 create ...`).
2. Viết Worker: endpoint `POST /api/upload` (lưu R2 + D1) và `GET /api/books` (trả JSON).
3. Sửa `catalog.js` gọi `GET /api/books` thay vì fetch file tĩnh.
4. Làm trang `admin.html` để chọn & upload PDF.
5. Bật Cloudflare Access bảo vệ `/admin` và `/api/upload`.

### So sánh nhanh

| Hạng mục | Hướng A (thủ công) | Hướng B (tự upload) |
|---|---|---|
| Cloudflare Pages | ✅ | ✅ |
| R2 (lưu file) | ✅ | ✅ |
| Workers (backend) | ❌ | ✅ |
| D1 / KV (database) | ❌ (dùng books.json) | ✅ |
| Xác thực admin | ❌ | ✅ |
| Đổi reader sang PDF.js | ✅ | ✅ |
| Thêm sách không cần deploy lại | ❌ | ✅ |
| Độ khó | Thấp | Trung bình – cao |
| Chi phí | ~$0 | ~$0 (trong free tier) |

**Khuyến nghị:** làm **Hướng A** trước cho nhanh; khi cần nhiều người tự thêm sách thì
nâng lên **Hướng B**.

---

## 9. Ghi chú kỹ thuật

- Reader gắn chặt với format ảnh 4 mảnh của stbook.vn. Khi chuyển sang PDF/ảnh riêng,
  phần cần sửa nhiều nhất là [`site/js/reader.js`](site/js/reader.js) (hàm dựng trang).
- Số trang `pages` trong `books.json` phải chính xác — sai thì trình đọc hiển thị thiếu
  hoặc thừa trang.
- Khi cập nhật CSS/JS, nhớ đổi tham số `?v=...` ở cuối link trong `index.html`/`read.html`
  để tránh trình duyệt cache bản cũ.
