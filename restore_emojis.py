"""
restore_emojis.py
Puts back every emoji that was lost during the encoding corruption.
Uses context strings to find exact positions.
"""
import pathlib

TARGET = pathlib.Path("frontend/src/App.jsx")
text = TARGET.read_text("utf-8")

# Each tuple: (corrupted_fragment, corrected_fragment)
# We use surrounding ASCII context to make replacements unique and safe.
PATCHES = [
    # KPI cards - icon values
    ('color: "#3b82f6", icon: "???" }',     'color: "#3b82f6", icon: "📊" }'),
    ('color: "#ef4444", icon: "???" }',     'color: "#ef4444", icon: "🔴" }'),
    ('color: "#f59e0b", icon: "???" }',     'color: "#f59e0b", icon: "🟡" }'),
    ('color: "#10b981", icon: "???" }',     'color: "#10b981", icon: "🟢" }'),
    ('color: "#8b5cf6", icon: "???" }',     'color: "#8b5cf6", icon: "📉" }'),
    ('color: "#06b6d4", icon: "???" }',     'color: "#06b6d4", icon: "👥" }'),
    ('color: "#ec4899", icon: "???" }',     'color: "#ec4899", icon: "⚠️" }'),

    # AdminDashboard header
    ('>?? Admin Analytics Dashboard</h2>',   '>🏛 Admin Analytics Dashboard</h2>'),

    # Admin nav tab
    ('{ id: "admin",       label: "Admin",        icon: Icon.Admin }',
     '{ id: "admin",       label: "Admin",        icon: Icon.Admin }'),  # no emoji here

    # Tabs labels
    ('"?? Charts"',   '"📈 Charts"'),
    ('"?? Blackspots"', '"🗺 Blackspots"'),
    ('"?? Dataset"',  '"🗃 Dataset"'),

    # Leaderboard
    ('> Safe Driving Leaderboard</h1>',   '> Safe Driving Leaderboard</h1>'),  # emoji before it
    ('<h1 style={{ fontSize: 28, marginBottom: 4 }}>?? Safe Driving Leaderboard</h1>',
     '<h1 style={{ fontSize: 28, marginBottom: 4 }}>🏆 Safe Driving Leaderboard</h1>'),
    ('Refresh\n          </button>',  'Refresh\n          </button>'),  # no emoji
    ('>?? Refresh<',  '>🔄 Refresh<'),
    ('>?? {geoAlert.location}',  '>📍 {geoAlert.location}'),

    # Geofence alert
    ('style={{ fontSize: 36, animation: "pulse 0.8s ease-in-out infinite" }}>??<',
     'style={{ fontSize: 36, animation: "pulse 0.8s ease-in-out infinite" }}>⚠️<'),

    # Navigation arrived overlay
    ('>?? You have arrived safely!</div>',
     '>🎉 You have arrived safely!</div>'),

    # Route card icons / step markers (3 step indicators)
    ('"step-dot">1</div>', '"step-dot">1</div>'),

    # PDF button
    (': <>?? Download PDF Report</>',
     ': <>📄 Download PDF Report</>'),

    # Dashboard emergency services
    ('"???"',  '"???"'),  # skip generic

    # Download PDF tooltip
    ('??  Download PDF Report', '📄  Download PDF Report'),

    # Admin page lock icon
    ('fontSize: 64 }}>??</div>',
     'fontSize: 64 }}>🔒</div>'),

    # Risk page / dashboard cards
    ('Reduce speed ?? Stay alert ?? Watch for hazards',
     'Reduce speed · Stay alert · Watch for hazards'),

    # Navigation em-dashes
    ('dist: safeRes  ? `${safeRes.total_distance_km} km`  : "???"',
     'dist: safeRes  ? `${safeRes.total_distance_km} km`  : "—"'),
    ('time: safeRes  ? `~${Math.round(safeRes.total_distance_km / 0.3)} min` : "???"',
     'time: safeRes  ? `~${Math.round(safeRes.total_distance_km / 0.3)} min` : "—"'),
    ('dist: shortRes ? `${shortRes.total_distance_km} km` : "???"',
     'dist: shortRes ? `${shortRes.total_distance_km} km` : "—"'),
    ('time: shortRes ? `~${Math.round(shortRes.total_distance_km / 0.35)} min` : "???"',
     'time: shortRes ? `~${Math.round(shortRes.total_distance_km / 0.35)} min` : "—"'),

    # Leaderboard score "—"
    ('analytics?.total_users   ?? "???"', 'analytics?.total_users   ?? "—"'),
    ('analytics?.total_hazards ?? "???"', 'analytics?.total_hazards ?? "—"'),
    ('analytics?.total_users  ?? "???"',  'analytics?.total_users  ?? "—"'),
    ('analytics?.total_hazards ?? "???"', 'analytics?.total_hazards ?? "—"'),

    # Medal emojis in Leaderboard
    ("rank === 1 ? \"???\" : rank === 2 ? \"???\" : rank === 3 ? \"???\"",
     "rank === 1 ? \"🥇\" : rank === 2 ? \"🥈\" : rank === 3 ? \"🥉\""),

    # Score event "Your Score" area badge
    # (no emojis there, just text)

    # Admin header platform text  ·
    ('Intelligence Platform ?? <span style={{ color: "#10b981" }}',
     'Intelligence Platform · <span style={{ color: "#10b981" }}'),

    # Nagpur Road Safety Intelligence Platform ·
    ('Intelligence Platform ?? <span',
     'Intelligence Platform · <span'),

    # em dash in PDF footer
    ('SafeRoute AI ??? Powered by Random Forest',
     'SafeRoute AI — Powered by Random Forest'),
    ('SafeRoute AI ??? ${month}',
     'SafeRoute AI — ${month}'),
    ("Confidential ??? City Planners Only",
     "Confidential — City Planners Only"),

    # Leaderboard badge range separator
    ("badge} ?? {range}",
     "badge} · {range}"),

    # Navigation safety tip
    ("Reduce speed ?? Stay alert ?? Watch for hazards",
     "Reduce speed · Stay alert · Watch for hazards"),
    ("Reduce speed \u00b7 Stay alert \u00b7 Watch for hazards",
     "Reduce speed · Stay alert · Watch for hazards"),

    # Speed deduction log
    ('console.log(`[SCORE] -${deduction} pts ???> ${res.new_score}',
     'console.log(`[SCORE] -${deduction} pts -> ${res.new_score}'),

    # Routing failed error message
    ('"Routing failed ??? is the backend running?"',
     '"Routing failed — is the backend running?"'),

    # General em-dash replacement for remaining ???
    # (Only in string literals — be careful)
]

count = 0
for bad, good in PATCHES:
    if bad in text and bad != good:
        n = text.count(bad)
        text = text.replace(bad, good)
        count += n
        print(f"  {n}x  fixed: {repr(bad[:50])}")

# Bulk replace remaining ??? -> — in string literals only (JS string context)
import re
before = text
# ??? between quotes
text = re.sub(r'(?<=["\x60])\?\?\?(?=["\x60])', '—', text)
misc_fixes = len([m for m in re.finditer(r'\?\?\?', before) if m not in re.finditer(r'\?\?\?', text)])

TARGET.write_text(text, encoding="utf-8")
print(f"\n[DONE] {count} patches applied. File: {TARGET.stat().st_size:,} bytes")

# Final check - count remaining ???
remaining = text.count("???")
print(f"[INFO] Remaining ??? in file: {remaining}")
if remaining > 0:
    for m in re.finditer(r'.{0,30}\?\?\?.{0,30}', text):
        print(f"       {repr(m.group())}")
