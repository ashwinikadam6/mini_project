"""
Phase 4 - Step 4.2 : A* Algorithm with Risk Weights
=====================================================
Loads the Nagpur road network (GraphML), annotates every edge with a
risk-weighted cost, and exposes compute_safe_route() which runs A* via
networkx.astar_path using that cost.

Weight formula (per edge):
    weight = length_m + (risk_score * RISK_PENALTY)

    - length_m   : physical road length in metres (from OSM)
    - risk_score : 0.0 (safest) ... 1.0 (most dangerous)
    - RISK_PENALTY: tunable constant (default 500 m per unit of risk)
      Meaning: a fully-risky road gets a 500 m "virtual detour" penalty,
      making the router strongly prefer safer alternatives.

Risk score contributors
-----------------------
  highway type   20 % - motorways / trunks are fastest but highest-risk
  speed limit    20 % - higher posted speed -> higher crash severity
  lighting       15 % - unlit roads after dark increase accident risk
  surface        15 % - unpaved/rough surfaces increase skid risk
  junction type  10 % - complex intersections are higher risk
  accident data  20 % - proximity to historical blackspot coordinates

Usage
-----
    from risk_router import load_graph, compute_safe_route

    G = load_graph()                       # loads once at startup
    result = compute_safe_route(
        G,
        origin_lat=21.1458, origin_lng=79.0882,
        dest_lat=21.1700,   dest_lng=79.0900,
    )
    # result is a dict with 'route', 'distance_m', 'risk_score', etc.
"""

import os
import math
import logging
import warnings
from typing import Optional

import numpy as np
import pandas as pd
import networkx as nx

# Suppress geopandas / shapely deprecation noise
warnings.filterwarnings("ignore", category=FutureWarning)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TUNEABLE CONSTANTS
# ---------------------------------------------------------------------------
GRAPHML_PATH = os.path.join(os.path.dirname(__file__), "data", "nagpur_road_network.graphml")
DATASET_PATH = os.path.join(os.path.dirname(__file__), "nagpur_accident_dataset.csv")

# How many metres of "virtual penalty" is added per unit of risk (0-1 scale).
# 500 m means: a road with risk_score=1.0 looks 500 m longer than it is,
# so the router avoids it unless the real detour is >500 m.
RISK_PENALTY = 500          # metres per risk unit

# Radius (metres) within which a historical accident boosts a node's risk
BLACKSPOT_RADIUS_M = 250

# ---------------------------------------------------------------------------
# RISK SCORING TABLES  (all produce values in [0, 1])
# ---------------------------------------------------------------------------

# OSM highway tag -> base risk (higher = more dangerous)
HIGHWAY_RISK = {
    "motorway":       0.85,
    "motorway_link":  0.80,
    "trunk":          0.75,
    "trunk_link":     0.70,
    "primary":        0.55,
    "primary_link":   0.50,
    "secondary":      0.45,
    "secondary_link": 0.40,
    "tertiary":       0.35,
    "tertiary_link":  0.30,
    "unclassified":   0.30,
    "residential":    0.20,
    "living_street":  0.10,
    "service":        0.15,
    "track":          0.40,
    "path":           0.35,
}
DEFAULT_HIGHWAY_RISK = 0.35   # for unknown / missing tags

# Posted speed limit (km/h) -> risk contribution
def _speed_risk(speed_str) -> float:
    """Convert a maxspeed value (may be string like '50' or '50 mph') to risk."""
    try:
        val = float(str(speed_str).split()[0])
    except (ValueError, TypeError):
        return 0.35   # unknown speed -> moderate penalty
    # Normalise: 0 km/h = 0.0 risk, 120 km/h = 1.0 risk
    return min(val / 120.0, 1.0)

# Surface tag -> risk
SURFACE_RISK = {
    "asphalt":      0.10,
    "paved":        0.10,
    "concrete":     0.12,
    "paving_stones":0.20,
    "sett":         0.25,
    "cobblestone":  0.30,
    "compacted":    0.35,
    "fine_gravel":  0.45,
    "gravel":       0.55,
    "unpaved":      0.65,
    "dirt":         0.70,
    "grass":        0.75,
    "sand":         0.80,
}
DEFAULT_SURFACE_RISK = 0.30   # unknown -> moderate

# Junction tag -> risk
JUNCTION_RISK = {
    "roundabout": 0.35,
    "circular":   0.35,
    "yes":        0.50,
}
DEFAULT_JUNCTION_RISK = 0.10

# ---------------------------------------------------------------------------
# ACCIDENT BLACKSPOT DATA
# ---------------------------------------------------------------------------

def _load_blackspot_tree(csv_path: str):
    """
    Load historical accident records and build a simple spatial lookup.
    Returns a list of (lat, lng, severity_score) tuples.
    severity_score maps risk_level -> 0.5 / 0.75 / 1.0
    """
    if not os.path.exists(csv_path):
        log.warning("Accident dataset not found at %s - skipping blackspot layer", csv_path)
        return []

    df = pd.read_csv(csv_path)
    severity_map = {"Low": 0.5, "Medium": 0.75, "High": 1.0}
    records = []
    for _, row in df.iterrows():
        try:
            lat = float(row["latitude"])
            lng = float(row["longitude"])
            sev = severity_map.get(str(row.get("risk_level", "Medium")).strip(), 0.75)
            # Boost by accident_count (normalised, capped at 1)
            count_factor = min(float(row.get("accident_count", 1)) / 10.0, 1.0)
            score = min(sev * (0.5 + 0.5 * count_factor), 1.0)
            records.append((lat, lng, score))
        except (ValueError, TypeError):
            continue
    log.info("Loaded %d accident records for blackspot scoring", len(records))
    return records


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _node_blackspot_score(node_lat: float, node_lng: float,
                          blackspots, radius_m: float = BLACKSPOT_RADIUS_M) -> float:
    """
    Return the maximum accident severity score of any blackspot within
    radius_m metres of this node.  Returns 0.0 if none found.
    """
    best = 0.0
    for blat, blng, bscore in blackspots:
        d = _haversine_m(node_lat, node_lng, blat, blng)
        if d <= radius_m:
            # Score decays with distance: full weight at 0 m, 0 at radius_m
            decay = 1.0 - (d / radius_m)
            best = max(best, bscore * decay)
    return best


# ---------------------------------------------------------------------------
# GRAPH LOADING
# ---------------------------------------------------------------------------

def load_graph(graphml_path: str = GRAPHML_PATH) -> nx.MultiDiGraph:
    """
    Load the Nagpur road network from GraphML and annotate every edge with:
        safe_weight   = length_m + (risk_score * RISK_PENALTY)
        risk_score    = composite 0-1 safety score
    Returns the annotated MultiDiGraph.
    """
    if not os.path.exists(graphml_path):
        raise FileNotFoundError(
            f"GraphML not found: {graphml_path}\n"
            f"Run download_nagpur_graph.py first."
        )

    log.info("Loading graph from %s ...", graphml_path)
    # Use networkx directly (avoids requiring osmnx at runtime if unavailable)
    try:
        import osmnx as ox
        G = ox.load_graphml(graphml_path)
        log.info("Loaded via OSMnx: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())
    except ImportError:
        G = nx.read_graphml(graphml_path)
        log.info("Loaded via NetworkX: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())

    # Load historical accident data for blackspot scoring
    blackspots = _load_blackspot_tree(DATASET_PATH)

    log.info("Annotating edges with risk weights ...")
    _annotate_edges(G, blackspots)
    log.info("Edge annotation complete.")

    return G


# ---------------------------------------------------------------------------
# STEP 4.2a — EDGE RISK SCORING
# ---------------------------------------------------------------------------

def _edge_risk_score(edge_data: dict,
                     u_lat: float, u_lng: float,
                     v_lat: float, v_lng: float,
                     blackspots) -> float:
    """
    Compute a composite risk score [0, 1] for a single road segment.

    Weights:
        20% highway type
        20% speed limit
        15% lighting
        15% surface quality
        10% junction complexity
        20% historical accident proximity
    """
    # ---- highway type (20%) -----------------------------------------------
    hw = edge_data.get("highway", "")
    if isinstance(hw, list):          # OSM sometimes returns a list
        hw = hw[0] if hw else ""
    hw_risk = HIGHWAY_RISK.get(str(hw).strip(), DEFAULT_HIGHWAY_RISK)

    # ---- speed limit (20%) ------------------------------------------------
    speed_risk = _speed_risk(edge_data.get("maxspeed", None))

    # ---- lighting (15%) ---------------------------------------------------
    lit = str(edge_data.get("lit", "")).strip().lower()
    if lit == "yes":
        light_risk = 0.10
    elif lit in ("no", ""):
        light_risk = 0.70
    else:
        light_risk = 0.40   # unknown / limited

    # ---- surface (15%) ----------------------------------------------------
    surface = str(edge_data.get("surface", "")).strip().lower()
    surf_risk = SURFACE_RISK.get(surface, DEFAULT_SURFACE_RISK)

    # ---- junction (10%) ---------------------------------------------------
    junction = str(edge_data.get("junction", "")).strip().lower()
    junc_risk = JUNCTION_RISK.get(junction, DEFAULT_JUNCTION_RISK)

    # ---- historical accidents (20%) ---------------------------------------
    # Use midpoint of edge to check proximity to blackspots
    mid_lat = (u_lat + v_lat) / 2.0
    mid_lng = (u_lng + v_lng) / 2.0
    acc_risk = _node_blackspot_score(mid_lat, mid_lng, blackspots)

    # ---- weighted composite -----------------------------------------------
    risk = (
        0.20 * hw_risk
        + 0.20 * speed_risk
        + 0.15 * light_risk
        + 0.15 * surf_risk
        + 0.10 * junc_risk
        + 0.20 * acc_risk
    )
    return float(np.clip(risk, 0.0, 1.0))


def _annotate_edges(G: nx.MultiDiGraph, blackspots) -> None:
    """
    Iterate every edge in G and add two attributes in-place:
        risk_score  : float [0, 1]
        safe_weight : float (metres, risk-penalised)
    """
    node_data = dict(G.nodes(data=True))

    for u, v, key, data in G.edges(keys=True, data=True):
        # Get coordinates of the two endpoints
        u_info = node_data.get(u, {})
        v_info = node_data.get(v, {})
        u_lat = float(u_info.get("y", 0))
        u_lng = float(u_info.get("x", 0))
        v_lat = float(v_info.get("y", 0))
        v_lng = float(v_info.get("x", 0))

        # Physical length (metres) — already in the graph from OSMnx
        length_m = float(data.get("length", 50.0))

        # Compute risk score
        risk = _edge_risk_score(data, u_lat, u_lng, v_lat, v_lng, blackspots)

        # Apply the weight formula:  weight = length + (risk * RISK_PENALTY)
        safe_weight = length_m + (risk * RISK_PENALTY)

        # Write back to the graph
        G[u][v][key]["risk_score"]  = risk
        G[u][v][key]["safe_weight"] = safe_weight


# ---------------------------------------------------------------------------
# STEP 4.2b — A* HEURISTIC
# ---------------------------------------------------------------------------

def _astar_heuristic(G: nx.MultiDiGraph):
    """
    Returns a heuristic function h(u, target) for A* that estimates the
    minimum remaining cost from node u to target.

    We use the Haversine (great-circle) distance as the heuristic.
    This is ADMISSIBLE because:
      - safe_weight >= length_m  (the penalty only increases cost)
      - Haversine <= road length  (roads can't be shorter than straight line)
    Therefore Haversine is always a lower bound on safe_weight, satisfying
    the admissibility requirement for A* optimality.
    """
    node_data = dict(G.nodes(data=True))

    def h(u, target):
        u_info     = node_data.get(u, {})
        t_info     = node_data.get(target, {})
        u_lat      = float(u_info.get("y", 0))
        u_lng      = float(u_info.get("x", 0))
        t_lat      = float(t_info.get("y", 0))
        t_lng      = float(t_info.get("x", 0))
        return _haversine_m(u_lat, u_lng, t_lat, t_lng)

    return h


# ---------------------------------------------------------------------------
# STEP 4.2c — NEAREST NODE HELPER
# ---------------------------------------------------------------------------

def _nearest_node(G: nx.MultiDiGraph, lat: float, lng: float) -> int:
    """
    Find the graph node (intersection) nearest to (lat, lng).
    Uses OSMnx if available, otherwise falls back to brute-force search.
    """
    try:
        import osmnx as ox
        return ox.nearest_nodes(G, X=lng, Y=lat)
    except ImportError:
        pass

    # Brute-force fallback: find minimum Haversine distance
    best_node = None
    best_dist = float("inf")
    for node, data in G.nodes(data=True):
        n_lat = float(data.get("y", 0))
        n_lng = float(data.get("x", 0))
        d = _haversine_m(lat, lng, n_lat, n_lng)
        if d < best_dist:
            best_dist = d
            best_node = node
    return best_node


# ---------------------------------------------------------------------------
# MAIN ROUTING FUNCTION
# ---------------------------------------------------------------------------

def compute_safe_route(
    G: nx.MultiDiGraph,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    risk_penalty: float = RISK_PENALTY,
) -> dict:
    """
    Compute the safest route from origin to destination using A*.

    Parameters
    ----------
    G            : annotated MultiDiGraph from load_graph()
    origin_lat   : latitude of start point
    origin_lng   : longitude of start point
    dest_lat     : latitude of end point
    dest_lng     : longitude of end point
    risk_penalty : metres of virtual penalty per unit of risk (default 500)
                   Set to 0 to get the shortest (not safest) path.

    Returns
    -------
    dict with keys:
        success          : bool
        route_nodes      : list of OSM node IDs along the route
        route_coords     : list of [lat, lng] pairs for map rendering
        total_distance_m : total physical road length in metres
        total_distance_km: same in kilometres
        avg_risk_score   : mean risk score across all route edges
        max_risk_score   : worst (highest) risk on any single edge
        num_waypoints    : number of route nodes
        origin_node      : snapped origin OSM node ID
        dest_node        : snapped destination OSM node ID
        error            : error message (only present when success=False)
    """
    try:
        # ---- 1. Snap coordinates to nearest graph nodes --------------------
        origin_node = _nearest_node(G, origin_lat, origin_lng)
        dest_node   = _nearest_node(G, dest_lat,   dest_lng)

        if origin_node is None or dest_node is None:
            return {"success": False, "error": "Could not snap coordinates to graph nodes."}

        if origin_node == dest_node:
            return {"success": False, "error": "Origin and destination snap to the same node."}

        log.info("A* routing: node %s -> node %s", origin_node, dest_node)

        # ---- 2. Build heuristic --------------------------------------------
        heuristic = _astar_heuristic(G)

        # ---- 3. Define edge weight accessor --------------------------------
        # networkx.astar_path calls weight(u, v, edge_data_dict) per edge.
        # For a MultiDiGraph each (u, v) may have multiple parallel edges;
        # we pick the one with the lowest safe_weight.
        def weight_fn(u, v, edge_dict):
            """Return the minimum safe_weight among parallel edges."""
            min_w = float("inf")
            for key, data in edge_dict.items():
                w = data.get("safe_weight")
                if w is None:
                    # Fallback: recompute on-the-fly (shouldn't happen after annotation)
                    length_m = float(data.get("length", 50.0))
                    risk     = float(data.get("risk_score", 0.35))
                    w        = length_m + risk * risk_penalty
                min_w = min(min_w, w)
            return min_w

        # ---- 4. Run A* -----------------------------------------------------
        path_nodes = nx.astar_path(
            G,
            source    = origin_node,
            target    = dest_node,
            heuristic = heuristic,
            weight    = weight_fn,
        )

        log.info("A* found path with %d nodes", len(path_nodes))

        # ---- 5. Extract route geometry and statistics ----------------------
        node_data   = dict(G.nodes(data=True))
        route_coords = []
        for n in path_nodes:
            nd   = node_data.get(n, {})
            lat  = float(nd.get("y", 0))
            lng  = float(nd.get("x", 0))
            route_coords.append([round(lat, 6), round(lng, 6)])

        # Collect per-edge metrics
        total_distance_m = 0.0
        edge_risks       = []

        for i in range(len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i + 1]
            # Pick the best (lowest-weight) parallel edge
            best_data = None
            best_w    = float("inf")
            for key, data in G[u][v].items():
                w = data.get("safe_weight", float("inf"))
                if w < best_w:
                    best_w    = w
                    best_data = data

            if best_data:
                total_distance_m += float(best_data.get("length", 0))
                edge_risks.append(float(best_data.get("risk_score", 0.35)))

        avg_risk = float(np.mean(edge_risks))  if edge_risks else 0.0
        max_risk = float(np.max(edge_risks))   if edge_risks else 0.0

        return {
            "success":           True,
            "route_nodes":       [str(n) for n in path_nodes],
            "route_coords":      route_coords,
            "total_distance_m":  round(total_distance_m, 1),
            "total_distance_km": round(total_distance_m / 1000.0, 3),
            "avg_risk_score":    round(avg_risk, 4),
            "max_risk_score":    round(max_risk, 4),
            "risk_level":        _classify_risk(avg_risk),
            "num_waypoints":     len(path_nodes),
            "origin_node":       str(origin_node),
            "dest_node":         str(dest_node),
        }

    except nx.NetworkXNoPath:
        return {
            "success": False,
            "error": "No path found between origin and destination in the road network.",
        }
    except nx.NodeNotFound as e:
        return {"success": False, "error": f"Node not found: {e}"}
    except Exception as e:
        log.exception("Unexpected error in compute_safe_route")
        return {"success": False, "error": str(e)}


def _classify_risk(score: float) -> str:
    """Map a 0-1 risk score to a human-readable label."""
    if score < 0.25:
        return "Low"
    if score < 0.55:
        return "Medium"
    return "High"


# ---------------------------------------------------------------------------
# ROUTE COMPARISON  (safe vs shortest)
# ---------------------------------------------------------------------------

def compare_routes(
    G: nx.MultiDiGraph,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> dict:
    """
    Run BOTH the safety-first route (risk_penalty=500) and the classic
    shortest-distance route (risk_penalty=0), then return both with a
    comparison summary.

    Useful for the dashboard to show the user what the router traded off.
    """
    safe     = compute_safe_route(G, origin_lat, origin_lng, dest_lat, dest_lng,
                                  risk_penalty=RISK_PENALTY)
    shortest = compute_safe_route(G, origin_lat, origin_lng, dest_lat, dest_lng,
                                  risk_penalty=0)

    comparison = {}
    if safe.get("success") and shortest.get("success"):
        extra_m = safe["total_distance_m"] - shortest["total_distance_m"]
        risk_reduction = shortest["avg_risk_score"] - safe["avg_risk_score"]
        comparison = {
            "extra_distance_m":    round(extra_m, 1),
            "extra_distance_km":   round(extra_m / 1000.0, 3),
            "risk_reduction":      round(risk_reduction, 4),
            "risk_reduction_pct":  round(risk_reduction * 100, 1),
            "recommendation": (
                "Safe route recommended"
                if risk_reduction > 0.05
                else "Routes are similar - shortest path is fine"
            ),
        }

    return {
        "safe_route":    safe,
        "short_route":   shortest,
        "comparison":    comparison,
    }


# ---------------------------------------------------------------------------
# MODULE-LEVEL GRAPH SINGLETON (for Flask integration)
# ---------------------------------------------------------------------------

_G: Optional[nx.MultiDiGraph] = None

def get_graph() -> nx.MultiDiGraph:
    """
    Return the module-level graph singleton, loading it on first call.
    Call this from your Flask app at startup so routing is instant at
    request time.

        from risk_router import get_graph
        G = get_graph()   # load once
    """
    global _G
    if _G is None:
        _G = load_graph()
    return _G


# ---------------------------------------------------------------------------
# CLI QUICK TEST
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json, sys

    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s"
    )

    print("=" * 60)
    print("  Phase 4 - Step 4.2 : Risk-Averse A* Router - Self-Test")
    print("=" * 60)

    G = load_graph()

    # Test: Nagpur railway station -> Sitabuldi Junction
    origin = (21.1481, 79.0862)   # Nagpur Railway Station
    dest   = (21.1458, 79.0882)   # Zero Mile / Sitabuldi

    print(f"\n[TEST] Route: {origin} -> {dest}")
    print(f"       Risk penalty: {RISK_PENALTY} m per unit risk\n")

    result = compare_routes(G, origin[0], origin[1], dest[0], dest[1])

    print("--- SAFE ROUTE ---")
    sr = result["safe_route"]
    if sr["success"]:
        print(f"  Distance  : {sr['total_distance_km']} km")
        print(f"  Avg Risk  : {sr['avg_risk_score']:.3f}  ({sr['risk_level']})")
        print(f"  Max Risk  : {sr['max_risk_score']:.3f}")
        print(f"  Waypoints : {sr['num_waypoints']}")
    else:
        print(f"  ERROR: {sr['error']}")

    print("\n--- SHORTEST ROUTE ---")
    sh = result["short_route"]
    if sh["success"]:
        print(f"  Distance  : {sh['total_distance_km']} km")
        print(f"  Avg Risk  : {sh['avg_risk_score']:.3f}  ({sh['risk_level']})")
        print(f"  Max Risk  : {sh['max_risk_score']:.3f}")
        print(f"  Waypoints : {sh['num_waypoints']}")
    else:
        print(f"  ERROR: {sh['error']}")

    comp = result.get("comparison", {})
    if comp:
        print("\n--- COMPARISON ---")
        print(f"  Extra distance  : +{comp['extra_distance_m']} m")
        print(f"  Risk reduction  : {comp['risk_reduction_pct']} %")
        print(f"  Recommendation  : {comp['recommendation']}")

    print("\n[DONE] risk_router.py self-test complete.")
