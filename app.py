"""
SafeRoute AI - Flask Backend API
Run: python app.py
Requires: pip install flask flask-cors joblib scikit-learn pandas numpy flask-sqlalchemy flask-jwt-extended bcrypt python-dotenv requests

Step 1.3 - Authentication API
  - POST /api/register  → hash password with bcrypt, save user to SQLite
  - POST /api/login     → verify password, return JWT access_token

Step 2.1 - Live API Integration
  - GET  /api/live-weather  → proxies OpenWeatherMap (OPENWEATHER_API_KEY in .env)
  - GET  /api/live-traffic  → proxies TomTom Traffic   (TOMTOM_API_KEY in .env)

Step 2.2 - Backend API Wrapper Functions
  - get_live_weather(lat, lng) → reusable helper; returns weather dict or raises
  - get_live_traffic(lat, lng) → reusable helper; returns traffic dict or raises
  - /api/predict now accepts auto_live=true to skip manual weather/traffic inputs
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
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
import bcrypt, requests
import joblib, numpy as np, pandas as pd, json
from datetime import datetime
from models import db, User, AccidentRecord, ReportedHazard

app = Flask(__name__)

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

    # -- Persist user -----------------------------------------
    user = User(name=name, email=email, password_hash=pw_hash)
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


if __name__ == "__main__":
    print("[START] SafeRoute AI Backend -> http://localhost:5000")
    app.run(debug=True, port=5000)
