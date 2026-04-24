"""
SafeRoute AI - Database Models
SQLAlchemy ORM definitions for all database tables.
"""

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class User(db.Model):
    """Stores registered user accounts."""
    __tablename__ = "users"

    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(100), nullable=False)
    email         = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    # Phase 5.3 — Safe Driving Score (100 = perfect, 0 = worst)
    driving_score = db.Column(db.Integer, default=100, nullable=False)

    # Phase 6.1 — Role-based access ('user' | 'admin')
    role          = db.Column(db.String(20), default="user", nullable=False)

    # Relationship back to reported hazards
    hazards = db.relationship("ReportedHazard", backref="reporter", lazy=True)

    def to_dict(self):
        return {
            "id":            self.id,
            "name":          self.name,
            "email":         self.email,
            "driving_score": self.driving_score,
            "role":          self.role,
            "created_at":    self.created_at.isoformat()
        }


class AccidentRecord(db.Model):
    """Historical accident records migrated from the CSV dataset."""
    __tablename__ = "accident_records"

    id              = db.Column(db.Integer, primary_key=True)
    location        = db.Column(db.String(255))
    latitude        = db.Column(db.Float, nullable=False)
    longitude       = db.Column(db.Float, nullable=False)
    time_of_day     = db.Column(db.Integer)          # 0–23 hour
    weather         = db.Column(db.String(50))
    road_type       = db.Column(db.String(50))
    traffic_density = db.Column(db.String(20))        # Low / Medium / High
    accident_count  = db.Column(db.Integer, default=0)
    risk_level      = db.Column(db.String(20))        # Low / Medium / High
    recorded_at     = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":              self.id,
            "location":        self.location,
            "latitude":        self.latitude,
            "longitude":       self.longitude,
            "time_of_day":     self.time_of_day,
            "weather":         self.weather,
            "road_type":       self.road_type,
            "traffic_density": self.traffic_density,
            "accident_count":  self.accident_count,
            "risk_level":      self.risk_level,
        }


class ReportedHazard(db.Model):
    """User-reported hazards (potholes, road closures, fresh accidents, etc.)"""
    __tablename__ = "reported_hazards"

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    latitude    = db.Column(db.Float, nullable=False)
    longitude   = db.Column(db.Float, nullable=False)
    hazard_type = db.Column(db.String(50), nullable=False)  # Pothole / Accident / Road Closure / Waterlogging
    description = db.Column(db.Text)
    status      = db.Column(db.String(20), default="Pending")  # Pending / Verified / Rejected
    upvotes     = db.Column(db.Integer, default=0)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":          self.id,
            "user_id":     self.user_id,
            "latitude":    self.latitude,
            "longitude":   self.longitude,
            "hazard_type": self.hazard_type,
            "description": self.description,
            "status":      self.status,
            "upvotes":     self.upvotes,
            "created_at":  self.created_at.isoformat()
        }


class ScoreEvent(db.Model):
    """
    Phase 5.3 — Audit log of every driving score deduction.
    Records why, how much, and in which high-risk zone the penalty occurred.
    """
    __tablename__ = "score_events"

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    deduction   = db.Column(db.Integer, nullable=False)          # points deducted (positive number)
    reason      = db.Column(db.String(255), nullable=False)      # e.g. "Speeding in high-risk zone"
    zone        = db.Column(db.String(255))                      # location name
    speed_kmh   = db.Column(db.Float)                            # driver speed at time of event
    new_score   = db.Column(db.Integer, nullable=False)          # score after deduction
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":         self.id,
            "user_id":    self.user_id,
            "deduction":  self.deduction,
            "reason":     self.reason,
            "zone":       self.zone,
            "speed_kmh":  self.speed_kmh,
            "new_score":  self.new_score,
            "created_at": self.created_at.isoformat(),
        }
