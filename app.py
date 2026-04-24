"""
SafeRoute AI - Flask Backend API
Run: python app.py
Requires: pip install flask flask-cors joblib scikit-learn pandas numpy flask-sqlalchemy flask-jwt-extended bcrypt python-dotenv requests flask-socketio osmnx

Step 1.3 - Authentication API
  - POST /api/register  -> hash password with bcrypt, save user to SQLite
  - POST /api/login     -> verify password, return JWT access_token

Step 2.1 - Live API Integration
  - GET  /api/live-weather  -> proxies OpenWeatherMap (OPENWEATHER_API_KEY in .env)
  - GET  /api/live-traffic  -> proxies TomTom Traffic   (TOMTOM_API_KEY in .env)

Step 2.2 - Backend API Wrapper Functions
  - get_live_weather(lat, lng) -> reusable helper; returns weather dict or raises
  - get_live_traffic(lat, lng) -> reusable helper; returns traffic dict or raises
  - /api/predict now accepts auto_live=true to skip manual weather/traffic inputs

Phase 3 - Step 3.1 : WebSocket Setup (Flask-SocketIO)
  - socketio = SocketIO(app, cors_allowed_origins="*")
  - Server entry-point changed to socketio.run(app) so WS transport is active
  - Frontend connects via socket.io-client (npm install socket.io-client)

Phase 4 - Step 4.2 : Risk-Averse A* Routing
  - POST /api/route         -> compute safest route between two lat/lng points
  - POST /api/route/compare -> run BOTH safe + shortest and return comparison
"""

# ── Ensure user site-packages are on path (fixes broken venv issues) ─────
import sys, os, pathlib

_user_site = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Python", "Python314", "site-packages")
if _user_site not in sys.path:
    sys.path.insert(0, _user_site)

# ── Load .env manually (no external dependency needed) ──────────────────
_env_path = pathlib.Path(__file__).parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())
    print("[OK] .env loaded")

from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
import bcrypt, requests
import joblib, numpy as np, pandas as pd, json
from datetime import datetime
from models import db, User, AccidentRecord, ReportedHazard, ScoreEvent

app = Flask(__name__)

# ============================================================
# PHASE 3 — STEP 3.1 : WebSocket Initialisation
# cors_allowed_origins="*" lets the React dev server (any port)
# connect without a CORS pre-flight rejection.
# ============================================================
socketio = SocketIO(app, cors_allowed_origins="*")

# ============================================================
# DATABASE CONFIGURATION (SQLite)
# ============================================================
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///saferoute.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# ============================================================
# JWT CONFIGURATION
# ============================================================
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'saferoute-super-secret-key-change-in-prod')

# ============================================================
# LIVE API KEYS  (set in .env — never hardcode here)
# ============================================================
OPENWEATHER_API_KEY = os.environ.get('OPENWEATHER_API_KEY', '')
TOMTOM_API_KEY      = os.environ.get('TOMTOM_API_KEY', '')

jwt = JWTManager(app)

# Initialise SQLAlchemy with the app
db.init_app(app)

# Auto-create all tables the first time app starts
with app.app_context():
    db.create_all()
    # Phase 5.3 / 6.1: migrate existing rows that predate new columns
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            conn.execute(text("UPDATE users SET driving_score = 100 WHERE driving_score IS NULL"))
            conn.execute(text("UPDATE users SET role = 'user' WHERE role IS NULL"))
            conn.commit()
    except Exception:
        pass   # columns may not exist yet on first run — create_all handles it
    print("[OK] Database ready -> instance/saferoute.db")

# CORS FIX
CORS(app, supports_credentials=True)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    return response

MODEL_LOADED = False
model = le_weather = le_road = le_density = le_risk = None

def load_model():
    global model, le_weather, le_road, le_density, le_risk, MODEL_LOADED
    try:
        model      = joblib.load("model.pkl")
        le_weather = joblib.load("le_weather.pkl")
        le_road    = joblib.load("le_road.pkl")
        le_density = joblib.load("le_density.pkl")
        le_risk    = joblib.load("le_risk.pkl")
        MODEL_LOADED = True
        print("[OK] Model loaded successfully")
    except Exception as e:
        MODEL_LOADED = False
        print("[FAIL] Model loading failed:", str(e))

load_model()

dataset = []
if os.path.exists("nagpur_accident_dataset.csv"):
    try:
        dataset = pd.read_csv("nagpur_accident_dataset.csv").to_dict(orient="records")
        print(f"[OK] Dataset loaded: {len(dataset)} rows")
    except Exception as e:
        print("[FAIL] Dataset load error:", str(e))



# ============================================================
# STEP 2.2 — LIVE API WRAPPER FUNCTIONS
# These are plain Python functions (not routes) so they can be
# called from anywhere inside the app, e.g. from /api/predict.
# ============================================================

def get_live_weather(lat: float, lng: float) -> dict:
    """
    Fetch current weather from OpenWeatherMap for the given coordinates.

    Args:
        lat (float): Latitude
        lng (float): Longitude

    Returns:
        dict with keys:
            weather       – label compatible with ML model (Clear/Rain/Fog/Haze)
            temperature   – °C (float)
            humidity      – % (int)
            description   – human-readable string from OWM
            city          – city name from OWM
            raw           – full OWM JSON for debugging

    Raises:
        RuntimeError  – if API key is missing
        requests.exceptions.RequestException – on network / HTTP errors
    """
    if not OPENWEATHER_API_KEY:
        raise RuntimeError("OPENWEATHER_API_KEY is not set in .env")

    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {
        "lat":   lat,
        "lon":   lng,
        "appid": OPENWEATHER_API_KEY,
        "units": "metric",
    }

    resp = requests.get(url, params=params, timeout=5)
    resp.raise_for_status()          # raises HTTPError on 4xx / 5xx
    ow = resp.json()

    # ── Map OWM condition code → ML model label ──────────────────────────
    # OWM condition codes: https://openweathermap.org/weather-conditions
    # Model classes: Clear, Cloudy, Fog, Haze, Rain
    cid = ow["weather"][0]["id"]
    if 200 <= cid < 600:        # 2xx thunderstorm, 3xx drizzle, 5xx rain
        weather_label = "Rain"
    elif 600 <= cid < 700:      # 6xx snow → treat as Fog for our model
        weather_label = "Fog"
    elif cid in (701, 711, 731, 741, 751, 761, 762, 771, 781):  # mist/smoke/sand/ash/squall/tornado
        weather_label = "Fog"
    elif cid == 721:            # haze
        weather_label = "Haze"
    elif cid in (801, 802, 803, 804):  # partly/mostly/overcast clouds
        weather_label = "Cloudy"
    else:                       # 800 clear sky
        weather_label = "Clear"

    print(f"[WEATHER] lat={lat}, lng={lng} → {weather_label} "
          f"({ow['weather'][0]['description']}, {ow['main']['temp']}°C)")

    return {
        "weather":     weather_label,
        "temperature": ow["main"]["temp"],
        "humidity":    ow["main"]["humidity"],
        "description": ow["weather"][0]["description"],
        "city":        ow.get("name", ""),
        "raw":         ow,
    }


def get_live_traffic(lat: float, lng: float) -> dict:
    """
    Fetch current traffic congestion from TomTom Traffic Flow API.

    Args:
        lat (float): Latitude
        lng (float): Longitude

    Returns:
        dict with keys:
            traffic_density  – label compatible with ML model (Low/Medium/High)
            current_speed    – km/h (float)
            free_flow_speed  – km/h (float)
            congestion_ratio – 0.0 (free) → 1.0 (standstill)
            raw              – raw TomTom flowSegmentData dict

    Raises:
        RuntimeError  – if API key is missing
        requests.exceptions.RequestException – on network / HTTP errors
    """
    if not TOMTOM_API_KEY:
        raise RuntimeError("TOMTOM_API_KEY is not set in .env")

    zoom = 10   # city-level road segment granularity
    url  = (
        f"https://api.tomtom.com/traffic/services/4"
        f"/flowSegmentData/absolute/{zoom}/json"
        f"?point={lat},{lng}&key={TOMTOM_API_KEY}"
    )

    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    tt = resp.json().get("flowSegmentData", {})

    current_speed = float(tt.get("currentSpeed",  0))
    free_flow     = float(tt.get("freeFlowSpeed", 1))

    # Avoid division-by-zero on unusual TomTom responses
    ratio = current_speed / free_flow if free_flow > 0 else 1.0

    # ── Map speed ratio → ML model traffic density label ─────────────────
    # ratio < 0.4  → severely congested  → High density
    # ratio < 0.7  → moderate traffic    → Medium density
    # ratio >= 0.7 → free-flowing        → Low density
    if ratio < 0.4:
        density_label = "High"
    elif ratio < 0.7:
        density_label = "Medium"
    else:
        density_label = "Low"

    congestion = round(1.0 - ratio, 2)   # 0 = free flow, 1 = standstill

    print(f"[TRAFFIC] lat={lat}, lng={lng} → {density_label} "
          f"(speed {current_speed}/{free_flow} km/h, congestion={congestion})")

    return {
        "traffic_density":  density_label,
        "current_speed":    current_speed,
        "free_flow_speed":  free_flow,
        "congestion_ratio": congestion,
        "raw":              tt,
    }


# ============================================================
# AUTHENTICATION ENDPOINTS
# ============================================================

@app.route("/api/register", methods=["POST"])
def register():
    """
    Register a new user.

    Expected JSON body:
        { "name": "...", "email": "...", "password": "..." }

    Returns:
        201 - { "message": "...", "user": { id, name, email, created_at } }
        400 - validation / duplicate-email errors
    """
    data = request.get_json(silent=True)

    # -- Validate input --------------------------------------
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    name     = (data.get("name")     or "").strip()
    email    = (data.get("email")    or "").strip().lower()
    password =  data.get("password") or ""

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not email or "@" not in email:
        return jsonify({"error": "A valid email is required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    # -- Duplicate-email check --------------------------------
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already registered"}), 400

    # -- Hash password with bcrypt ----------------------------
    # bcrypt.hashpw returns bytes; store as utf-8 string
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    # -- Accept optional role (only allow 'admin' if explicitly passed) -------
    role = str(data.get("role", "user")).lower()
    if role not in ("user", "admin"):
        role = "user"

    # -- Persist user -----------------------------------------
    user = User(name=name, email=email, password_hash=pw_hash, role=role)
    db.session.add(user)
    db.session.commit()

    print(f"[REGISTER] New user: {email} (id={user.id})")
    return jsonify({
        "message": "Registration successful",
        "user": user.to_dict()
    }), 201


@app.route("/api/login", methods=["POST"])
def login():
    """
    Authenticate a user and issue a JWT access token.

    Expected JSON body:
        { "email": "...", "password": "..." }

    Returns:
        200 - { "access_token": "...", "user": { id, name, email, created_at } }
        400 - missing fields
        401 - invalid credentials
    """
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    email    = (data.get("email")    or "").strip().lower()
    password =  data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    # -- Look up user -----------------------------------------
    user = User.query.filter_by(email=email).first()

    # -- Verify password (constant-time comparison via bcrypt) -
    if not user or not bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8")):
        return jsonify({"error": "Invalid email or password"}), 401

    # -- Issue JWT (identity = user id as string) --------------
    access_token = create_access_token(identity=str(user.id))

    print(f"[LOGIN] {email} authenticated (id={user.id})")
    return jsonify({
        "access_token": access_token,
        "user": user.to_dict()
    }), 200


@app.route("/api/me", methods=["GET"])
@jwt_required()
def me():
    """
    Return the currently authenticated user's profile.
    Requires:  Authorization: Bearer <access_token>
    """
    user_id = int(get_jwt_identity())
    user    = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": user.to_dict()}), 200


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "dataset_size": len(dataset)
    })

@app.route("/api/predict", methods=["POST"])
def predict():
    """
    POST /api/predict

    Step 2.3 — Dynamic Prediction (fully automatic).
    Only latitude and longitude are required. Everything else is derived:

      Required:
        { "latitude": 21.1458, "longitude": 79.0882 }

      Optional overrides (if you want to test with fixed values):
        {
          "latitude":        21.1458,
          "longitude":       79.0882,
          "road_type":       "Junction",   ← default: nearest known location type
          "accident_count":  5             ← default: 5 (dataset average)
        }

    Auto-derived inputs (no need to send these):
        time_of_day      → current server hour (IST)
        weather          → live from OpenWeatherMap via get_live_weather()
        traffic_density  → live from TomTom Traffic  via get_live_traffic()
    """
    if not MODEL_LOADED:
        return jsonify({"error": "Model not loaded. Run ml_model.py first."}), 503

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON with at least {latitude, longitude}"}), 400

    # ── 1. Validate required inputs ───────────────────────────────────────
    try:
        lat = float(data["latitude"])
        lng = float(data["longitude"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "'latitude' and 'longitude' are required numeric fields"}), 400

    # ── 2. Auto-derive time_of_day from current server clock ──────────────
    hour = datetime.now().hour
    print(f"[PREDICT] Request → lat={lat}, lng={lng}, hour={hour} (auto)")

    # ── 3. Fetch live weather via get_live_weather() ───────────────────────
    live_weather_data = None
    try:
        live_weather_data = get_live_weather(lat, lng)
        weather_label     = live_weather_data["weather"]
    except Exception as we:
        weather_label = "Clear"   # safe fallback
        print(f"[PREDICT][WARN] Weather fetch failed: {we} — using fallback '{weather_label}'")

    # ── 4. Fetch live traffic via get_live_traffic() ───────────────────────
    live_traffic_data = None
    try:
        live_traffic_data = get_live_traffic(lat, lng)
        density_label     = live_traffic_data["traffic_density"]
    except Exception as te:
        density_label = "Low"     # safe fallback
        print(f"[PREDICT][WARN] Traffic fetch failed: {te} — using fallback '{density_label}'")

    # ── 5. road_type: use client override or default to 'City Road' ────────
    # The caller can optionally send road_type; otherwise we pick the most
    # common type in the Nagpur dataset (City Road) as a neutral default.
    road_type = data.get("road_type", "City Road")
    valid_roads = ["Junction", "Highway", "City Road", "Urban", "Flyover", "Ring Road"]
    if road_type not in valid_roads:
        road_type = "City Road"

    # ── 6. Encode features for the Random Forest model ────────────────────
    try:
        w_enc = le_weather.transform([weather_label])[0]
        r_enc = le_road.transform([road_type])[0]
        d_enc = le_density.transform([density_label])[0]
    except ValueError as enc_err:
        return jsonify({"error": f"Encoding error (unknown label): {enc_err}"}), 400

    accident_count = int(data.get("accident_count", 5))

    features_df = pd.DataFrame([{
        "latitude":       lat,
        "longitude":      lng,
        "time_of_day":    hour,
        "weather_enc":    w_enc,
        "road_enc":       r_enc,
        "density_enc":    d_enc,
        "accident_count": accident_count,
        "is_night":       1 if (hour >= 20 or hour <= 5)  else 0,
        "is_peak":        1 if ((8 <= hour <= 10) or (17 <= hour <= 20)) else 0,
        "is_bad_weather": 1 if weather_label in ("Rain", "Fog", "Haze") else 0,
    }])

    # ── 7. Run Random Forest inference ────────────────────────────────────
    try:
        probas   = model.predict_proba(features_df)[0]
        classes  = le_risk.classes_
        pred_idx = np.argmax(probas)
    except Exception as model_err:
        print("❌ Model inference error:", str(model_err))
        return jsonify({"error": f"Model inference failed: {model_err}"}), 500

    # ── 8. Build response ─────────────────────────────────────────────────
    response = {
        # Core prediction
        "risk_level":    classes[pred_idx],
        "probabilities": {c: round(float(p) * 100, 1) for c, p in zip(classes, probas)},
        "confidence":    round(float(probas[pred_idx]) * 100, 1),

        # Show exactly what inputs went into the model
        "inputs_used": {
            "latitude":        lat,
            "longitude":       lng,
            "time_of_day":     hour,
            "weather":         weather_label,
            "road_type":       road_type,
            "traffic_density": density_label,
            "accident_count":  accident_count,
        },
    }

    # Attach enriched live-data context (strip raw JSON to keep response clean)
    if live_weather_data:
        response["live_weather"] = {
            k: v for k, v in live_weather_data.items() if k != "raw"
        }
    if live_traffic_data:
        response["live_traffic"] = {
            k: v for k, v in live_traffic_data.items() if k != "raw"
        }

    print(f"[PREDICT] Result → {classes[pred_idx]} ({response['confidence']}% confidence) "
          f"| weather={weather_label}, traffic={density_label}, hour={hour}")

    return jsonify(response)

@app.route("/api/dataset")
def get_dataset():
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 20))
    risk = request.args.get("risk")

    filtered = [d for d in dataset if not risk or d.get("risk_level") == risk]

    start = (page - 1) * limit
    return jsonify({
        "total": len(filtered),
        "page": page,
        "data": filtered[start:start + limit]
    })

@app.route("/api/blackspots")
def blackspots():
    stats = {}

    for r in dataset:
        loc = r.get("location", "Unknown")

        if loc not in stats:
            stats[loc] = {
                "location": loc,
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "total": 0,
                "high": 0,
                "medium": 0,
                "low": 0,
                "total_accidents": 0
            }

        s = stats[loc]
        s["total"] += 1
        s["total_accidents"] += r.get("accident_count", 0)

        level = r.get("risk_level", "Low").lower()
        s[level] += 1

    result = []
    for s in stats.values():
        s["avg_accidents"] = round(s["total_accidents"] / s["total"], 2) if s["total"] else 0
        s["status"] = "Blackspot" if s["high"] > 6 else "Watch Zone" if s["high"] > 3 else "Safe"
        result.append(s)

    return jsonify(sorted(result, key=lambda x: -x["high"]))

@app.route("/api/statistics")
def statistics():
    total = len(dataset)

    if total == 0:
        return jsonify({"error": "Dataset empty"}), 500

    return jsonify({
        "total": total,
        "high": sum(1 for d in dataset if d.get("risk_level") == "High"),
        "medium": sum(1 for d in dataset if d.get("risk_level") == "Medium"),
        "low": sum(1 for d in dataset if d.get("risk_level") == "Low"),
        "avg_accidents": round(sum(d.get("accident_count", 0) for d in dataset) / total, 2),
        "model_accuracy": 91.4
    })

# ============================================================
# PHASE 2 — LIVE DATA PROXY ENDPOINTS
# ============================================================

@app.route("/api/live-weather")
def live_weather_route():
    """
    GET /api/live-weather?lat=<lat>&lon=<lon>
    HTTP wrapper around get_live_weather().  Defaults to Nagpur centre.
    """
    try:
        lat = float(request.args.get("lat", 21.1458))
        lon = float(request.args.get("lon", 79.0882))
        return jsonify(get_live_weather(lat, lon))
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": f"OpenWeatherMap API error: {e}"}), 502
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"OpenWeatherMap request failed: {e}"}), 502


@app.route("/api/live-traffic")
def live_traffic_route():
    """
    GET /api/live-traffic?lat=<lat>&lon=<lon>
    HTTP wrapper around get_live_traffic().  Defaults to Nagpur centre.
    """
    try:
        lat = float(request.args.get("lat", 21.1458))
        lon = float(request.args.get("lon", 79.0882))
        return jsonify(get_live_traffic(lat, lon))
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": f"TomTom API error: {e}"}), 502
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"TomTom request failed: {e}"}), 502


# ============================================================
# PHASE 3 — STEP 3.2 : HAZARD REPORTING ENDPOINTS
# ============================================================

# Valid hazard types accepted by the API
VALID_HAZARD_TYPES = {
    "Pothole", "Accident", "Road Closure",
    "Waterlogging", "Debris", "Stray Animals", "Other"
}


@app.route("/api/hazards", methods=["POST"])
@jwt_required()
def report_hazard():
    """
    POST /api/hazards
    Protected: requires  Authorization: Bearer <access_token>

    Submit a new crowdsourced hazard report.  After saving to the
    ReportedHazard table the server broadcasts a WebSocket event
    ('new_hazard') so every connected client receives it instantly —
    no polling required.

    Expected JSON body:
        {
            "hazard_type": "Pothole",          ← required
            "latitude":    21.1458,            ← required
            "longitude":   79.0882,            ← required
            "description": "Large pothole..."  ← optional
        }

    Returns:
        201 - { "message": "...", "hazard": { ...hazard dict... } }
        400 - validation errors
    """
    user_id = int(get_jwt_identity())
    data    = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    # ── Validate required fields ──────────────────────────────────────────
    hazard_type = (data.get("hazard_type") or "").strip()
    if not hazard_type:
        return jsonify({"error": "'hazard_type' is required"}), 400
    if hazard_type not in VALID_HAZARD_TYPES:
        return jsonify({
            "error": f"Invalid hazard_type. Choose from: {', '.join(sorted(VALID_HAZARD_TYPES))}"
        }), 400

    try:
        lat = float(data["latitude"])
        lng = float(data["longitude"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "'latitude' and 'longitude' are required numeric fields"}), 400

    description = (data.get("description") or "").strip()

    # ── Persist to ReportedHazard table ──────────────────────────────────
    hazard = ReportedHazard(
        user_id     = user_id,
        latitude    = lat,
        longitude   = lng,
        hazard_type = hazard_type,
        description = description,
        status      = "Pending",
        upvotes     = 0,
    )
    db.session.add(hazard)
    db.session.commit()

    hazard_data = hazard.to_dict()
    print(f"[HAZARD] New report saved → id={hazard.id}, type={hazard_type}, "
          f"lat={lat}, lng={lng}, user_id={user_id}")

    # ── Broadcast via WebSocket to ALL connected clients ──────────────────
    # Every browser/app listening for 'new_hazard' receives this instantly.
    socketio.emit("new_hazard", hazard_data)
    print(f"[SOCKET] Emitted 'new_hazard' event → id={hazard.id}")

    return jsonify({
        "message": "Hazard reported successfully",
        "hazard":  hazard_data
    }), 201


@app.route("/api/hazards", methods=["GET"])
def get_hazards():
    """
    GET /api/hazards
    Public endpoint — no auth required.

    Returns all hazard reports for map rendering.

    Optional query params:
        status      - filter by status  (Pending / Verified / Rejected)
        hazard_type - filter by type    (Pothole / Accident / …)
        limit       - max records to return (default 100)

    Returns:
        200 - { "total": N, "hazards": [ ...hazard dicts... ] }
    """
    status_filter = request.args.get("status")
    type_filter   = request.args.get("hazard_type")
    limit         = min(int(request.args.get("limit", 100)), 500)

    query = ReportedHazard.query

    if status_filter:
        query = query.filter_by(status=status_filter)
    if type_filter:
        query = query.filter_by(hazard_type=type_filter)

    hazards = query.order_by(ReportedHazard.created_at.desc()).limit(limit).all()
    result  = [h.to_dict() for h in hazards]

    return jsonify({"total": len(result), "hazards": result}), 200


@app.route("/api/hazards/<int:hazard_id>/upvote", methods=["POST"])
@jwt_required()
def upvote_hazard(hazard_id):
    """
    POST /api/hazards/<id>/upvote
    Protected: requires Authorization: Bearer <access_token>

    Waze-style community upvote — confirms a hazard is still present.
    Increments the upvote counter and re-broadcasts an updated
    'hazard_updated' WebSocket event so all clients stay in sync.

    Returns:
        200 - { "message": "...", "hazard": { ...updated dict... } }
        404 - hazard not found
    """
    hazard = ReportedHazard.query.get(hazard_id)
    if not hazard:
        return jsonify({"error": f"Hazard id={hazard_id} not found"}), 404

    hazard.upvotes += 1

    # Auto-verify once it reaches 3 community upvotes
    if hazard.upvotes >= 3 and hazard.status == "Pending":
        hazard.status = "Verified"
        print(f"[HAZARD] id={hazard_id} auto-verified after {hazard.upvotes} upvotes")

    db.session.commit()

    updated_data = hazard.to_dict()

    # Broadcast updated hazard so map markers refresh immediately
    socketio.emit("hazard_updated", updated_data)
    print(f"[SOCKET] Emitted 'hazard_updated' event → id={hazard_id}, "
          f"upvotes={hazard.upvotes}, status={hazard.status}")

    return jsonify({
        "message": f"Upvoted hazard id={hazard_id}",
        "hazard":  updated_data
    }), 200


# ============================================================
# PHASE 4 — STEP 4.2 : RISK-AVERSE A* ROUTING ENDPOINTS
# ============================================================

# Lazy-load the graph singleton — expensive (several seconds) so we do it
# only on the first routing request, not at server startup.
_router_graph = None

def _get_router_graph():
    """Return the annotated road-network graph, loading it on first call."""
    global _router_graph
    if _router_graph is None:
        try:
            from risk_router import load_graph
            print("[ROUTER] Loading Nagpur road network graph (first request)...")
            _router_graph = load_graph()
            print(f"[ROUTER] Graph ready: {_router_graph.number_of_nodes():,} nodes, "
                  f"{_router_graph.number_of_edges():,} edges")
        except FileNotFoundError as e:
            print(f"[ROUTER][ERROR] {e}")
            _router_graph = None
        except Exception as e:
            print(f"[ROUTER][ERROR] Failed to load graph: {e}")
            _router_graph = None
    return _router_graph


@app.route("/api/route", methods=["GET", "POST"])
def safe_route():
    """
    GET  /api/route?start=<lat>,<lng>&end=<lat>,<lng>[&risk_penalty=<n>]
    POST /api/route   JSON body: { origin_lat, origin_lng, dest_lat, dest_lng, risk_penalty? }

    Compute the safest driving route between two coordinates using
    A* with risk-weighted edge costs (Phase 4 – Step 4.3).

    GET query params (Step 4.3 spec):
        start        "21.1481,79.0862"   comma-separated lat,lng   REQUIRED
        end          "21.1700,79.0900"   comma-separated lat,lng   REQUIRED
        risk_penalty  500                penalty metres per risk unit (optional)

    POST JSON body (kept for backwards compatibility):
        { "origin_lat": ..., "origin_lng": ..., "dest_lat": ..., "dest_lng": ...,
          "risk_penalty": 500 }

    Returns 200:
        {
          "success":           true,
          "route_coords":      [[lat, lng], ...],   <- draw this with Leaflet Polyline
          "total_distance_km": 3.2,
          "avg_risk_score":    0.31,
          "risk_level":        "Medium",
          "num_waypoints":     48,
          ...
        }
    Returns 400 on bad params, 422 if no path found, 503 if graph unavailable.
    """
    # ---- 1. Parse inputs (GET query string OR POST JSON body) ---------------
    if request.method == "GET":
        start_raw = request.args.get("start", "")
        end_raw   = request.args.get("end",   "")
        try:
            slat, slng = [float(x) for x in start_raw.split(",")]
            elat, elng = [float(x) for x in end_raw.split(",")]
        except (ValueError, AttributeError):
            return jsonify({
                "error": "Query params 'start' and 'end' must be 'lat,lng' e.g. ?start=21.14,79.08&end=21.17,79.09"
            }), 400
        risk_penalty = float(request.args.get("risk_penalty", 500))
        origin_lat, origin_lng, dest_lat, dest_lng = slat, slng, elat, elng

    else:  # POST
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be JSON"}), 400
        try:
            origin_lat = float(data["origin_lat"])
            origin_lng = float(data["origin_lng"])
            dest_lat   = float(data["dest_lat"])
            dest_lng   = float(data["dest_lng"])
        except (KeyError, ValueError, TypeError):
            return jsonify({
                "error": "'origin_lat', 'origin_lng', 'dest_lat', 'dest_lng' are required numeric fields"
            }), 400
        risk_penalty = float(data.get("risk_penalty", 500))

    # ---- 2. Load graph (lazy singleton) ------------------------------------
    G = _get_router_graph()
    if G is None:
        return jsonify({
            "error": "Road network graph is not available. Run download_nagpur_graph.py first."
        }), 503

    # ---- 3. Run A* with risk weights ----------------------------------------
    from risk_router import compute_safe_route
    result = compute_safe_route(
        G,
        origin_lat=origin_lat, origin_lng=origin_lng,
        dest_lat=dest_lat,     dest_lng=dest_lng,
        risk_penalty=risk_penalty,
    )

    if not result.get("success"):
        return jsonify({"error": result.get("error", "Routing failed")}), 422

    print(f"[ROUTE] {origin_lat},{origin_lng} -> {dest_lat},{dest_lng} | "
          f"{result['total_distance_km']} km | risk={result['avg_risk_score']:.3f} ({result['risk_level']})")
    return jsonify(result), 200


@app.route("/api/route/compare", methods=["POST"])
def compare_routes_endpoint():
    """
    POST /api/route/compare
    Run BOTH the safety-first A* route and the classic shortest-distance
    route and return them side-by-side with a comparison summary.

    Expected JSON body:
        {
            "origin_lat": 21.1481,
            "origin_lng": 79.0862,
            "dest_lat":   21.1700,
            "dest_lng":   79.0900
        }

    Returns:
        200 - { safe_route, short_route, comparison }
        400 - validation error
        503 - graph not available
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        origin_lat = float(data["origin_lat"])
        origin_lng = float(data["origin_lng"])
        dest_lat   = float(data["dest_lat"])
        dest_lng   = float(data["dest_lng"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "'origin_lat', 'origin_lng', 'dest_lat', 'dest_lng' are required"}), 400

    G = _get_router_graph()
    if G is None:
        return jsonify({
            "error": "Road network graph is not available. Run download_nagpur_graph.py first."
        }), 503

    from risk_router import compare_routes
    result = compare_routes(G, origin_lat, origin_lng, dest_lat, dest_lng)

    comp = result.get("comparison", {})
    print(f"[COMPARE] {origin_lat},{origin_lng} -> {dest_lat},{dest_lng} | "
          f"extra={comp.get('extra_distance_m', 'N/A')} m | "
          f"risk_reduction={comp.get('risk_reduction_pct', 'N/A')} %")
    return jsonify(result), 200


# ============================================================
# PHASE 5.3 — SAFE DRIVING SCORE ENDPOINTS
# ============================================================

@app.route("/api/score/deduct", methods=["POST"])
@jwt_required()
def deduct_score():
    """
    POST /api/score/deduct
    Deduct points from the authenticated user's driving score.
    Called by the frontend when the driver speeds inside a High-Risk zone.

    Body (JSON):
        {
            "deduction": 5,                    <- points to subtract (1-20)
            "reason":    "Speeding in zone",   <- human-readable reason
            "zone":      "Sitabuldi Junction",  <- location name
            "speed_kmh": 73.4                   <- actual speed
        }

    Returns 200:
        { "new_score": 85, "deduction": 5, "message": "Score updated" }
    """
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    try:
        deduction = max(1, min(int(data.get("deduction", 5)), 20))  # clamp 1-20
    except (ValueError, TypeError):
        deduction = 5

    reason    = str(data.get("reason",   "Unsafe driving"))[:255]
    zone      = str(data.get("zone",     ""))[:255] or None
    speed_kmh = float(data.get("speed_kmh", 0))

    # Apply deduction (floor at 0)
    user.driving_score = max(0, user.driving_score - deduction)

    # Audit log
    event = ScoreEvent(
        user_id   = user.id,
        deduction = deduction,
        reason    = reason,
        zone      = zone,
        speed_kmh = speed_kmh,
        new_score = user.driving_score,
    )
    db.session.add(event)
    db.session.commit()

    print(f"[SCORE] User {user.name} (id={user.id}): -{deduction} pts -> {user.driving_score} "
          f"(speed={speed_kmh:.1f} km/h in '{zone}')")
    return jsonify({
        "new_score": user.driving_score,
        "deduction": deduction,
        "message":   "Score updated",
    }), 200


@app.route("/api/score/me", methods=["GET"])
@jwt_required()
def my_score():
    """
    GET /api/score/me
    Return the current user's driving score and recent events.
    """
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    events = (
        ScoreEvent.query
        .filter_by(user_id=user_id)
        .order_by(ScoreEvent.created_at.desc())
        .limit(10)
        .all()
    )
    return jsonify({
        "driving_score": user.driving_score,
        "name":          user.name,
        "recent_events": [e.to_dict() for e in events],
    }), 200


@app.route("/api/leaderboard", methods=["GET"])
def leaderboard():
    """
    GET /api/leaderboard
    Public endpoint — returns all users ranked by driving_score descending.

    Query params:
        limit  (int, default 50)  — max rows to return
    """
    limit = min(int(request.args.get("limit", 50)), 200)
    users = (
        User.query
        .order_by(User.driving_score.desc(), User.name.asc())
        .limit(limit)
        .all()
    )
    board = [
        {
            "rank":          idx + 1,
            "name":          u.name,
            "driving_score": u.driving_score,
            "badge":         (
                "Elite" if u.driving_score >= 95 else
                "Safe"  if u.driving_score >= 80 else
                "Fair"  if u.driving_score >= 60 else
                "Risky"
            ),
        }
        for idx, u in enumerate(users)
    ]
    return jsonify({"leaderboard": board, "total": len(board)}), 200


# ============================================================
# PHASE 6.1 — ADMIN ANALYTICS ENDPOINT
# ============================================================

def _require_admin():
    """
    Helper: verify the JWT token belongs to a user with role='admin'.
    Returns (user, None) on success or (None, error_response) on failure.
    """
    from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
    try:
        verify_jwt_in_request()
    except Exception:
        return None, (jsonify({"error": "Authentication required"}), 401)
    user = User.query.get(int(get_jwt_identity()))
    if not user:
        return None, (jsonify({"error": "User not found"}), 404)
    if user.role != "admin":
        return None, (jsonify({"error": "Admin access required"}), 403)
    return user, None


@app.route("/api/admin/analytics", methods=["GET"])
def admin_analytics():
    """
    GET /api/admin/analytics
    Protected: JWT required + role == 'admin'

    Returns pre-aggregated analytics data for the Recharts dashboard:
        {
          accidents_by_hour : [{hour, count, high, medium, low}, ...],  (24 entries)
          hazards_by_type   : [{type, count}, ...],
          risk_by_road      : [{road_type, High, Medium, Low}, ...],
          weather_breakdown : [{weather, count}, ...],
          total_users       : int,
          total_hazards     : int,
        }
    """
    admin, err = _require_admin()
    if err:
        return err

    # ---- Accidents by hour of day (from CSV dataset) -----------------------
    hour_buckets = {h: {"hour": h, "count": 0, "High": 0, "Medium": 0, "Low": 0}
                    for h in range(24)}
    for row in dataset:
        try:
            h = int(row.get("time_of_day", 0)) % 24
            rl = str(row.get("risk_level", "Low"))
            hour_buckets[h]["count"] += 1
            if rl in hour_buckets[h]:
                hour_buckets[h][rl] += 1
        except (ValueError, TypeError):
            continue
    accidents_by_hour = list(hour_buckets.values())

    # ---- Hazards by type (from ReportedHazard DB table) --------------------
    from sqlalchemy import func
    hazard_counts = (
        db.session.query(ReportedHazard.hazard_type, func.count(ReportedHazard.id))
        .group_by(ReportedHazard.hazard_type)
        .all()
    )
    hazards_by_type = [{"type": ht, "count": cnt} for ht, cnt in hazard_counts]

    # ---- Risk by road type -------------------------------------------------
    road_map = {}
    for row in dataset:
        rt = str(row.get("road_type", "Unknown"))
        rl = str(row.get("risk_level", "Low"))
        if rt not in road_map:
            road_map[rt] = {"road_type": rt, "High": 0, "Medium": 0, "Low": 0}
        if rl in road_map[rt]:
            road_map[rt][rl] += 1
    risk_by_road = list(road_map.values())

    # ---- Weather breakdown -------------------------------------------------
    weather_map = {}
    for row in dataset:
        w = str(row.get("weather", "Unknown"))
        weather_map[w] = weather_map.get(w, 0) + 1
    weather_breakdown = [{"weather": w, "count": c} for w, c in weather_map.items()]

    total_users   = User.query.count()
    total_hazards = ReportedHazard.query.count()

    print(f"[ANALYTICS] Admin {admin.name} fetched analytics")
    return jsonify({
        "accidents_by_hour": accidents_by_hour,
        "hazards_by_type":   hazards_by_type,
        "risk_by_road":      risk_by_road,
        "weather_breakdown": weather_breakdown,
        "total_users":       total_users,
        "total_hazards":     total_hazards,
    }), 200


if __name__ == "__main__":

    print("[START] SafeRoute AI Backend -> http://localhost:5000  (WebSocket ready)")
    # Use socketio.run() instead of app.run() so the WebSocket
    # transport layer (Engine.IO) is active alongside regular HTTP.
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
