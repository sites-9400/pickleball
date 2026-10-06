#!/usr/bin/env python3
"""Rebuild shop/inventory.json from the POS Google Sheet.

Run:  ~/.claude/gdocs-env/bin/python scripts/sync-shop.py
Then commit shop/inventory.json and push; Pages redeploys padq.app/shop.

Reads two tabs:
  POS          paddles, one row per unit; a row is in stock until AVAILABILITY
               says SOLD OUT
  POS - Grips  grips, one row per colorway with an Available Stock count

Only names, prices and stock counts leave the sheet. Buyer names, sale dates
and installment details never go into the JSON (the site is public).
Photos come from the brand stores and live in shop/img/; an item without a
known photo still lists, with a placeholder, and is reported below.
"""
import json, os, re, sys
from datetime import datetime, timezone

SHEET_ID = '1uOQwQraDg4DbG6lK_6FswPoM8dwv9sNJKjzejGELkPI'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shop', 'inventory.json')
IMG = os.path.join(ROOT, 'shop', 'img')

# Brand facts per paddle model, keyed by the sheet's PADDLE column (normalized).
PADDLES = {
    'loco': {
        'brand': 'Bread & Butter', 'model': 'The Loco 16mm Hybrid', 'img': 'loco-hybrid',
        'source': 'https://www.bnbpickleball.com/products/loco-16mm-pickleball-paddle-hybrid',
        'blurb': 'Elongated reach with standard-shape touch. Plush, controlled feel with just enough pop.',
        'specs': ['16mm dual-density foam core', 'T700 raw carbon face', '7.9–8.1 oz', '16.2" × 7.6"', '5.3" handle', 'USAP approved'],
    },
    'kamito dominus': {
        'brand': 'Kamito', 'model': 'Dominus', 'img': 'kamito-dominus',
        'source': 'https://kamito.vn/pages/vot-pickleball-dominus',
        'blurb': 'Built with PPA pro Alix Truong. Speed, control and spin in a light frame.',
        'specs': ['3-layer Japanese Toray carbon face', 'Rough textured surface for spin', 'EVA foam core', '~8.4 oz'],
    },
}

GRIPS = {
    'doughy grips': {
        'line': 'Doughy Grips', 'feel': 'Soft & tacky', 'img': 'doughy',
        'source': 'https://cookiegrips.com/products/doughy-grips',
        'blurb': 'Cushioned 0.65mm overgrip. Soft, tacky hold that eases hand fatigue.',
    },
    'tough cookie': {
        'line': 'Tough Cookie', 'feel': 'Dry · for sweaty hands', 'img': 'tough-cookie',
        'source': 'https://cookiegrips.com/products/tough-cookie',
        'blurb': 'Textured 0.60mm dry overgrip that stays grippy when your hands sweat.',
    },
}
# Sheet spellings that differ from the brand's flavor name.
FLAVOR_FIX = {'frosted cumb monster': 'Frosted Crumb Monster'}

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def peso(s):
    n = re.sub(r'[^0-9.]', '', s or '')
    return round(float(n)) if n else None

def cell(row, i):
    return row[i].strip() if i < len(row) else ''

def model_key(name, table):
    n = re.sub(r'\s+', ' ', name.lower()).strip()
    return next((k for k in table if n.startswith(k)), None)

def photo(base, color):
    name = f'{base}-{slug(color)}.jpg'
    return f'img/{name}' if os.path.exists(os.path.join(IMG, name)) else None

def read_sheet():
    sys.path.insert(0, os.path.expanduser('~/.claude/secrets'))
    import gdocs
    from googleapiclient.discovery import build
    docs, _ = gdocs.svc()
    sh = build('sheets', 'v4', credentials=docs._http.credentials)
    get = lambda tab: sh.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=f"'{tab}'").execute().get('values', [])
    return get('POS'), get('POS - Grips')

def build_paddles(rows, missing):
    stock = {}
    for row in rows[1:]:
        name, color = cell(row, 0), cell(row, 1)
        if not name:
            break  # totals and the installment ledger follow the first blank row
        if cell(row, 4).upper() == 'SOLD OUT':
            continue
        key = model_key(name, PADDLES)
        price = peso(cell(row, 3))
        color = re.sub(r'\s*/\s*', ' / ', color.replace("/'", '/')).strip()
        if not key or price is None:
            missing.append(f'paddle not in catalog: {name} {color}')
            continue
        qty = int(peso(cell(row, 2)) or 1)
        item = stock.setdefault((key, color), {'key': key, 'color': color, 'price': price, 'qty': 0})
        item['qty'] += qty
        item['price'] = min(item['price'], price)
    out = []
    for item in stock.values():
        meta = dict(PADDLES[item['key']])
        color = item['color']
        if item['key'] == 'loco':
            # LOCO rows read "Hybrid Black" / "Elongated Tan": shape goes in the model name.
            shape, _, color = color.partition(' ')
            if shape.lower() == 'elongated':
                meta.update(model='The Loco 16mm Elongated', img='loco-elongated',
                            source=meta['source'].replace('hybrid', 'elongated'),
                            blurb='Max reach and leverage for power from the baseline.')
        img = photo(meta['img'], color.split(' / ')[0])
        if not img:
            missing.append(f'no photo: {meta["model"]} {color}')
        out.append({'brand': meta['brand'], 'model': meta['model'], 'color': color,
                    'price': item['price'], 'qty': item['qty'], 'img': img,
                    'blurb': meta['blurb'], 'specs': meta['specs'], 'source': meta['source']})
    return sorted(out, key=lambda p: (-p['price'], p['model'], p['color']))

def build_grips(rows, missing):
    head = next(i for i, r in enumerate(rows) if cell(r, 1) == 'Model')
    lines = {}
    for row in rows[head + 1:]:
        model = cell(row, 1)
        if not model or model.lower() == 'total':
            break
        key = model_key(model, GRIPS)
        m = re.match(r'(.+?)\s*\((.+)\)\s*$', cell(row, 2))
        if not key or not m:
            missing.append(f'grip not in catalog: {model} {cell(row, 2)}')
            continue
        flavor = FLAVOR_FIX.get(m.group(1).strip().lower(), m.group(1).strip())
        meta = GRIPS[key]
        img = photo(meta['img'], flavor)
        if not img:
            missing.append(f'no photo: {meta["line"]} {flavor}')
        line = lines.setdefault(key, {'line': meta['line'], 'brand': 'cookiegrips', 'feel': meta['feel'],
                                      'blurb': meta['blurb'], 'source': meta['source'], 'colors': []})
        line['colors'].append({'flavor': flavor, 'color': m.group(2).strip(),
                               'price': peso(cell(row, 3)), 'qty': int(peso(cell(row, 6)) or 0), 'img': img})
    return list(lines.values())

def main():
    pos, grips = read_sheet()
    missing = []
    data = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='minutes'),
        'paddles': build_paddles(pos, missing),
        'grips': build_grips(grips, missing),
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}')
    for p in data['paddles']:
        print(f"  paddle  {p['model']:22} {p['color']:28} ₱{p['price']:>6,}  x{p['qty']}")
    for g in data['grips']:
        print(f"  grips   {g['line']:22} {sum(c['qty'] for c in g['colors'])} in stock across {len(g['colors'])} colors")
    for m in missing:
        print('  WARNING', m)

if __name__ == '__main__':
    main()
