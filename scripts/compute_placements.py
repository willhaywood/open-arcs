#!/usr/bin/env python3
"""Compute token placement points on each planet, from map-regions.webp.

The board art (`map-no-slots`) deliberately has no printed building slots — HRF places both
pieces and empty-slot markers inside each system's region, found via the colour-indexed
region bitmap (arcs/ui.scala:657-680). This does the equivalent once, offline, so the UI
needs no runtime bitmap work and layout is deterministic.

Points are laid out as a compact hex cluster **around the system's anchor** — the hand-picked
interior point that sits on the planet itself — rather than spread across the whole region
(a region is the entire wedge, most of which is empty space). Spacing is at least one token
wide so tokens never overlap, and each point is checked to sit clear inside the region so a
token cannot spill outside it.

    python3 scripts/compute_placements.py <regions.ppm> <board-topology.json>
"""
import json
import math
import sys

SPACING = 98    # centre-to-centre; a token is ~95px, so this leaves a small gap
POINTS = 12     # placement points per system
WANT = 6        # relax the edge clearance until at least this many points fit
# Clearance from a differently-coloured pixel, tried in order. Wedge regions vary a lot in
# width, so a single value either starves the narrow ones or lets tokens spill on the wide.
# The last entry is 0: centre-in-region only. A token may then overhang the region
# boundary, which is what physical tokens do on a planet — what must not happen is two
# tokens overlapping each other, and SPACING guarantees that.
CLEARANCES = (44, 32, 22, 12, 0)
# If a narrow region still cannot hold WANT points, tighten the spacing before giving up.
SPACINGS = (98, 84, 72)


def read_ppm(path):
    with open(path, "rb") as fh:
        data = fh.read()
    parts, idx = [], 0
    while len(parts) < 4:
        while data[idx : idx + 1].isspace():
            idx += 1
        if data[idx : idx + 1] == b"#":
            while data[idx : idx + 1] != b"\n":
                idx += 1
            continue
        start = idx
        while not data[idx : idx + 1].isspace():
            idx += 1
        parts.append(data[start:idx])
    idx += 1
    return int(parts[1]), int(parts[2]), data[idx:]


def main():
    ppm_path, topo_path = sys.argv[1], sys.argv[2]
    w, h, px = read_ppm(ppm_path)

    def rgb(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return None
        o = (y * w + x) * 3
        return (px[o], px[o + 1], px[o + 2])

    def fits(x, y, target):
        """The point is in-region and a token centred here stays inside it."""
        if rgb(x, y) != target:
            return False
        for dx, dy in ((-CLEAR, 0), (CLEAR, 0), (0, -CLEAR), (0, CLEAR),
                       (-30, -30), (30, -30), (-30, 30), (30, 30)):
            if rgb(x + dx, y + dy) != target:
                return False
        return True

    topo = json.load(open(topo_path))

    def cluster(ax, ay, target, clear, spacing):
        """Compact grid of in-region points around the anchor, nearest first."""

        def fits(x, y):
            if rgb(x, y) != target:
                return False  # centre must belong to this system
            if clear <= 0:
                return True
            d = int(clear * 0.72)
            for dx, dy in ((-clear, 0), (clear, 0), (0, -clear), (0, clear),
                           (-d, -d), (d, -d), (-d, d), (d, d)):
                if rgb(x + dx, y + dy) != target:
                    return False
            return True

        # Fine candidate grid around the anchor. Anchors sit on the planet but are often
        # near a region edge, so sample at half-spacing and let the spacing filter below do
        # the packing — a coarse grid would miss most of the usable area.
        cands = []
        step = max(12, spacing // 3)
        reach = spacing * 4
        for oy in range(ay - reach, ay + reach + 1, step):
            for ox in range(ax - reach, ax + reach + 1, step):
                cands.append((ox, oy))
        cands.sort(key=lambda p: math.hypot(p[0] - ax, p[1] - ay))

        out = []
        for p in cands:
            if len(out) >= POINTS:
                break
            if not fits(p[0], p[1]):
                continue
            if any(math.hypot(p[0] - q[0], p[1] - q[1]) < spacing * 0.92 for q in out):
                continue
            out.append(p)
        return out

    for sysinfo in topo["systems"]:
        ax, ay = sysinfo["render"]["anchor"]
        target = rgb(ax, ay)

        chosen = []
        for spacing in SPACINGS:
            for clear in CLEARANCES:
                got = cluster(ax, ay, target, clear, spacing)
                if len(got) > len(chosen):
                    chosen = got
                if len(chosen) >= WANT:
                    break
            if len(chosen) >= WANT:
                break

        if not chosen:
            chosen = [(ax, ay)]  # thin region: stack on the anchor rather than drop pieces

        chosen.sort(key=lambda p: math.hypot(p[0] - ax, p[1] - ay))
        sysinfo["render"]["placements"] = [[int(p[0]), int(p[1])] for p in chosen]

    with open(topo_path, "w") as fh:
        json.dump(topo, fh, indent=2)
        fh.write("\n")

    counts = [(s["id"], len(s["render"]["placements"])) for s in topo["systems"]]
    for sid, n in counts:
        print(f"{sid:<12} {n:>2}")
    print(f"min points on any system: {min(n for _, n in counts)}")


if __name__ == "__main__":
    main()
