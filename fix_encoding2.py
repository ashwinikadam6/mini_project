"""
fix_encoding2.py
Replaces all known mojibake sequences and U+FFFD replacement chars
with the correct Unicode characters.
"""
import pathlib, re

TARGET = pathlib.Path("frontend/src/App.jsx")
text   = TARGET.read_text(encoding="utf-8", errors="replace")

# Mapping: corrupted string -> correct Unicode
# Generated from: original UTF-8 bytes read as Windows-1252
FIXES = [
    # ── em-dash and related ────────────────────────────────
    ("\u00e2\u0080\u0094", "\u2014"),   # â€" -> —  (em-dash)
    ("\u00e2\u0080\u009c", "\u201c"),   # â€œ -> "
    ("\u00e2\u0080\u009d", "\u201d"),   # â€  -> "
    ("\u00e2\u0080\u0099", "\u2019"),   # â€™ -> '
    ("\u00e2\u0080\u00a6", "\u2026"),   # â€¦ -> …
    ("\u00c2\u00b7",       "\u00b7"),   # Â· -> ·  (middle dot)
    ("\u00c2\u00a0",       "\u00a0"),   # Â  -> non-breaking space
    ("\u00e2\u0080\u0093", "\u2013"),   # â€" -> –  (en-dash)

    # ── Emoji (4-byte UTF-8, read as 4 Windows-1252 chars) ─
    # Formula: take the UTF-8 bytes, treat each as win-1252, get the chars
    # 📊 F0 9F 93 8A  -> ðŸ"Š
    ("\u00f0\u009f\u0093\u008a", "\U0001f4ca"),  # 📊
    # 🔴 F0 9F 94 B4  -> ðŸ"´
    ("\u00f0\u009f\u0094\u00b4", "\U0001f534"),  # 🔴
    # 🟡 F0 9F 9F A1  -> ðŸŸ¡
    ("\u00f0\u009f\u009f\u00a1", "\U0001f7e1"),  # 🟡
    # 🟢 F0 9F 9F A2  -> ðŸŸ¢
    ("\u00f0\u009f\u009f\u00a2", "\U0001f7e2"),  # 🟢
    # 📉 F0 9F 93 89  -> ðŸ"‰
    ("\u00f0\u009f\u0093\u0089", "\U0001f4c9"),  # 📉
    # 👥 F0 9F 91 A5  -> ðŸ'¥
    ("\u00f0\u009f\u0091\u00a5", "\U0001f465"),  # 👥
    # ⚠️  E2 9A A0 EF B8 8F  -> âš ï¸
    ("\u00e2\u009a\u00a0\u00ef\u00b8\u008f", "\u26a0\ufe0f"),  # ⚠️
    # 🏛 F0 9F 8F 9B  -> ðŸ›
    ("\u00f0\u009f\u008f\u009b", "\U0001f3db"),  # 🏛
    # 📈 F0 9F 93 88  -> ðŸ"ˆ
    ("\u00f0\u009f\u0093\u0088", "\U0001f4c8"),  # 📈
    # 🗺 F0 9F 97 BA  -> ðŸ—º
    ("\u00f0\u009f\u0097\u00ba", "\U0001f5fa"),  # 🗺
    # 🗃 F0 9F 97 83  -> ðŸ—ƒ
    ("\u00f0\u009f\u0097\u0083", "\U0001f5c3"),  # 🗃
    # 🔒 F0 9F 94 92  -> ðŸ"'
    ("\u00f0\u009f\u0094\u0092", "\U0001f512"),  # 🔒
    # 📄 F0 9F 93 84  -> ðŸ"„
    ("\u00f0\u009f\u0093\u0084", "\U0001f4c4"),  # 📄
    # 📍 F0 9F 93 8D  -> ðŸ"
    ("\u00f0\u009f\u0093\u008d", "\U0001f4cd"),  # 📍
    # 📦 F0 9F 93 A6  -> ðŸ"¦
    ("\u00f0\u009f\u0093\u00a6", "\U0001f4e6"),  # 📦
    # 🔄 F0 9F 94 84  -> ðŸ"„ (note: different from 📄)
    ("\u00f0\u009f\u0094\u0084", "\U0001f504"),  # 🔄
    # 🏆 F0 9F 8F 86  -> ðŸŽ
    ("\u00f0\u009f\u008f\u0086", "\U0001f3c6"),  # 🏆
    # 🥇 F0 9F A5 87  -> ðŸ¥‡
    ("\u00f0\u009f\u00a5\u0087", "\U0001f947"),  # 🥇
    # 🥈 F0 9F A5 88  -> ðŸ¥ˆ
    ("\u00f0\u009f\u00a5\u0088", "\U0001f948"),  # 🥈
    # 🥉 F0 9F A5 89  -> ðŸ¥‰
    ("\u00f0\u009f\u00a5\u0089", "\U0001f949"),  # 🥉
    # ⭐ E2 AD 90  -> â­
    ("\u00e2\u00ad\u0090", "\u2b50"),  # ⭐
    # 🎉 F0 9F 8E 89  -> ðŸŽ‰
    ("\u00f0\u009f\u008e\u0089", "\U0001f389"),  # 🎉
    # ⚡ E2 9A A1  -> âš¡
    ("\u00e2\u009a\u00a1", "\u26a1"),  # ⚡
    # 🌧 F0 9F 8C A7  -> ðŸŒ§
    ("\u00f0\u009f\u008c\u00a7", "\U0001f327"),  # 🌧
    # 🌤 F0 9F 8C A4  -> ðŸŒ¤
    ("\u00f0\u009f\u008c\u00a4", "\U0001f324"),  # 🌤
    # 🌩 F0 9F 8C A9  -> ðŸŒ©
    ("\u00f0\u009f\u008c\u00a9", "\U0001f329"),  # 🌩
    # 🌫 F0 9F 8C AB  -> ðŸŒ«
    ("\u00f0\u009f\u008c\u00ab", "\U0001f32b"),  # 🌫
    # 🌞 F0 9F 8C 9E  -> ðŸŒž
    ("\u00f0\u009f\u008c\u009e", "\U0001f31e"),  # 🌞
    # 🌪 F0 9F 8C AA  -> ðŸŒª
    ("\u00f0\u009f\u008c\u00aa", "\U0001f32a"),  # 🌪
    # 🌡 F0 9F 8C A1  -> ðŸŒ¡
    ("\u00f0\u009f\u008c\u00a1", "\U0001f321"),  # 🌡
    # 🚗 F0 9F 9A 97  -> ðŸš—
    ("\u00f0\u009f\u009a\u0097", "\U0001f697"),  # 🚗
    # 🚦 F0 9F 9A A6  -> ðŸš¦
    ("\u00f0\u009f\u009a\u00a6", "\U0001f6a6"),  # 🚦
    # 🗺 already done above
    # 🏥 F0 9F 8F A5  -> ðŸ¥
    ("\u00f0\u009f\u008f\u00a5", "\U0001f3e5"),  # 🏥
    # 🚨 F0 9F 9A A8  -> ðŸš¨
    ("\u00f0\u009f\u009a\u00a8", "\U0001f6a8"),  # 🚨
    # ✅ E2 9C 85  -> âœ…
    ("\u00e2\u009c\u0085", "\u2705"),  # ✅
    # ❌ E2 9D 8C  -> â\x9d\x8c
    ("\u00e2\u009d\u008c", "\u274c"),  # ❌
    # 🔴 already done
    # 🟠 F0 9F 9F A0  -> ðŸŸ 
    ("\u00f0\u009f\u009f\u00a0", "\U0001f7e0"),  # 🟠
    # 💡 F0 9F 92 A1  -> ðŸ'¡
    ("\u00f0\u009f\u0092\u00a1", "\U0001f4a1"),  # 💡
    # 📌 F0 9F 93 8C  -> ðŸ"Œ
    ("\u00f0\u009f\u0093\u008c", "\U0001f4cc"),  # 📌
    # 🏗 F0 9F 8F 97  -> ðŸ—
    ("\u00f0\u009f\u008f\u0097", "\U0001f3d7"),  # 🏗
    # 🌐 F0 9F 8C 90  -> ðŸŒ
    ("\u00f0\u009f\u008c\u0090", "\U0001f310"),  # 🌐
    # 👁 F0 9F 91 81  -> ðŸ'
    ("\u00f0\u009f\u0091\u0081", "\U0001f441"),  # 👁
    # 🛡 F0 9F 9B A1  -> ðŸ›¡
    ("\u00f0\u009f\u009b\u00a1", "\U0001f6e1"),  # 🛡
    # 🎯 F0 9F 8E AF  -> ðŸŽ¯
    ("\u00f0\u009f\u008e\u00af", "\U0001f3af"),  # 🎯
    # ✨ E2 9C A8  -> âœ¨
    ("\u00e2\u009c\u00a8", "\u2728"),  # ✨
    # 🔥 F0 9F 94 A5  -> ðŸ"¥
    ("\u00f0\u009f\u0094\u00a5", "\U0001f525"),  # 🔥

    # ── 3-byte emoji ────────────────────────────────────────
    # ℹ️  E2 84 B9 EF B8 8F -> â„¹ï¸
    ("\u00e2\u0084\u00b9\u00ef\u00b8\u008f", "\u2139\ufe0f"),  # ℹ️
    # ▶ E2 96 B6  -> â–¶
    ("\u00e2\u0096\u00b6", "\u25b6"),  # ▶
    # ⏹ E2 8F B9  -> â¹
    ("\u00e2\u008f\u00b9", "\u23f9"),  # ⏹
    # ⏸ E2 8F B8  -> â¸
    ("\u00e2\u008f\u00b8", "\u23f8"),  # ⏸

    # ── Replacement char from failed decode ─────────────────
    # Some spots may still have U+FFFD from the error-replace pass.
    # We can't recover those automatically — they'll stay as ? in output.
]

count = 0
for bad, good in FIXES:
    occurrences = text.count(bad)
    if occurrences:
        text = text.replace(bad, good)
        count += occurrences
        print(f"  Fixed {occurrences:3d}x  {repr(bad)[:30]} -> {good}")

# Also replace any remaining U+FFFD with empty (they're unrecoverable)
ufffd_count = text.count("\ufffd")
if ufffd_count:
    text = text.replace("\ufffd", "")
    print(f"  Removed {ufffd_count} unrecoverable U+FFFD chars")

TARGET.write_text(text, encoding="utf-8")
print(f"\n[DONE] {count} sequences fixed. File saved ({TARGET.stat().st_size:,} bytes)")
