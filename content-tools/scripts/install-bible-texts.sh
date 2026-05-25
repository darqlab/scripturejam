#!/usr/bin/env bash
# install-bible-texts.sh — download and index KJV, WEB, and ASV for scripturejam.
#
# Source: scrollmapper/bible_databases (public domain)
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
# scrollmapper CSV format: id,b,c,v,t
#   b = book number (1–66), c = chapter, v = verse, t = text
# Output format expected by bible_text.py: "BookName Chapter:Verse Text"

CONVERTER='
import csv, sys

BOOKS = {
  1:"Genesis",2:"Exodus",3:"Leviticus",4:"Numbers",5:"Deuteronomy",
  6:"Joshua",7:"Judges",8:"Ruth",9:"1 Samuel",10:"2 Samuel",
  11:"1 Kings",12:"2 Kings",13:"1 Chronicles",14:"2 Chronicles",15:"Ezra",
  16:"Nehemiah",17:"Esther",18:"Job",19:"Psalms",20:"Proverbs",
  21:"Ecclesiastes",22:"Song of Solomon",23:"Isaiah",24:"Jeremiah",25:"Lamentations",
  26:"Ezekiel",27:"Daniel",28:"Hosea",29:"Joel",30:"Amos",
  31:"Obadiah",32:"Jonah",33:"Micah",34:"Nahum",35:"Habakkuk",
  36:"Zephaniah",37:"Haggai",38:"Zechariah",39:"Malachi",
  40:"Matthew",41:"Mark",42:"Luke",43:"John",44:"Acts",
  45:"Romans",46:"1 Corinthians",47:"2 Corinthians",48:"Galatians",49:"Ephesians",
  50:"Philippians",51:"Colossians",52:"1 Thessalonians",53:"2 Thessalonians",
  54:"1 Timothy",55:"2 Timothy",56:"Titus",57:"Philemon",58:"Hebrews",
  59:"James",60:"1 Peter",61:"2 Peter",62:"1 John",63:"2 John",64:"3 John",
  65:"Jude",66:"Revelation"
}

for row in csv.DictReader(sys.stdin):
    b, c, v, t = int(row["b"]), int(row["c"]), int(row["v"]), row["t"].strip()
    book = BOOKS.get(b)
    if book and t:
        print(f"{book} {c}:{v} {t}")
'

BASE_URL="https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats"

declare -A SOURCES=(
  ["KJV"]="t_kjv.csv"
  ["WEB"]="t_web.csv"
  ["ASV"]="t_asv.csv"
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
