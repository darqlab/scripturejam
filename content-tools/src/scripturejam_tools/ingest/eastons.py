"""task 1.1 / 1.2 — Ingest Easton's Bible Dictionary → AvatarEntity records."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import typer
import yaml
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

app = typer.Typer()
console = Console()

# Person-indicating phrases for the heuristic
PERSON_PHRASES = (
    "son of",
    "daughter of",
    "king of",
    "queen of",
    "prophet",
    "priest",
    "judge",
    "apostle",
    "disciple",
    "wife of",
    "brother of",
    "sister of",
    "father of",
    "mother of",
    "servant of",
    "governor of",
    "commander of",
)


def _is_likely_person(body: str) -> bool:
    body_lower = body.lower()
    return any(phrase in body_lower for phrase in PERSON_PHRASES)


def _parse_eastons(source_path: Path) -> list[dict]:
    """Parse Easton's Bible Dictionary plaintext. Returns list of raw entity records."""
    text = source_path.read_text(encoding="utf-8", errors="replace")

    # Split into blocks on blank lines (one or more)
    raw_blocks = re.split(r"\n{2,}", text.strip())

    records = []
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Parsing entries...", total=len(raw_blocks))

        for block in raw_blocks:
            progress.advance(task)
            block = block.strip()
            if not block:
                continue

            lines = block.split("\n")
            first_line = lines[0].strip()

            # Headword: first line is ALL CAPS (allow hyphens, spaces, digits)
            if not first_line.isupper() and not re.match(r"^[A-Z][A-Z\s\-0-9]+$", first_line):
                continue

            headword = first_line
            body_lines = [line.strip() for line in lines[1:] if line.strip()]
            body = " ".join(body_lines)

            if not body:
                continue

            records.append(
                {
                    "headword": headword,
                    "body": body,
                    "likely_person": _is_likely_person(body),
                }
            )

    return records


def _write_yaml(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, allow_unicode=True, sort_keys=False)


@app.command()
def ingest(
    source: str = typer.Argument(..., help="Path to Easton's plaintext source"),
    output: str = typer.Option(
        "staging/entities_raw.yaml", help="Output YAML path for raw records"
    ),
    classify: bool = typer.Option(
        False, "--classify", help="Also emit a second file with category pre-filled for likely persons"
    ),
    classify_output: str = typer.Option(
        "staging/entities_classified.yaml", help="Output path for classified records (--classify)"
    ),
):
    """Parse Easton's Bible Dictionary and emit raw entity records."""
    source_path = Path(source)
    if not source_path.exists():
        console.print(f"[red]Source file not found: {source}[/red]")
        raise typer.Exit(1)

    console.print(f"[bold]Ingesting[/bold] [cyan]{source}[/cyan]")
    records = _parse_eastons(source_path)

    console.print(f"\n[green]Parsed {len(records):,} entries.[/green]")
    persons = [r for r in records if r["likely_person"]]
    console.print(f"[green]Likely persons: {len(persons):,}[/green]")
    console.print(f"[dim]Other entries: {len(records) - len(persons):,}[/dim]")

    out_path = Path(output)
    _write_yaml(out_path, records)
    console.print(f"[green]Raw records → {out_path}[/green]")

    if classify:
        classified = []
        for r in records:
            if r.get("likely_person"):
                classified.append(
                    {
                        "headword": r["headword"],
                        "body": r["body"],
                        "likely_person": True,
                        "category": "person",
                    }
                )
        cl_path = Path(classify_output)
        _write_yaml(cl_path, classified)
        console.print(f"[green]Classified persons ({len(classified)}) → {cl_path}[/green]")


if __name__ == "__main__":
    app()
