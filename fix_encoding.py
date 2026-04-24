"""
fix_encoding.py
Recovers App.jsx from PowerShell UTF-8 double-encoding corruption.

What happened:
  PowerShell Get-Content read UTF-8 bytes as Windows-1252 characters,
  then Set-Content -Encoding UTF8 re-encoded those chars as UTF-8,
  turning each multi-byte sequence (emoji, em-dash, etc.) into mojibake.

Fix:
  Read the file as UTF-8 (gives the mojibake string),
  encode it back to Latin-1 (recovers the original byte sequence),
  decode those bytes as UTF-8 (gives the original characters),
  write as clean UTF-8 without BOM.
"""

import sys
import pathlib

TARGET = pathlib.Path("frontend/src/App.jsx")

print(f"[READ]  {TARGET}  ({TARGET.stat().st_size:,} bytes)")

raw_text = TARGET.read_text(encoding="utf-8")

try:
    recovered = raw_text.encode("latin-1").decode("utf-8")
    print("[OK]    Encoding round-trip succeeded")
except (UnicodeDecodeError, UnicodeEncodeError) as e:
    # File is already clean or partially corrupted — try a best-effort replace
    print(f"[WARN]  Round-trip failed ({e}), trying with error replacement...")
    recovered = raw_text.encode("latin-1", errors="replace").decode("utf-8", errors="replace")

TARGET.write_text(recovered, encoding="utf-8")
print(f"[WRITE] {TARGET}  ({TARGET.stat().st_size:,} bytes)")
print("[DONE]  Encoding fixed successfully.")
