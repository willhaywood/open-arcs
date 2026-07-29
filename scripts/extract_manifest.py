#!/usr/bin/env python3
"""Extract the Arcs image-asset manifest from haunt-roll-fail's arcs/meta.scala.

Reads only the MIT-licensed manifest declarations. Downloads nothing.
"""
import json
import re
import sys
from collections import OrderedDict

SRC = sys.argv[1]
OUT_JSON = sys.argv[2]

GROUP_RE = re.compile(
    r'ConditionalAssetsList\('
    r'\(factions : \$\[F\], options : \$\[O\]\) => (?P<cond>\w+)'
    r'(?:,\s*"(?P<path>[^"]*)")?'
    r'(?:,\s*scale\s*=\s*(?P<scale>[\d.]+))?'
    r'(?:,\s*ext\s*=\s*"(?P<ext>[^"]*)")?'
    r'\)\('
)
ASSET_RE = re.compile(
    r'ImageAsset\('
    r'"(?P<name>[^"]+)"'
    r'(?:\s*,\s*(?:"(?P<filename>[^"]+)"|(?P<ident>\w+)))?'
    r'\)'
    r'(?P<mods>(?:\.scaled\([\d.]+\)|\.makeLossless)*)'
)
SCALED_RE = re.compile(r'\.scaled\(([\d.]+)\)')

# `ImageAsset("map-out-3", easterEgg)` picks one of these at runtime.
EASTER_EGG = ["map-out-3", "map-out-3-betrayal", "map-out-3-catan"]

groups = []
current = None

with open(SRC, encoding="utf-8") as fh:
    lines = fh.readlines()

# The manifest is the `val assets = ...` block.
start = next(i for i, l in enumerate(lines) if re.match(r'\s*val assets\s*=', l))

for line in lines[start:]:
    g = GROUP_RE.search(line)
    if g:
        current = OrderedDict(
            group=g.group("path") or "(root)",
            path=g.group("path") or "",
            condition=g.group("cond"),
            group_scale=float(g.group("scale")) if g.group("scale") else 100.0,
            ext=g.group("ext") or "png",
            assets=[],
        )
        groups.append(current)
        continue

    if current is None:
        continue

    # End of the whole `val assets` block: a group terminator not followed by `::`
    if re.match(r'\s*\$\)\s*$', line):
        break

    a = ASSET_RE.search(line)
    if not a:
        continue

    mods = a.group("mods") or ""
    scaled = SCALED_RE.search(mods)
    name = a.group("name")

    if a.group("ident") == "easterEgg":
        filenames = EASTER_EGG
    else:
        filenames = [a.group("filename") or name]

    for fn in filenames:
        current["assets"].append(OrderedDict(
            id=name,
            filename=fn,
            scale=float(scaled.group(1)) if scaled else current["group_scale"],
            lossless=".makeLossless" in mods,
            src="/".join(filter(None, [current["path"], fn])) + "." + current["ext"],
            url="/hrf/webp2/arcs/images/"
                + "/".join(filter(None, [current["path"], fn])) + ".webp",
        ))

total = sum(len(g["assets"]) for g in groups)
manifest = OrderedDict(
    source="haunt-roll-fail/haunt-roll-fail — haunt-roll-fail/arcs/meta.scala (MIT)",
    extracted="2026-07-22",
    note="Declarations only. No image data has been copied. See assets/README.md.",
    group_count=len(groups),
    asset_count=total,
    groups=groups,
)

with open(OUT_JSON, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")

print(f"groups: {len(groups)}  assets: {total}")
for g in groups:
    print(f"  {g['group']:<10} {len(g['assets']):>4}  scale={g['group_scale']}")
