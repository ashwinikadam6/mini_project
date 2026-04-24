"""
final_restore.py
Complete restoration of all UI-visible text in App.jsx.
Handles icons, em-dashes, separators, and comment decorators.
"""
import pathlib, re, sys

TARGET = pathlib.Path("frontend/src/App.jsx")
text = TARGET.read_text("utf-8")

FIXES = {
    # ── KPI card icons (unique by color) ─────────────────────────────
    'color: "#3b82f6", icon: "???" }':    'color: "#3b82f6", icon: "\U0001f4ca" }',  # 📊
    'color: "#ef4444", icon: "???" }':    'color: "#ef4444", icon: "\U0001f534" }',  # 🔴
    'color: "#f59e0b", icon: "???" }':    'color: "#f59e0b", icon: "\U0001f7e1" }',  # 🟡
    'color: "#10b981", icon: "???" }':    'color: "#10b981", icon: "\U0001f7e2" }',  # 🟢
    'color: "#8b5cf6", icon: "???" }':    'color: "#8b5cf6", icon: "\U0001f4c9" }',  # 📉
    'color: "#06b6d4", icon: "???" }':    'color: "#06b6d4", icon: "\U0001f465" }',  # 👥
    'color: "#ec4899", icon: "???" }':    'color: "#ec4899", icon: "\u26a0\ufe0f" }',# ⚠️
    # ── Admin page header ─────────────────────────────────────────────
    '>??? Admin Analytics Dashboard</h2>':  '>\U0001f3db Admin Analytics Dashboard</h2>',  # 🏛
    '>?? Admin Analytics Dashboard</h2>':   '>\U0001f3db Admin Analytics Dashboard</h2>',
    # ── Admin tabs ───────────────────────────────────────────────────
    '"?? Charts"':       '"\U0001f4c8 Charts"',      # 📈
    '"?? Blackspots"':   '"\U0001f5fa Blackspots"',  # 🗺
    '"?? Dataset"':      '"\U0001f5c3 Dataset"',     # 🗃
    # ── Role guard lock ──────────────────────────────────────────────
    '<div style={{ fontSize: 64 }}>???</div>': '<div style={{ fontSize: 64 }}>\U0001f512</div>',  # 🔒
    # ── Leaderboard ──────────────────────────────────────────────────
    '>?? Safe Driving Leaderboard</h1>':
        '>\U0001f3c6 Safe Driving Leaderboard</h1>',  # 🏆
    '>\U0001f3c6 Safe Driving Leaderboard</h1>':
        '>\U0001f3c6 Safe Driving Leaderboard</h1>',  # already fixed
    '>??? Refresh':       '>\U0001f504 Refresh',       # 🔄
    # Medal emojis
    'rank === 1 ? "???" : rank === 2 ? "???" : rank === 3 ? "???"':
        'rank === 1 ? "\U0001f947" : rank === 2 ? "\U0001f948" : rank === 3 ? "\U0001f949"',
    # ── Geofence alert ───────────────────────────────────────────────
    '}>???<':                              '}>\u26a0\ufe0f<',   # ⚠️ (pulse icon)
    '>??? {geoAlert.location}':            '>\U0001f4cd {geoAlert.location}',  # 📍
    '>??? You have arrived safely!</div>': '>\U0001f389 You have arrived safely!</div>',  # 🎉
    # ── Navigation - Live GPS button ─────────────────────────────────
    '??? Live GPS<br/>':                   '\U0001f4cd Live GPS<br/>',   # 📍
    '??? Live GPS':                        '\U0001f4cd Live GPS',
    # ── PDF button ───────────────────────────────────────────────────
    ': <>??? Download PDF Report</>':      ': <>\U0001f4c4 Download PDF Report</>',  # 📄
    # ── Em-dashes in JS strings ──────────────────────────────────────
    ': "???"':                             ': "\u2014"',    # — (em-dash)
    '?? "???"':                            '?? "\u2014"',
    'Analytics Dashboard\u003c/h2>':       'Analytics Dashboard</h2>',  # fix &lt;
    # Platform dot separator
    'Intelligence Platform ?? <span':       'Intelligence Platform \u00b7 <span',  # ·
    'Intelligence Platform\n              Nagpur': 'Intelligence Platform\n              Nagpur',
    # Routing error message
    '"Routing failed ??? is the backend running?"':
        '"Routing failed \u2014 is the backend running?"',
    # PDF text
    'SafeRoute AI ??? Powered by Random Forest':
        'SafeRoute AI \u2014 Powered by Random Forest',
    'SafeRoute AI ??? ${month}':
        'SafeRoute AI \u2014 ${month}',
    'Confidential ??? City Planners Only':
        'Confidential \u2014 City Planners Only',
    # Badge separator
    '`${badge} ?? ${range}`':             '`${badge} \u00b7 ${range}`',
    '{badge} ?? {range}':                 '{badge} \u00b7 {range}',
    # Safety tip
    'Reduce speed ?? Stay alert ?? Watch for hazards':
        'Reduce speed \u00b7 Stay alert \u00b7 Watch for hazards',
    # Comment decorators (use simple ASCII so they still look OK)
    # Leave ??? in comments as-is — not user-visible
    # Password placeholders
    'placeholder="????????"':             'placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"',
}

applied = 0
for bad, good in FIXES.items():
    if bad in text and bad != good:
        n = text.count(bad)
        text = text.replace(bad, good)
        applied += n
        print(f"  {n}x  {repr(bad[:55])}")

# Replace ??? inside JSX string literals (between quotes) with em-dash
# Only in value positions, not comments
text = re.sub(r'(?<=["\`])\?\?\?(?=["\`])', '\u2014', text)

# Replace ??? between > and < (JSX text node) with empty string
# These are comment art decorators — strip them
text = re.sub(r'//\s*\?+[^\\n]*', lambda m: '//' + re.sub(r'\?+', '', m.group()[2:]), text)

TARGET.write_text(text, encoding="utf-8")
print(f"\n[DONE] {applied} explicit patches. File: {TARGET.stat().st_size:,} bytes")

remaining = text.count("???")
print(f"[INFO] Remaining visible ??? groups: {remaining}")
