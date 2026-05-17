"""task 1.9 — Interactive review CLI: question + verse side-by-side; accept/reject/edit."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import typer
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table
from rich.text import Text

app = typer.Typer()
console = Console()

_TOOLS_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # content-tools/

REVIEW_MARKER = "_reviewed"
REJECTED_MARKER = "_rejected"


def _load_bible(bible_dir: Path) -> dict:
    """Load all Bible YAML files from the given directory. Returns merged dict."""
    bible: dict = {}
    for yaml_file in bible_dir.glob("*.yaml"):
        try:
            with yaml_file.open("r", encoding="utf-8") as fh:
                data = yaml.safe_load(fh)
            if isinstance(data, dict):
                bible.update(data)
        except Exception as exc:
            console.print(f"[yellow]WARN: could not load {yaml_file}: {exc}[/yellow]")
    return bible


def _render_verse(ref: dict, bible: dict) -> str:
    """Return verse text or placeholder."""
    book = ref.get("book", "")
    chapter = ref.get("chapter")
    verse_start = ref.get("verse_start")
    verse_end = ref.get("verse_end", verse_start)

    if not bible or book not in bible:
        return "[verse text not available]"

    book_data = bible[book]
    if chapter not in book_data:
        return "[verse text not available]"

    ch_data = book_data[chapter]
    if verse_end == verse_start:
        text = ch_data.get(verse_start, "[verse text not available]")
        return f"{book} {chapter}:{verse_start} — {text}"

    verses = []
    for v in range(verse_start, verse_end + 1):
        vt = ch_data.get(v)
        if vt:
            verses.append(f"{v} {vt}")
    if verses:
        return f"{book} {chapter}:{verse_start}–{verse_end} — " + " ".join(verses)
    return "[verse text not available]"


def _render_question(q: dict, bible: dict) -> Panel:
    """Build a Rich panel showing the question, options, and verse context."""
    correct_id = q.get("correctOptionId", "")
    prompt_text = q.get("prompt", "(no prompt)")
    options = q.get("options", [])
    refs = q.get("references", [])
    difficulty = q.get("difficulty", "?")
    qid = q.get("id", "?")

    content = Text()
    content.append(f"ID: {qid}   ", style="dim")
    content.append(f"Difficulty: {difficulty}\n\n", style="yellow")
    content.append(f"{prompt_text}\n\n", style="bold white")

    for opt in options:
        oid = opt.get("id", "?")
        otext = opt.get("text", "")
        prefix = f"  [{oid}] "
        if oid == correct_id:
            content.append(prefix + otext + "\n", style="bold green")
        else:
            content.append(prefix + otext + "\n", style="white")

    content.append("\n")
    for ref in refs:
        verse_text = _render_verse(ref, bible)
        content.append(f"  {verse_text}\n", style="italic cyan")

    return Panel(content, title="[bold]Question[/bold]", border_style="blue")


def _edit_question(q: dict) -> dict:
    """Inline edit of a question. Returns updated question dict."""
    updated = dict(q)

    new_prompt = Prompt.ask("Prompt", default=updated.get("prompt", ""))
    updated["prompt"] = new_prompt

    options = list(updated.get("options", []))
    for i, opt in enumerate(options):
        new_text = Prompt.ask(f"Option [{opt['id']}]", default=opt.get("text", ""))
        options[i] = {**opt, "text": new_text}
    updated["options"] = options

    new_correct = Prompt.ask(
        "correctOptionId", default=updated.get("correctOptionId", "a")
    )
    updated["correctOptionId"] = new_correct

    new_diff = Prompt.ask(
        "Difficulty [easy/medium/hard]", default=updated.get("difficulty", "medium")
    )
    updated["difficulty"] = new_diff

    return updated


def _load_staging(path: Path) -> list:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if isinstance(data, dict) and "questions" in data:
        return data["questions"] or []
    return []


def _save_staging(path: Path, questions: list) -> None:
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump({"questions": questions}, fh, allow_unicode=True, sort_keys=False)


def _load_pack_meta(pack_meta_json: Optional[str]) -> dict:
    """Load pack metadata from a JSON string or prompt interactively."""
    if pack_meta_json:
        try:
            return json.loads(pack_meta_json)
        except json.JSONDecodeError as exc:
            console.print(f"[red]Invalid --pack-meta JSON: {exc}[/red]")

    console.print("\n[bold]Pack metadata (required for output file)[/bold]")
    pack_id = Prompt.ask("pack.id (e.g. named_characters)")
    pack_title = Prompt.ask("pack.title")
    pack_desc = Prompt.ask("pack.description")
    age_band = Prompt.ask("pack.ageBand [youth/all-ages]", default="all-ages")
    return {"id": pack_id, "title": pack_title, "description": pack_desc, "ageBand": age_band}


@app.command()
def review(
    candidates: str = typer.Argument(..., help="Path to candidates YAML file"),
    bible_dir: str = typer.Option(
        str(_TOOLS_ROOT.parent / "content" / "bible"),
        help="Directory with indexed Bible YAML",
    ),
    output: Optional[str] = typer.Option(
        None, help="Approved pack output path (defaults to <pack-id>.yaml in current dir)"
    ),
    pack_meta: Optional[str] = typer.Option(
        None, "--pack-meta", help="Pack metadata as JSON string"
    ),
):
    """Walk through question candidates showing verse context; mark accept/reject/edit."""
    candidates_path = Path(candidates)
    if not candidates_path.exists():
        console.print(f"[red]Candidates file not found: {candidates}[/red]")
        raise typer.Exit(1)

    bible_path = Path(bible_dir)
    bible: dict = {}
    if bible_path.exists():
        console.print(f"[dim]Loading Bible texts from {bible_path}...[/dim]")
        bible = _load_bible(bible_path)
        if bible:
            console.print(f"[dim]Loaded {len(bible)} books.[/dim]")
        else:
            console.print("[yellow]No Bible YAML found — verses will show placeholder text.[/yellow]")
    else:
        console.print(f"[yellow]Bible dir not found ({bible_dir}) — verse text unavailable.[/yellow]")

    all_questions = _load_staging(candidates_path)
    if not all_questions:
        console.print("[yellow]No questions found in candidates file.[/yellow]")
        raise typer.Exit(0)

    meta = _load_pack_meta(pack_meta)

    # Collect output path
    pack_id = meta.get("id", "pack")
    out_path = Path(output) if output else Path(f"{pack_id}.yaml")

    # Load already-approved questions from a previous run (resume support)
    approved: list[dict] = []
    if out_path.exists():
        try:
            with out_path.open("r", encoding="utf-8") as fh:
                existing_data = yaml.safe_load(fh)
            if isinstance(existing_data, dict) and "questions" in existing_data:
                approved = existing_data["questions"] or []
                console.print(
                    f"[dim]Resuming: {len(approved)} already-approved questions in {out_path}.[/dim]"
                )
        except Exception:
            pass

    approved_ids = {q.get("id") for q in approved}

    total_reviewed = 0
    total_accepted = 0
    total_rejected = 0
    total_skipped = 0

    updated_questions = list(all_questions)

    try:
        for idx, q in enumerate(updated_questions):
            qid = q.get("id", "?")

            # Skip already-reviewed questions
            if q.get(REVIEW_MARKER):
                continue
            if qid in approved_ids:
                continue

            console.clear()
            console.print(
                f"[dim]Question {idx + 1}/{len(updated_questions)}  |  "
                f"approved={len(approved)}  rejected={total_rejected}  skipped={total_skipped}[/dim]"
            )
            console.print(_render_question(q, bible))
            console.print()
            console.print(
                "[bold][[a]ccept  [r]eject  [e]dit  [s]kip  [q]uit][/bold]"
            )

            while True:
                choice = Prompt.ask("> ", choices=["a", "r", "e", "s", "q"], show_choices=False)

                if choice == "a":
                    q[REVIEW_MARKER] = True
                    approved.append(q)
                    approved_ids.add(qid)
                    total_accepted += 1
                    total_reviewed += 1
                    console.print(f"[green]Accepted.[/green]")
                    break

                elif choice == "r":
                    q[REVIEW_MARKER] = True
                    q[REJECTED_MARKER] = True
                    total_rejected += 1
                    total_reviewed += 1
                    console.print(f"[red]Rejected.[/red]")
                    break

                elif choice == "e":
                    updated = _edit_question(q)
                    updated_questions[idx] = updated
                    q = updated
                    console.print(_render_question(q, bible))
                    console.print("[bold][[a]ccept  [r]eject  [e]dit  [s]kip  [q]uit][/bold]")

                elif choice == "s":
                    total_skipped += 1
                    console.print("[dim]Skipped.[/dim]")
                    break

                elif choice == "q":
                    console.print("[yellow]Quitting — saving progress.[/yellow]")
                    raise KeyboardInterrupt

    except KeyboardInterrupt:
        pass

    # Save staging file with review markers
    _save_staging(candidates_path, updated_questions)

    # Write approved output pack
    if approved:
        question_ids = [q.get("id") for q in approved]
        pack_data = {
            "pack": {
                "id": meta.get("id", pack_id),
                "title": meta.get("title", ""),
                "description": meta.get("description", ""),
                "ageBand": meta.get("ageBand", "all-ages"),
                "questionIds": question_ids,
            },
            "questions": approved,
        }
        with out_path.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(pack_data, fh, allow_unicode=True, sort_keys=False)
        console.print(f"\n[green]Approved pack saved to {out_path}[/green]")

    # Summary table
    summary = Table(title="Review summary", show_header=False)
    summary.add_column("Stat", style="cyan")
    summary.add_column("Count", style="bold")
    summary.add_row("Total reviewed this session", str(total_reviewed))
    summary.add_row("Accepted", str(total_accepted))
    summary.add_row("Rejected", str(total_rejected))
    summary.add_row("Skipped", str(total_skipped))
    summary.add_row("Total approved (all runs)", str(len(approved)))
    console.print(summary)


if __name__ == "__main__":
    app()
