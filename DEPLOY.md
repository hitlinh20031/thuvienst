# Hướng dẫn Deploy Thư viện ST

## Trạng thái hiện tại
- [x] Code website hoàn chỉnh (HTML/CSS/JS)
- [x] Dữ liệu catalog 390 sách (books.json)
- [x] DNS: thuvien.x.org.vn → thuvienst.pages.dev (CNAME đã tạo)
- [ ] Deploy site lên Cloudflare Pages
- [ ] Tạo R2 bucket + upload ảnh
- [ ] Cấu hình custom domain trong Pages

## Bước 1: Tạo Cloudflare API Token

1. Vào https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Custom Token
3. Permissions:
   - Account / Cloudflare Pages / Edit
   - Account / R2 / Edit  
4. Ghi lại token

```bash
export CLOUDFLARE_API_TOKEN="your_token_here"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
```

## Bước 2: Deploy Site lên Cloudflare Pages

```bash
cd /Users/donam/dev/ThuVienST
npx wrangler pages project create thuvienst --production-branch main
npx wrangler pages deploy site --project-name thuvienst
```

## Bước 3: Cấu hình Custom Domain

Vào Cloudflare Dashboard → Pages → thuvienst → Custom domains → Add:
- `thuvien.x.org.vn`
(DNS CNAME đã được tạo sẵn)

## Bước 4: Tạo R2 Bucket

```bash
npx wrangler r2 bucket create thuvienst
```

Cấu hình public access cho bucket:
```bash
npx wrangler r2 bucket sippy enable thuvienst
```

Hoặc vào Dashboard → R2 → thuvienst → Settings → Public Access → Allow

Custom domain cho R2 (tùy chọn): `r2.thuvien.x.org.vn`

Cấu hình CORS:
```json
[
  {
    "AllowedOrigins": ["https://thuvien.x.org.vn", "http://localhost:*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

## Bước 5: Tạo R2 API Token và Upload Ảnh

1. Dashboard → R2 → Manage R2 API Tokens
2. Create Token → Object Read & Write
3. Trên Jupyter server:

```bash
pip install boto3
export R2_ACCOUNT_ID="your_account_id"
export R2_ACCESS_KEY_ID="your_r2_access_key"
export R2_SECRET_ACCESS_KEY="your_r2_secret_key"
python3 /path/to/upload_to_r2.py
```

## Bước 6: Cập nhật IMAGE_BASE

Sau khi R2 bucket có public URL, cập nhật trong:
- `js/catalog.js` dòng 1: `const IMAGE_BASE = '...'`
- `js/reader.js` dòng 1: `const IMAGE_BASE = '...'`

URL format: `https://pub-{bucket_id}.r2.dev` hoặc custom domain

## Cấu trúc files

```
site/
├── index.html          # Trang chủ catalog
├── read.html           # Trang đọc sách (page-flip)
├── css/
│   ├── style.css       # Style chính
│   └── reader.css      # Style reader
├── js/
│   ├── catalog.js      # Logic catalog
│   └── reader.js       # Logic reader + page-flip
├── data/
│   └── books.json      # Catalog 390 sách
└── assets/             # (tùy chọn) favicon, logo
```
