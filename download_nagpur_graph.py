"""
Phase 4 - Step 4.1 : Road Network Graph Download
=================================================
Downloads the drivable road network for Nagpur, Maharashtra from
OpenStreetMap using OSMnx and saves it as a GraphML file that can
be loaded by the safety-first routing algorithm in later steps.

Usage:
    python download_nagpur_graph.py

Output:
    data/nagpur_road_network.graphml   <- main output used by the router
    data/nagpur_road_network_stats.json <- graph statistics for reference

Requirements:
    pip install osmnx
"""

import os
import json
import time
import sys

# ── 1. Verify OSMnx is available ─────────────────────────────────────────────
try:
    import osmnx as ox
    print(f"[OK] OSMnx version: {ox.__version__}")
except ImportError:
    print("[ERROR] OSMnx is not installed.")
    print("        Run:  pip install osmnx")
    sys.exit(1)

# ── 2. Configuration ──────────────────────────────────────────────────────────
# Nagpur city, Maharashtra -- centre approx. 21.1458 N, 79.0882 E
PLACE_NAME   = "Nagpur, Maharashtra, India"
NETWORK_TYPE = "drive"          # only roads cars can use (no footpaths)
OUTPUT_DIR   = os.path.join(os.path.dirname(__file__), "data")
GRAPHML_FILE = os.path.join(OUTPUT_DIR, "nagpur_road_network.graphml")
STATS_FILE   = os.path.join(OUTPUT_DIR, "nagpur_road_network_stats.json")

# OSMnx settings — useful tags for safety scoring later
USEFUL_TAGS_WAY = [
    "maxspeed",        # posted speed limit
    "lanes",           # number of lanes
    "highway",         # road classification (primary, secondary, residential...)
    "name",            # street name
    "surface",         # road surface quality
    "lit",             # street lighting (yes/no)
    "oneway",          # one-way traffic
    "junction",        # roundabout / T-junction etc.
    "bridge",          # elevated road flag
    "tunnel",          # underground road flag
    "access",          # access restrictions
]

# ── 3. Apply OSMnx global settings ───────────────────────────────────────────
ox.settings.log_console   = True          # print OSMnx progress logs
ox.settings.use_cache     = True          # cache raw OSM responses locally
ox.settings.useful_tags_way = USEFUL_TAGS_WAY

# ── 4. Create output directory ────────────────────────────────────────────────
os.makedirs(OUTPUT_DIR, exist_ok=True)
print(f"[OK] Output directory: {OUTPUT_DIR}")

# ── 5. Download the road network ──────────────────────────────────────────────
print(f"\n[INFO] Downloading road network for: '{PLACE_NAME}'")
print(f"[INFO] Network type : {NETWORK_TYPE}")
print("[INFO] This may take 30-120 seconds depending on your connection...\n")

start_time = time.time()

try:
    G = ox.graph_from_place(
        PLACE_NAME,
        network_type  = NETWORK_TYPE,
        retain_all    = False,       # drop isolated nodes
        simplify      = True,        # merge redundant intermediate nodes
    )
except Exception as e:
    print(f"[ERROR] Failed to download graph: {e}")
    print("\nTroubleshooting tips:")
    print("  - Check your internet connection.")
    print("  - Verify the place name is recognised by OpenStreetMap.")
    print("  - Try increasing the timeout: ox.settings.timeout = 180")
    sys.exit(1)

elapsed = round(time.time() - start_time, 1)
print(f"\n[OK] Graph downloaded in {elapsed}s")

# ── 6. Add edge speeds and travel times (needed for routing) ──────────────────
print("[INFO] Adding speed / travel-time attributes to edges...")
G = ox.add_edge_speeds(G)       # fills missing maxspeed from OSM highway type defaults
G = ox.add_edge_travel_times(G) # length / speed -> travel_time (seconds)

# ── 7. Save as GraphML ────────────────────────────────────────────────────────
print(f"[INFO] Saving GraphML -> {GRAPHML_FILE}")
ox.save_graphml(G, filepath=GRAPHML_FILE)
file_size_mb = os.path.getsize(GRAPHML_FILE) / (1024 * 1024)
print(f"[OK] Saved ({file_size_mb:.2f} MB)")

# ── 8. Compute and save graph statistics ──────────────────────────────────────
print("[INFO] Computing graph statistics...")

stats = ox.basic_stats(G)

# Add our own metadata on top of OSMnx basic stats
stats["place"]        = PLACE_NAME
stats["network_type"] = NETWORK_TYPE
stats["osmnx_version"]= ox.__version__
stats["graphml_file"] = GRAPHML_FILE
stats["file_size_mb"] = round(file_size_mb, 3)
stats["download_time_seconds"] = elapsed

# OSMnx returns numpy types; cast to plain Python for JSON serialisation
def _to_python(obj):
    """Recursively convert numpy / special types to JSON-serialisable Python."""
    import numpy as np
    if isinstance(obj, (np.integer,)):      return int(obj)
    if isinstance(obj, (np.floating,)):     return float(obj)
    if isinstance(obj, (np.ndarray,)):      return obj.tolist()
    if isinstance(obj, dict):              return {k: _to_python(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):     return [_to_python(i) for i in obj]
    return obj

stats_clean = _to_python(stats)

with open(STATS_FILE, "w", encoding="utf-8") as fh:
    json.dump(stats_clean, fh, indent=2)

print(f"[OK] Stats saved -> {STATS_FILE}")

# ── 9. Print human-readable summary ──────────────────────────────────────────
print("\n" + "=" * 55)
print("  NAGPUR ROAD NETWORK - SUMMARY")
print("=" * 55)
print(f"  Nodes (intersections)  : {G.number_of_nodes():,}")
print(f"  Edges (road segments)  : {G.number_of_edges():,}")
print(f"  Street length total    : {stats.get('street_length_total', 0)/1000:.1f} km")
print(f"  Average street length  : {stats.get('street_length_avg', 0):.1f} m")
print(f"  Intersections count    : {stats.get('intersection_count', 'N/A')}")
print(f"  GraphML file size      : {file_size_mb:.2f} MB")
print(f"  Saved to               : {GRAPHML_FILE}")
print("=" * 55)
print("\n[DONE] Road network graph is ready for Phase 4 safety-first routing.")
print("       Load it with:  G = ox.load_graphml('data/nagpur_road_network.graphml')")
