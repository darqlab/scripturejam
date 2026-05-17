"""task 1.7 — Bundle KJV / WEB / ASV as book→chapter→verse YAML index."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional

import typer
import yaml
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

app = typer.Typer()
console = Console()

TRANSLATIONS = ["KJV", "WEB", "ASV"]

# Matches: "BookName Chapter:Verse Text..."
# Examples: "Genesis 1:1 In the beginning...", "1 Kings 3:5 text"
LINE_RE = re.compile(r"^(.*?) (\d+):(\d+) (.+)$")


def parse_bible_text(source_path: Path) -> tuple[dict, int, int, int]:
    """
    Parse a verse-per-line plaintext Bible file.

    Returns (bible_dict, total_lines, matched_verses, skipped_lines).
    bible_dict: {book: {chapter_int: {verse_int: text}}}
    """
    bible: dict = {}
    matched = 0
    skipped = 0
    total_lines = 0

    with source_path.open("r", encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()

    total_lines = len(lines)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total} lines"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Parsing verses...", total=total_lines)

        for lineno, raw in enumerate(lines, start=1):
            line = raw.strip()
            progress.advance(task)

            if not line:
                skipped += 1
                continue

            m = LINE_RE.match(line)
            if not m:
                console.print(
                    f"[yellow]WARN line {lineno}: no match — {line[:80]!r}[/yellow]",
                    highlight=False,
                )
                skipped += 1
                continue

            book = m.group(1)
            chapter = int(m.group(2))
            verse = int(m.group(3))
            text = m.group(4).strip()

            if book not in bible:
                bible[book] = {}
            if chapter not in bible[book]:
                bible[book][chapter] = {}
            bible[book][chapter][verse] = text
            matched += 1

    return bible, total_lines, matched, skipped


@app.command()
def bundle(
    translation: str = typer.Argument(..., help="Translation: KJV, WEB, or ASV"),
    source: str = typer.Argument(..., help="Path to plaintext source file"),
    output_dir: str = typer.Option("../content/bible", help="Output directory"),
    sample: bool = typer.Option(False, "--sample", help="Dump a few verses per book to stdout"),
):
    """Index a Bible translation text file and write <TRANSLATION>.yaml."""
    translation = translation.upper()
    if translation not in TRANSLATIONS:
        console.print(f"[red]Unknown translation {translation!r}. Choose from {TRANSLATIONS}.[/red]")
        raise typer.Exit(1)

    source_path = Path(source)
    if not source_path.exists():
        console.print(f"[red]Source file not found: {source}[/red]")
        raise typer.Exit(1)

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{translation}.yaml"

    console.print(f"[bold]Indexing {translation}[/bold] from [cyan]{source}[/cyan]")

    bible, total_lines, matched, skipped = parse_bible_text(source_path)

    console.print(f"\n[green]Lines read:    {total_lines:>7,}[/green]")
    console.print(f"[green]Verses parsed: {matched:>7,}[/green]")
    if skipped:
        console.print(f"[yellow]Lines skipped: {skipped:>7,}[/yellow]")

    books = list(bible.keys())
    total_books = len(books)
    console.print(f"[green]Books found:   {total_books:>7,}[/green]")

    if sample:
        console.rule("[bold]Sample output[/bold]")
        for book in books[:5]:
            chapters = sorted(bible[book].keys())
            ch = chapters[0]
            verses = sorted(bible[book][ch].keys())
            for v in verses[:2]:
                console.print(f"  [cyan]{book} {ch}:{v}[/cyan]  {bible[book][ch][v]}")
        console.rule()

    console.print(f"\nWriting [bold]{out_file}[/bold]...")
    with out_file.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(
            bible,
            fh,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=True,
        )

    size_mb = out_file.stat().st_size / 1_048_576
    console.print(f"[bold green]Done![/bold green] {out_file}  ({size_mb:.1f} MB)")


if __name__ == "__main__":
    app()
