#!/usr/bin/env python3
"""Snapshot the POS sheet's "Shop Feed" tab into shop/inventory.json.

padq.app/shop reads the published Shop Feed tab live; this snapshot is only
the fallback for when Google can't be reached. Refresh it now and then:

  ~/.claude/gdocs-env/bin/python scripts/sync-shop.py

Shop Feed is formulas only: model, color, price and qty of unsold stock
(paddles in A–D, grips in F–I). Buyer names, dates and installments never
reach it, so nothing private lands in the public JSON. Brand facts and photos
live in shop/index.html, which maps these raw rows.
"""
import json, os, sys
from datetime import datetime, timezone

SHEET_ID = '1uOQwQraDg4DbG6lK_6FswPoM8dwv9sNJKjzejGELkPI'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shop', 'inventory.json')

def main():
    sys.path.insert(0, os.path.expanduser('~/.claude/secrets'))
    import gdocs
    from googleapiclient.discovery import build
    docs, _ = gdocs.svc()
    sh = build('sheets', 'v4', credentials=docs._http.credentials)
    rows = sh.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range="'Shop Feed'!A2:I300",
        valueRenderOption='UNFORMATTED_VALUE').execute().get('values', [])
    pad = lambda r: (r + [''] * 9)[:9]
    data = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='minutes'),
        'paddles': [pad(r)[0:4] for r in rows if str(pad(r)[0]).strip()],
        'grips': [pad(r)[5:9] for r in rows if str(pad(r)[5]).strip()],
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(data['paddles'])} paddle rows, {len(data['grips'])} grip rows")

if __name__ == '__main__':
    main()
