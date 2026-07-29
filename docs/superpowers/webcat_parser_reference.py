#!/usr/bin/env python3
"""
McKesson WEBCAT reference parser — VALIDATED against a real 26 MB catalogue
(65,402 records / 52,741 products, July 2026).

This is the ground-truth implementation. Port it to TypeScript for the Electron
main process; keep the offsets identical. Every offset here was verified —
see mckesson-webcat-format.md for the evidence behind each field.

Usage:
    python3 webcat_parser_reference.py /path/to/WEBCAT [--json out.jsonl]
"""

import sys, json, argparse
from collections import Counter

RECORD_LEN = 396


# ---------------------------------------------------------------- helpers

def gtin_is_valid(s: str) -> bool:
    """Standard GTIN mod-10 check digit. Works for GTIN-8/12/13/14."""
    if not s or not s.isdigit():
        return False
    if len(s) not in (8, 12, 13, 14):
        return False
    if s.strip("0") == "":          # all zeros == empty field, not a barcode
        return False
    digits = [int(c) for c in s]
    check, body = digits[-1], digits[:-1][::-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return (10 - total % 10) % 10 == check


def gtin_norm(s):
    """Scanners emit 12-13 digits; the file stores 14. Normalize for matching."""
    if not s:
        return None
    n = s.lstrip("0")
    return n or None


def num(s: str) -> int:
    s = s.strip()
    return int(s) if s.isdigit() else 0


def opt(s: str):
    """Trimmed string, or None if blank."""
    s = s.strip()
    return s or None


def opt_zero(s: str):
    """Trimmed string, or None if blank OR all zeros (e.g. an absent DIN)."""
    s = s.strip()
    return s if s and s.strip("0") else None


# ---------------------------------------------------------------- records
# NOTE: slices below are 0-based Python; the spec doc uses 1-based positions.
# Python r[a:b]  ==  spec positions (a+1) through b.

def parse_product(r: str) -> dict:
    gp, gc = r[354:368], r[382:396]
    gp = gp if gtin_is_valid(gp) else None
    gc = gc if gtin_is_valid(gc) else None
    return {
        "itemNumber":      r[1:7],                    # pos 2-7    unique key
        "description":     r[7:57].strip(),           # pos 8-57   raw ALL-CAPS
        "effectiveDate":   opt_zero(r[57:65]),        # pos 58-65  YYYYMMDD
        "categoryCode":    opt_zero(r[89:94]),        # pos 90-94
        "din":             opt_zero(r[126:134]),      # pos 127-134
        "packSize":        num(r[143:149]) or None,   # pos 144-149
        "province":        r[149:152].strip(),        # pos 150-152 ONT|QUE
        "strength":        opt(r[152:162]),           # pos 153-162
        "dosageForm":      opt(r[162:177]),           # pos 163-177
        "genericCode":     opt_zero(r[177:183]),      # pos 178-183
        "genericName":     opt(r[183:213]),           # pos 184-213
        "mfrPartNumber":   opt_zero(r[213:228]),      # pos 214-228
        "flagA":           r[229],                    # pos 230
        "flagB":           r[230],                    # pos 231
        "deptCode":        opt(r[231:234]),           # pos 232-234
        "vendorCode":      opt(r[234:237]),           # pos 235-237
        "listPriceCents":  num(r[331:338]),           # pos 332-338  INTEGER CENTS
        "costPriceCents":  num(r[338:345]),           # pos 339-345  INTEGER CENTS
        "uomGroup":        opt(r[351]),               # pos 352
        "uomType":         opt(r[352]),               # pos 353
        "gtinPrimary":     gp,                        # pos 355-368
        "gtinPrimaryNorm": gtin_norm(gp),
        "gtinCase":        gc,                        # pos 383-396
        "gtinCaseNorm":    gtin_norm(gc),
    }


def parse_deal(r: str) -> dict:
    return {
        "itemNumber":     r[1:7],                     # pos 2-7   FK -> product
        "dealType":       r[7:10].strip(),            # pos 8-10
        "dealNumber":     r[10:15].strip(),           # pos 11-15
        "date1":          opt_zero(r[15:23]),         # pos 16-23
        "date2":          opt_zero(r[23:31]),         # pos 24-31
        "date3":          opt_zero(r[31:39]),         # pos 32-39
        "date4":          opt_zero(r[39:47]),         # pos 40-47
        "allowanceCents": num(r[68:75]),              # pos 69-75
        "dealPriceCents": num(r[75:82]),              # pos 76-82
        "tierFlag":       r[94] if len(r) > 94 else None,   # pos 95
    }


# ---------------------------------------------------------------- driver

def parse_file(path):
    products, deals, rejects = [], [], []
    # latin-1, NOT utf-8 — a strict utf-8 decode will abort on a stray high byte
    with open(path, "r", encoding="latin-1") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.rstrip("\r\n")
            if len(line) != RECORD_LEN:
                rejects.append((lineno, f"bad length {len(line)}, expected {RECORD_LEN}"))
                continue
            kind = line[0]
            if kind == "P":
                products.append(parse_product(line))
            elif kind == "S":
                deals.append(parse_deal(line))
            else:
                rejects.append((lineno, f"unknown record type {kind!r}"))
    return products, deals, rejects


def report(products, deals, rejects):
    p, d = len(products), len(deals)
    print(f"products            : {p:,}")
    print(f"deals               : {d:,}")
    print(f"rejected lines      : {len(rejects):,}")
    print()
    ids = Counter(x["itemNumber"] for x in products)
    print(f"unique item numbers : {len(ids):,}  (duplicates: {sum(1 for v in ids.values() if v > 1)})")
    print(f"valid primary GTIN  : {sum(1 for x in products if x['gtinPrimary']):,}")
    print(f"valid case GTIN     : {sum(1 for x in products if x['gtinCase']):,}")
    print(f"with DIN (drugs)    : {sum(1 for x in products if x['din']):,}")
    print(f"cost > 0            : {sum(1 for x in products if x['costPriceCents'] > 0):,}")
    print(f"list > 0            : {sum(1 for x in products if x['listPriceCents'] > 0):,}")
    print(f"blank descriptions  : {sum(1 for x in products if not x['description']):,}")
    print()
    prov = Counter(x["province"] for x in products)
    print("province split      :", dict(prov))
    # data anomalies worth flagging in the import preview
    zero_cost = sum(1 for x in products if x["costPriceCents"] == 0)
    inverted  = sum(1 for x in products
                    if 0 < x["listPriceCents"] < x["costPriceCents"])
    print(f"zero-cost items     : {zero_cost:,}   (do NOT feed these to the tier engine)")
    print(f"list < cost anomaly : {inverted:,}")
    orphans = {x["itemNumber"] for x in deals} - {x["itemNumber"] for x in products}
    print(f"orphan deals        : {len(orphans):,}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--json", help="write products as JSONL to this path")
    a = ap.parse_args()

    products, deals, rejects = parse_file(a.path)
    report(products, deals, rejects)

    if rejects:
        print("\nfirst rejects:")
        for lineno, why in rejects[:10]:
            print(f"  line {lineno}: {why}")

    if a.json:
        with open(a.json, "w", encoding="utf-8") as out:
            for prod in products:
                out.write(json.dumps(prod, ensure_ascii=False) + "\n")
        print(f"\nwrote {len(products):,} products -> {a.json}")


if __name__ == "__main__":
    main()
