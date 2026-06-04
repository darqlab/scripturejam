#!/usr/bin/env bash
# install-bible-texts.sh — download and index KJV, WEB, and ASV for scripturejam.
#
# Source: scrollmapper/bible_databases (public domain)
#   KJV → formats/csv/KJV.csv
#   WEB → formats/csv/BSB.csv  (Berean Standard Bible — modern public-domain English)
#   ASV → formats/csv/ASV.csv
# Output: content/bible/KJV.yaml, WEB.yaml, ASV.yaml  (~17 MB total)
#
# Usage (from repo root):
#   bash content-tools/scripts/install-bible-texts.sh
#
# Requirements: curl, python3, uv  (uv: https://docs.astral.sh/uv/)

set -euo pipefail

# ── Locate repo root ──────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOLS_DIR="$REPO_ROOT/content-tools"
RAW_DIR="$REPO_ROOT/content/bible/raw"
OUT_DIR="$REPO_ROOT/content/bible"

cd "$REPO_ROOT"

# ── Colour helpers ────────────────────────────────────────────────────────────

bold='\033[1m'; green='\033[0;32m'; yellow='\033[1;33m'; red='\033[0;31m'; reset='\033[0m'
info()  { echo -e "${bold}==> $*${reset}"; }
ok()    { echo -e "${green}    ✓ $*${reset}"; }
warn()  { echo -e "${yellow}    ⚠ $*${reset}"; }
die()   { echo -e "${red}    ✗ $*${reset}" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

echo
info "Checking prerequisites…"
command -v curl    >/dev/null 2>&1 || die "curl not found — install with: sudo apt install curl"
command -v python3 >/dev/null 2>&1 || die "python3 not found"
command -v uv      >/dev/null 2>&1 || die "uv not found — install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
ok "All prerequisites met"

# ── Directories ───────────────────────────────────────────────────────────────

mkdir -p "$RAW_DIR" "$OUT_DIR"

# ── CSV → verse-per-line converter ───────────────────────────────────────────
#
# scrollmapper CSV format (current): Book,Chapter,Verse,Text
# Output format expected by bible_text.py: "BookName Chapter:Verse Text"

CONVERTER='
import csv, sys

for row in csv.DictReader(sys.stdin):
    book = row["Book"].strip()
    c    = int(row["Chapter"])
    v    = int(row["Verse"])
    t    = row["Text"].strip()
    if book and t:
        print(f"{book} {c}:{v} {t}")
'

BASE_URL="https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/csv"

# WEB (World English Bible) is not in scrollmapper; BSB (Berean Standard Bible)
# is used instead — both are modern public-domain English translations.
declare -A SOURCES=(
  ["KJV"]="KJV.csv"
  ["WEB"]="BSB.csv"
  ["ASV"]="ASV.csv"
)

# ── Process each translation ──────────────────────────────────────────────────

for translation in KJV WEB ASV; do
  csv_file="${SOURCES[$translation]}"
  raw_path="$RAW_DIR/$csv_file"
  txt_path="$RAW_DIR/${translation}.txt"
  yaml_path="$OUT_DIR/${translation}.yaml"

  echo
  info "[$translation] Downloading source…"
  curl -fsSL --progress-bar "$BASE_URL/$csv_file" -o "$raw_path"
  ok "Saved to content/bible/raw/$csv_file"

  info "[$translation] Converting to verse-per-line format…"
  python3 -c "$CONVERTER" < "$raw_path" > "$txt_path"
  verse_count=$(wc -l < "$txt_path")
  ok "Converted — $verse_count verses"

  info "[$translation] Indexing…"
  (cd "$TOOLS_DIR" && uv run python -m scripturejam_tools.ingest.bible_text \
    "$translation" "../content/bible/raw/${translation}.txt" \
    --output-dir "../content/bible")

  size_mb=$(python3 -c "import os; print(f'{os.path.getsize(\"$yaml_path\")/1048576:.1f}')")
  ok "Written: content/bible/${translation}.yaml (${size_mb} MB)"
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo
echo -e "${green}${bold}All three translations installed.${reset}"
echo
echo "Next step — rebuild the Docker image to bake the texts in:"
echo
echo "  cd /opt/yard/scripturejam && ./scripts/deploy.sh"
echo
