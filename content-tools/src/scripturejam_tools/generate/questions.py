"""task 1.8 — AI question generation via Anthropic SDK (cost-capped)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

import anthropic
import typer
import yaml
from rich.console import Console
from rich.table import Table

app = typer.Typer()
console = Console()

MODEL = "claude-sonnet-4-6"

# Sonnet 4.6 pricing ($/million tokens)
INPUT_COST_PER_M = 3.0
OUTPUT_COST_PER_M = 15.0

MAX_RETRIES = 3

# Locate the prompts file relative to this source file
_TOOLS_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # content-tools/
PROMPT_FILE = _TOOLS_ROOT / "prompts" / "question-generation.md"


def _parse_prompts(md_text: str) -> tuple[str, str]:
    """Extract system prompt and user prompt template from the markdown file."""
    # Find fenced code blocks after ## System prompt and ## User prompt template
    sections = re.split(r"^##\s+", md_text, flags=re.MULTILINE)
    system_prompt = ""
    user_template = ""
    for section in sections:
        if section.startswith("System prompt"):
            m = re.search(r"```\n(.*?)```", section, re.DOTALL)
            if m:
                system_prompt = m.group(1).strip()
        elif section.startswith("User prompt template"):
            m = re.search(r"```\n(.*?)```", section, re.DOTALL)
            if m:
                user_template = m.group(1).strip()
    return system_prompt, user_template


def _fill_template(template: str, variables: dict) -> str:
    """Replace {{variable}} placeholders in template."""
    result = template
    for key, value in variables.items():
        result = result.replace("{{" + key + "}}", str(value))
    return result


def _estimate_cost(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens / 1_000_000) * INPUT_COST_PER_M + (output_tokens / 1_000_000) * OUTPUT_COST_PER_M


def _load_staging(staging_path: Path) -> list:
    """Load existing questions from a staging file."""
    if not staging_path.exists():
        return []
    with staging_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not data or "questions" not in data:
        return []
    return data["questions"] or []


def _save_staging(staging_path: Path, questions: list) -> None:
    """Write questions list to the staging file."""
    staging_path.parent.mkdir(parents=True, exist_ok=True)
    with staging_path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump({"questions": questions}, fh, allow_unicode=True, sort_keys=False)


def _validate_question(q: dict) -> list[str]:
    """Return list of validation errors; empty means valid."""
    errors = []
    for field in ("id", "prompt", "options", "correctOptionId", "references", "difficulty"):
        if field not in q:
            errors.append(f"missing field '{field}'")
    if "options" in q:
        opts = q["options"]
        if not isinstance(opts, list) or not (2 <= len(opts) <= 4):
            errors.append("options must be a list of 2–4 items")
        else:
            for opt in opts:
                if "id" not in opt or "text" not in opt:
                    errors.append("each option needs 'id' and 'text'")
                    break
    if "correctOptionId" in q and "options" in q:
        ids = [o.get("id") for o in q.get("options", [])]
        if q["correctOptionId"] not in ids:
            errors.append(f"correctOptionId '{q['correctOptionId']}' not in option ids {ids}")
    if "difficulty" in q and q["difficulty"] not in ("easy", "medium", "hard"):
        errors.append(f"difficulty must be easy/medium/hard, got '{q['difficulty']}'")
    if "references" in q:
        refs = q["references"]
        if not isinstance(refs, list) or len(refs) == 0:
            errors.append("references must be a non-empty list")
        else:
            for ref in refs:
                for rf in ("book", "chapter", "verse_start"):
                    if rf not in ref:
                        errors.append(f"reference missing '{rf}'")
    return errors


def _call_api(
    client: anthropic.Anthropic,
    system_prompt: str,
    user_message: str,
    retry_note: str = "",
) -> tuple[str, int, int]:
    """Call the API with prompt caching on the system prompt. Returns (text, input_tokens, output_tokens)."""
    messages = [{"role": "user", "content": user_message}]
    if retry_note:
        messages.append({"role": "assistant", "content": "questions:"})
        messages = [{"role": "user", "content": user_message + "\n\n" + retry_note}]

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=messages,
    )

    text = response.content[0].text if response.content else ""
    usage = response.usage
    return text, usage.input_tokens, usage.output_tokens


def _parse_response(text: str) -> list[dict]:
    """Parse YAML from the API response. Strips accidental code fences."""
    cleaned = re.sub(r"^```[a-z]*\n?", "", text.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```$", "", cleaned, flags=re.MULTILINE)
    data = yaml.safe_load(cleaned)
    if isinstance(data, dict) and "questions" in data:
        return data["questions"] or []
    return []


@app.command()
def generate(
    theme: str = typer.Argument(..., help="Pack theme (e.g., parables, named_characters)"),
    count: int = typer.Option(20, "--count", help="Number of question candidates to generate"),
    scope: str = typer.Option(
        "", "--scope", help="Books/chapters in scope, e.g. 'Matthew 13, Mark 4'"
    ),
    description: str = typer.Option(
        "", "--description", help="Pack description"
    ),
    age_band: str = typer.Option(
        "all-ages", "--age-band", help="youth or all-ages"
    ),
    cost_cap_usd: float = typer.Option(1.0, "--cost-cap", help="Abort if cumulative cost exceeds this"),
    staging_dir: str = typer.Option(
        str(_TOOLS_ROOT / "staging"), "--staging-dir", help="Directory for staging files"
    ),
):
    """Generate question candidates using the Anthropic API (cost-capped)."""
    if not PROMPT_FILE.exists():
        console.print(f"[red]Prompt file not found: {PROMPT_FILE}[/red]")
        raise typer.Exit(1)

    md_text = PROMPT_FILE.read_text(encoding="utf-8")
    system_prompt, user_template = _parse_prompts(md_text)

    if not system_prompt or not user_template:
        console.print("[red]Could not parse system/user prompts from question-generation.md[/red]")
        raise typer.Exit(1)

    staging_path = Path(staging_dir) / f"{theme}_candidates.yaml"
    existing_questions = _load_staging(staging_path)
    existing_ids = {q.get("id") for q in existing_questions}
    existing_prompts = "\n".join(
        f"- {q.get('prompt', '')}" for q in existing_questions
    ) or "(none)"

    # Compute difficulty mix: roughly 35% easy, 45% medium, 20% hard
    easy_n = max(1, round(count * 0.35))
    hard_n = max(1, round(count * 0.20))
    medium_n = max(1, count - easy_n - hard_n)

    pack_title = theme.replace("_", " ").title()
    pack_description = description or f"Questions on the theme: {pack_title}"

    variables = {
        "pack_title": pack_title,
        "pack_description": pack_description,
        "age_band": age_band,
        "scope_books_chapters": scope or "(all books)",
        "count": count,
        "difficulty_mix.easy": easy_n,
        "difficulty_mix.medium": medium_n,
        "difficulty_mix.hard": hard_n,
        "already_generated_prompts": existing_prompts,
    }

    user_message = _fill_template(user_template, variables)

    client = anthropic.Anthropic()

    cumulative_cost = 0.0
    all_questions = list(existing_questions)
    batch_results: list[tuple[str, str, str]] = []  # (id, difficulty, prompt_short, status)

    console.print(f"[bold]Generating {count} questions for theme=[cyan]{theme}[/cyan][/bold]")
    console.print(f"Staging file: {staging_path}")
    console.print(f"Existing candidates: {len(existing_questions)}")

    retry_note = ""
    for attempt in range(1, MAX_RETRIES + 1):
        if cumulative_cost > cost_cap_usd:
            console.print(f"[red]Cost cap ${cost_cap_usd:.2f} reached — aborting.[/red]")
            break

        console.print(f"\n[dim]API call attempt {attempt}/{MAX_RETRIES}...[/dim]")

        raw_text, in_tok, out_tok = _call_api(client, system_prompt, user_message, retry_note)
        call_cost = _estimate_cost(in_tok, out_tok)
        cumulative_cost += call_cost
        console.print(
            f"  tokens in={in_tok:,} out={out_tok:,}  "
            f"call=${call_cost:.4f}  cumulative=${cumulative_cost:.4f}"
        )

        try:
            candidates = _parse_response(raw_text)
        except Exception as exc:
            console.print(f"[red]YAML parse error: {exc}[/red]")
            retry_note = f"Your previous response could not be parsed as YAML. Error: {exc}. Try again."
            continue

        if not candidates:
            console.print("[yellow]No questions parsed from response.[/yellow]")
            retry_note = "Your previous response contained no questions. Please output the YAML questions list."
            continue

        validation_errors: list[str] = []
        accepted_this_batch = 0

        for q in candidates:
            qid = q.get("id", "?")
            prompt_short = str(q.get("prompt", ""))[:60]
            difficulty = q.get("difficulty", "?")
            errors = _validate_question(q)

            if errors:
                status = f"[red]rejected: {errors[0]}[/red]"
                batch_results.append((qid, difficulty, prompt_short, f"rejected: {errors[0]}"))
                validation_errors.extend(errors)
                continue

            if qid in existing_ids:
                batch_results.append((qid, difficulty, prompt_short, "duplicate"))
                continue

            all_questions.append(q)
            existing_ids.add(qid)
            accepted_this_batch += 1
            batch_results.append((qid, difficulty, prompt_short, "accepted"))

        if validation_errors:
            retry_note = (
                f"Some questions had validation errors: {'; '.join(validation_errors[:3])}. "
                "Please regenerate only valid questions."
            )
            console.print(f"[yellow]{len(validation_errors)} validation error(s). Retrying...[/yellow]")
        else:
            console.print(f"[green]Accepted {accepted_this_batch} new questions.[/green]")
            break

    # Save staging file
    _save_staging(staging_path, all_questions)
    console.print(f"\n[green]Saved {len(all_questions)} total questions to {staging_path}[/green]")

    # Print summary table
    table = Table(title=f"Batch results — {theme}", show_lines=False)
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Difficulty", style="magenta")
    table.add_column("Prompt (truncated)", style="white")
    table.add_column("Status", style="green")

    for qid, diff, prompt_short, status in batch_results[-count:]:
        if "rejected" in status or "duplicate" in status:
            status_rendered = f"[yellow]{status}[/yellow]"
        else:
            status_rendered = f"[green]{status}[/green]"
        table.add_row(qid, diff, prompt_short, status_rendered)

    console.print(table)
    console.print(
        f"\n[bold]Total cost: ${cumulative_cost:.4f}[/bold] "
        f"(cap: ${cost_cap_usd:.2f})"
    )


if __name__ == "__main__":
    app()
