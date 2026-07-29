#!/usr/bin/env python3
"""Build packages/engine/src/data/board-topology.json from HRF's Scala sources + the decoded region bitmaps.

Rules data (adjacency, resources, slots, board variants) is transcribed from
haunt-roll-fail/arcs/game.scala and game-base.scala (MIT).
Region colours come from analyzing assets/images/map-regions*.webp.

    python3 scripts/build_board_topology.py <region-analysis.json> packages/engine/src/data/board-topology.json
"""
import json
import sys

SYMBOLS = ["Gate", "Arrow", "Crescent", "Hex"]

# arcs/ui.scala:422-448 — a point known to lie inside each region (not the centroid).
CENTERS = {
    (1, "Gate"): (1300, 550), (1, "Arrow"): (1050, 360), (1, "Crescent"): (1320, 130), (1, "Hex"): (1630, 400),
    (2, "Gate"): (1630, 780), (2, "Arrow"): (1810, 580), (2, "Crescent"): (1920, 730), (2, "Hex"): (1900, 900),
    (3, "Gate"): (1590, 1110), (3, "Arrow"): (1860, 1060), (3, "Crescent"): (2110, 1420), (3, "Hex"): (1670, 1370),
    (4, "Gate"): (1170, 1260), (4, "Arrow"): (1350, 1660), (4, "Crescent"): (940, 1700), (4, "Hex"): (570, 1630),
    (5, "Gate"): (870, 990), (5, "Arrow"): (640, 1230), (5, "Crescent"): (240, 1160), (5, "Hex"): (530, 900),
    (6, "Gate"): (910, 690), (6, "Arrow"): (630, 730), (6, "Crescent"): (630, 520), (6, "Hex"): (830, 450),
    (7, "Gate"): (1250, 894),
}

# arcs/ui.scala:450-469 — where the gate-link marker is drawn. 18 entries, one per
# non-gate system, matching the 18 map-broken-gate-N-{arrow,crescent,hex} assets.
GATE_MARKERS = {
    (1, "Arrow"): [(1049, 223), (1166, 170)], (1, "Crescent"): [(1434, 212)], (1, "Hex"): [(1745, 147), (1846, 228)],
    (2, "Arrow"): [(2010, 440)], (2, "Crescent"): [(2300, 618)], (2, "Hex"): [(2116, 880), (2221, 936)],
    (3, "Arrow"): [(2186, 1127)], (3, "Crescent"): [(1846, 1249)], (3, "Hex"): [(1929, 1534), (1830, 1610)],
    (4, "Arrow"): [(1529, 1573), (1430, 1497)], (4, "Crescent"): [(1060, 1584), (1159, 1660)], (4, "Hex"): [(776, 1505)],
    (5, "Arrow"): [(255, 1458)], (5, "Crescent"): [(434, 1101)], (5, "Hex"): [(223, 876), (125, 952)],
    (6, "Arrow"): [(431, 683)], (6, "Crescent"): [(397, 313), (299, 389)], (6, "Hex"): [(678, 228)],
}

# arcs/game.scala:538-557
RESOURCE = {
    (1, "Arrow"): "Weapon", (1, "Crescent"): "Fuel", (1, "Hex"): "Material",
    (2, "Arrow"): "Psionic", (2, "Crescent"): "Weapon", (2, "Hex"): "Relic",
    (3, "Arrow"): "Material", (3, "Crescent"): "Fuel", (3, "Hex"): "Weapon",
    (4, "Arrow"): "Relic", (4, "Crescent"): "Fuel", (4, "Hex"): "Material",
    (5, "Arrow"): "Weapon", (5, "Crescent"): "Relic", (5, "Hex"): "Psionic",
    (6, "Arrow"): "Material", (6, "Crescent"): "Fuel", (6, "Hex"): "Psionic",
}

# arcs/game.scala:516-536 — building slots. Gates always 0.
SLOTS = {
    (1, "Arrow"): 2, (1, "Crescent"): 1, (1, "Hex"): 2,
    (2, "Arrow"): 1, (2, "Crescent"): 1, (2, "Hex"): 2,
    (3, "Arrow"): 1, (3, "Crescent"): 1, (3, "Hex"): 2,
    (4, "Arrow"): 2, (4, "Crescent"): 2, (4, "Hex"): 1,
    (5, "Arrow"): 1, (5, "Crescent"): 1, (5, "Hex"): 2,
    (6, "Arrow"): 1, (6, "Crescent"): 2, (6, "Hex"): 1,
}

# (city, starport, [fleet systems]) per seat.
#
# The five HRF implements come from arcs/game-base.scala + game-blight.scala. HRF stops there —
# its SetupCardOption is limited to 3-4 players and offers only those five (meta.scala:288-289) —
# but the printed game has four setups per player count. The three below are the remaining 3p/4p
# ones, ported from the arcs_tts mod, which carries the whole deck as data:
#
#   out-of-play clusters   src/BaseGame.lua, BaseGame.chooseSetupCard
#   starting positions     src/Global.lua, starting_locations[<card>_GUID][seat][A..D]
#
# The mod stores each seat's placements by the letters printed on the physical card, and what
# goes on each letter comes from starting_pieces (src/Global.lua): A = city + 3 ships,
# B = starport + 3 ships, C/D = 2 ships. Its system letters are a/b/c = Arrow/Crescent/Hex.
#
# That reading was checked against the five boards HRF does define: 16 of their 17 seats match
# the mod exactly, systems, gates and all. The one exception is Board3MixUp seat 2, where the two
# sources disagree about which of 2-Arrow and 5-Hex takes the city — see docs/05. HRF's version is
# kept there; that seat is the only known disagreement between the references.
BOARDS = {
    "Board3MixUp":       dict(players=3, clusters=[2, 3, 5, 6],
                              starting=[[[3, "Hex"], [5, "Crescent"], [[2, "Gate"]]],
                                        [[2, "Arrow"], [5, "Hex"], [[3, "Gate"]]],
                                        [[2, "Hex"], [3, "Arrow"], [[5, "Gate"]]]]),
    "Board3Frontiers":   dict(players=3, clusters=[1, 4, 5, 6],
                              starting=[[[1, "Hex"], [4, "Hex"], [[6, "Gate"]]],
                                        [[5, "Hex"], [1, "Crescent"], [[5, "Gate"]]],
                                        [[4, "Crescent"], [6, "Arrow"], [[1, "Gate"]]]]),
    "Board3CoreConflict": dict(players=3, clusters=[1, 2, 4, 5],
                              starting=[[[1, "Hex"], [2, "Crescent"], [[1, "Gate"]]],
                                        [[2, "Hex"], [1, "Crescent"], [[2, "Gate"]]],
                                        [[1, "Arrow"], [2, "Arrow"], [[4, "Gate"]]]]),
    # arcs_tts: homelands_3P, out of play {5, 6}
    "Board3Homelands":   dict(players=3, clusters=[1, 2, 3, 4],
                              starting=[[[2, "Hex"], [3, "Crescent"], [[3, "Gate"]]],
                                        [[1, "Hex"], [2, "Arrow"], [[2, "Gate"]]],
                                        [[1, "Arrow"], [4, "Hex"], [[4, "Gate"]]]]),
    "Board4MixUp1":      dict(players=4, clusters=[1, 2, 4, 5, 6],
                              starting=[[[4, "Arrow"], [6, "Hex"], [[1, "Gate"]]],
                                        [[4, "Hex"], [5, "Hex"], [[6, "Gate"]]],
                                        [[5, "Arrow"], [1, "Hex"], [[4, "Gate"]]],
                                        [[6, "Arrow"], [1, "Arrow"], [[5, "Gate"]]]]),
    "Board4MixUp2":      dict(players=4, clusters=[1, 2, 3, 5, 6],
                              starting=[[[5, "Hex"], [3, "Arrow"], [[2, "Gate"]]],
                                        [[3, "Hex"], [5, "Crescent"], [[1, "Gate"]]],
                                        [[2, "Hex"], [1, "Hex"], [[3, "Gate"]]],
                                        [[1, "Arrow"], [2, "Arrow"], [[5, "Gate"]]]]),
    # arcs_tts: frontiers_4P, out of play {5}
    "Board4Frontiers":   dict(players=4, clusters=[1, 2, 3, 4, 6],
                              starting=[[[1, "Hex"], [3, "Crescent"], [[2, "Gate"]]],
                                        [[2, "Hex"], [6, "Hex"], [[3, "Gate"]]],
                                        [[4, "Crescent"], [2, "Arrow"], [[6, "Gate"]]],
                                        [[1, "Arrow"], [6, "Arrow"], [[4, "Gate"]]]]),
    # arcs_tts: mix_up_3_4P, out of play {6}
    "Board4MixUp3":      dict(players=4, clusters=[1, 2, 3, 4, 5],
                              starting=[[[3, "Hex"], [5, "Crescent"], [[1, "Gate"]]],
                                        [[1, "Arrow"], [3, "Arrow"], [[2, "Gate"]]],
                                        [[1, "Hex"], [4, "Hex"], [[3, "Gate"]]],
                                        [[4, "Arrow"], [2, "Crescent"], [[5, "Gate"]]]]),
    "BoardFull":         dict(players=0, clusters=[1, 2, 3, 4, 5, 6], starting=[], campaign_only=True),
}


def sid(cluster, symbol):
    return f"{cluster}-{symbol}"


def ring(clusters, i, step):
    """arcs/game.scala:500-514 — next/prev cluster, skipping those out of play."""
    n = i
    for _ in range(6):
        n = ((n + step) - 1) % 6 + 1
        if n in clusters:
            return n
    return i


def adjacency(clusters):
    """arcs/game.scala:561-566."""
    adj = {}
    for i in clusters:
        adj[sid(i, "Gate")] = [
            sid(ring(clusters, i, 1), "Gate"), sid(ring(clusters, i, -1), "Gate"),
            sid(i, "Arrow"), sid(i, "Crescent"), sid(i, "Hex"),
        ]
        adj[sid(i, "Crescent")] = [sid(i, "Gate"), sid(i, "Arrow"), sid(i, "Hex")]

        arrow = [sid(i, "Gate"), sid(i, "Crescent")]
        if i == 6 and 5 in clusters:
            arrow.append(sid(5, "Hex"))
        if i == 3 and 2 in clusters:
            arrow.append(sid(2, "Hex"))
        adj[sid(i, "Arrow")] = arrow

        hexa = [sid(i, "Gate"), sid(i, "Crescent")]
        if i == 5 and 6 in clusters:
            hexa.append(sid(6, "Arrow"))
        if i == 2 and 3 in clusters:
            hexa.append(sid(3, "Arrow"))
        adj[sid(i, "Hex")] = hexa
    return {k: sorted(set(v)) for k, v in adj.items()}


def main():
    with open(sys.argv[1]) as fh:
        analysis = json.load(fh)
    colours = {
        img["image"]: {r["system"]: r for r in img["systems"]} for img in analysis
    }

    systems = []
    for cluster in range(1, 8):
        for symbol in SYMBOLS:
            key = (cluster, symbol)
            if key not in CENTERS:
                continue
            name = sid(cluster, symbol)
            place = colours["map-regions"].get(name, {})
            select = colours["map-regions-select"].get(name, {})
            systems.append({
                "id": name,
                "cluster": cluster,
                "symbol": symbol,
                "isGate": symbol == "Gate",
                "resource": RESOURCE.get(key),
                "buildingSlots": 0 if symbol == "Gate" else SLOTS.get(key),
                "fateOnly": cluster == 7,
                "render": {
                    "anchor": list(CENTERS[key]),
                    "gateMarkers": GATE_MARKERS.get(key, []),
                    "regionColour": place.get("hex"),
                    "selectColour": select.get("hex"),
                    "regionCentroid": place.get("centroid"),
                    "regionBBox": place.get("bbox"),
                },
            })

    full_adj = adjacency([1, 2, 3, 4, 5, 6])

    # Symmetry check — adjacency must be bidirectional.
    asymmetric = [
        (a, b) for a, bs in full_adj.items() for b in bs if a not in full_adj.get(b, [])
    ]

    boards = {}
    for bname, b in BOARDS.items():
        boards[bname] = dict(b)
        boards[bname]["adjacency"] = adjacency(b["clusters"])

    out = {
        "source": "haunt-roll-fail (MIT) — arcs/game.scala, arcs/game-base.scala, arcs/ui.scala; "
                  "region colours decoded from map-regions*.webp",
        "generated": "2026-07-22",
        "mapSize": {"width": 2528, "height": 1776},
        "symbols": SYMBOLS,
        "resources": ["Material", "Fuel", "Weapon", "Relic", "Psionic"],
        "systems": systems,
        "adjacencyFullBoard": full_adj,
        "adjacencySymmetric": not asymmetric,
        "boards": boards,
    }

    with open(sys.argv[2], "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"systems: {len(systems)} ({sum(1 for s in systems if s['fateOnly'])} fate-only)")
    print(f"adjacency symmetric: {not asymmetric}" + (f"  !! {asymmetric}" if asymmetric else ""))
    print(f"boards: {', '.join(boards)}")
    for bname, b in boards.items():
        print(f"  {bname:<20} {b['players'] or '-'}p  {len(b['clusters'])} clusters  "
              f"{len(b['clusters']) * 4} systems")
    missing = [s["id"] for s in systems if not s["render"]["regionColour"]]
    print(f"systems missing a region colour: {missing or 'none'}")


if __name__ == "__main__":
    main()
