"""
SafeRoute AI - Flask Backend API
Run: python app.py
Requires: pip install flask flask-cors joblib scikit-learn pandas numpy flask-sqlalchemy flask-jwt-extended bcrypt python-dotenv
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import joblib, numpy as np, pandas as pd, json, os
from models import db, User, AccidentRecord, ReportedHazard

app = Flask(__name__)

# ============================================================
# DATABASE CONFIGURATION (SQLite)
# ============================================================
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///saferoute.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

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



@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "dataset_size": len(dataset)
    })

@app.route("/api/predict", methods=["POST"])
def predict():
    if not MODEL_LOADED:
        return jsonify({"error": "Model not loaded. Run ml_model.py first."}), 503

    data = request.get_json()

    try:
        hour = int(data["time_of_day"])

        w_enc = le_weather.transform([data["weather"]])[0]
        r_enc = le_road.transform([data["road_type"]])[0]
        d_enc = le_density.transform([data["traffic_density"]])[0]

        features_df = pd.DataFrame([{
            "latitude": float(data["latitude"]),
            "longitude": float(data["longitude"]),
            "time_of_day": hour,
            "weather_enc": w_enc,
            "road_enc": r_enc,
            "density_enc": d_enc,
            "accident_count": int(data.get("accident_count", 5)),
            "is_night": 1 if (hour >= 20 or hour <= 5) else 0,
            "is_peak": 1 if ((8 <= hour <= 10) or (17 <= hour <= 20)) else 0,
            "is_bad_weather": 1 if data["weather"] in ("Rain", "Fog", "Haze") else 0
        }])

        probas = model.predict_proba(features_df)[0]
        classes = le_risk.classes_
        pred_idx = np.argmax(probas)

        return jsonify({
            "risk_level": classes[pred_idx],
            "probabilities": {c: round(float(p)*100, 1) for c, p in zip(classes, probas)},
            "confidence": round(float(probas[pred_idx])*100, 1)
        })

    except Exception as e:
        print("❌ Predict error:", str(e))
        return jsonify({"error": str(e)}), 500

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

if __name__ == "__main__":
    print("🚀 SafeRoute AI Backend → http://localhost:5000")
    app.run(debug=True, port=5000)
