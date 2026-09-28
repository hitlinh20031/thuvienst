"""
Upload sách backup từ Jupyter server lên Cloudflare R2.

Yêu cầu:
  pip install boto3

Cấu hình R2 API token:
  1. Vào Cloudflare Dashboard > R2 > Manage R2 API Tokens
  2. Tạo token với quyền "Object Read & Write"
  3. Ghi lại Access Key ID, Secret Access Key, Account ID

Sử dụng:
  export R2_ACCOUNT_ID="your_account_id"
  export R2_ACCESS_KEY_ID="your_access_key"
  export R2_SECRET_ACCESS_KEY="your_secret_key"
  python3 upload_to_r2.py
"""

import os
import json
import boto3
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BACKUP_DIR = '/home/ubuntu/stbook_backup'
BUCKET_NAME = 'thuvienst'

ACCOUNT_ID = os.environ['R2_ACCOUNT_ID']
ACCESS_KEY = os.environ['R2_ACCESS_KEY_ID']
SECRET_KEY = os.environ['R2_SECRET_ACCESS_KEY']

ENDPOINT = f'https://{ACCOUNT_ID}.r2.cloudflarestorage.com'

s3 = boto3.client('s3',
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name='auto'
)

def upload_file(local_path, key):
    content_type = 'image/png'
    if key.endswith('.json'):
        content_type = 'application/json'
    try:
        s3.upload_file(str(local_path), BUCKET_NAME, key,
                       ExtraArgs={'ContentType': content_type})
        return True, key
    except Exception as e:
        return False, f'{key}: {e}'

def main():
    with open(f'{BACKUP_DIR}/metadata/all_books.json') as f:
        all_books = json.load(f)

    catalog_path = f'{BACKUP_DIR}/book_catalog_full.json'
    with open(catalog_path) as f:
        catalog = json.load(f)

    valid_uuids = set()
    for book in catalog.get('books', []):
        info_path = Path(BACKUP_DIR) / 'pages' / book['uuid'] / 'info.json'
        if info_path.exists():
            with open(info_path) as f:
                info = json.load(f)
            if info.get('status') == 'complete':
                valid_uuids.add(book['uuid'])

    print(f'Sách hợp lệ: {len(valid_uuids)}')

    tasks = []

    for uuid in valid_uuids:
        cover_dir = Path(BACKUP_DIR) / 'covers' / uuid
        for name in ['cover.clsbi', 'thumb.png']:
            p = cover_dir / name
            if p.exists():
                tasks.append((p, f'covers/{uuid}/{name}'))

        pages_dir = Path(BACKUP_DIR) / 'pages' / uuid
        for png in sorted(pages_dir.glob('page_*.png')):
            tasks.append((png, f'pages/{uuid}/{png.name}'))

    print(f'Tổng file cần upload: {len(tasks)}')

    progress_file = Path(BACKUP_DIR) / 'r2_upload_progress.json'
    uploaded = set()
    if progress_file.exists():
        with open(progress_file) as f:
            uploaded = set(json.load(f))
        print(f'Đã upload trước đó: {len(uploaded)}')

    remaining = [(lp, k) for lp, k in tasks if k not in uploaded]
    print(f'Còn lại: {len(remaining)}')

    success = 0
    fail = 0

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(upload_file, lp, k): k for lp, k in remaining}
        for i, future in enumerate(as_completed(futures)):
            ok, msg = future.result()
            if ok:
                success += 1
                uploaded.add(msg)
            else:
                fail += 1
                print(f'  FAIL: {msg}')

            if (i + 1) % 500 == 0:
                print(f'  Tiến trình: {i+1}/{len(remaining)} (OK: {success}, Fail: {fail})')
                with open(progress_file, 'w') as f:
                    json.dump(sorted(uploaded), f)

    with open(progress_file, 'w') as f:
        json.dump(sorted(uploaded), f)

    print(f'\nHoàn tất! OK: {success}, Fail: {fail}, Tổng: {len(uploaded)}')

if __name__ == '__main__':
    main()
