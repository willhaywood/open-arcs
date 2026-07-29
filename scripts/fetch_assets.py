#!/usr/bin/env python3
"""Fetch Arcs image assets listed in assets/manifest.json for LOCAL PERSONAL USE.

These images are Leder Games / Kyle Ferrin artwork. They are not licensed for
redistribution. Nothing fetched here may be committed, published or uploaded.
See assets/README.md.

Polite by design: low concurrency, per-request delay, resumable, skips existing files.

    python3 scripts/fetch_assets.py [--limit N] [--group NAME]
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HOST = "https://hrf.im"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "assets", "manifest.json")
OUTDIR = os.path.join(ROOT, "assets", "images")

CONCURRENCY = 4
DELAY = 0.12          # seconds between request starts, per worker
TIMEOUT = 30
UA = "arcs-local-hobby-project/0.1 (personal use; single pass)"

lock = threading.Lock()
stats = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0}
failures = []


def target_path(url: str) -> str:
    rel = url.replace("/hrf/webp2/arcs/images/", "")
    return os.path.join(OUTDIR, rel)


def fetch(asset: dict) -> None:
    dest = target_path(asset["url"])

    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock:
            stats["skip"] += 1
        return

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    time.sleep(DELAY)

    req = urllib.request.Request(HOST + asset["url"], headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        with lock:
            stats["fail"] += 1
            failures.append((asset["url"], str(e)))
        return

    # Guard against error pages saved with an image extension.
    if not ctype.startswith("image/") or len(data) < 64:
        with lock:
            stats["fail"] += 1
            failures.append((asset["url"], f"unexpected {ctype} / {len(data)} bytes"))
        return

    tmp = dest + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, dest)

    with lock:
        stats["ok"] += 1
        stats["bytes"] += len(data)
        done = stats["ok"] + stats["skip"] + stats["fail"]
        if done % 50 == 0:
            print(f"  {done} processed  ({stats['bytes'] / 1e6:.1f} MB)", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--group")
    args = ap.parse_args()

    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)

    assets = [
        a
        for g in manifest["groups"]
        if not args.group or g["group"] == args.group
        for a in g["assets"]
    ]
    # De-duplicate: a few ids share a filename.
    seen, unique = set(), []
    for a in assets:
        if a["url"] not in seen:
            seen.add(a["url"])
            unique.append(a)
    if args.limit:
        unique = unique[: args.limit]

    print(f"{len(unique)} assets -> {OUTDIR}")
    print(f"concurrency {CONCURRENCY}, {DELAY}s delay per request\n")

    started = time.time()
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list(pool.map(fetch, unique))
    elapsed = time.time() - started

    print(
        f"\ndone in {elapsed:.0f}s — "
        f"{stats['ok']} fetched, {stats['skip']} already present, {stats['fail']} failed, "
        f"{stats['bytes'] / 1e6:.1f} MB"
    )
    if failures:
        print("\nfailures:")
        for url, err in failures[:25]:
            print(f"  {url}  {err}")
        if len(failures) > 25:
            print(f"  ... and {len(failures) - 25} more")
    return 1 if stats["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
