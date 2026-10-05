"""Build the cumulative Chedam work log PDF.

Each working day has one Markdown file in "Work Log/entries/YYYY-MM-DD.md".
This script writes "Work Log/Chedam-Work-Log-<date>.pdf" containing every entry up to <date>,
newest first. Earlier PDFs are never touched, so each day keeps its own complete snapshot.

Usage:  python tools/worklog/build_worklog.py            # date = newest entry
        python tools/worklog/build_worklog.py 2026-10-05 # a specific day
Needs:  pip install pymupdf markdown
"""
import re
import sys
from datetime import date
from pathlib import Path

import markdown
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
LOG_DIR = ROOT / "Work Log"
ENTRIES = LOG_DIR / "entries"

CSS = """
body { font-family: sans-serif; font-size: 9.5pt; line-height: 1.35; color: #1d1d1f; }
h1 { font-size: 20pt; margin: 0 0 4pt 0; }
h2 { font-size: 14pt; margin: 14pt 0 4pt 0; color: #0b5394; }
h3 { font-size: 11pt; margin: 10pt 0 3pt 0; }
h4 { font-size: 10pt; margin: 8pt 0 2pt 0; }
p, li { margin: 2pt 0; }
code { font-family: monospace; font-size: 8.5pt; background-color: #f0f0f0; }
pre { font-family: monospace; font-size: 8pt; background-color: #f4f4f4; padding: 4pt; margin: 3pt 0; }
table { border-collapse: collapse; margin: 4pt 0; width: 100%; }
th, td { border: 0.5pt solid #b0b0b0; padding: 2pt 4pt; font-size: 8.5pt; vertical-align: top; text-align: left; }
th { background-color: #e8eef7; }
.day { page-break-before: always; }
.meta { color: #555555; font-size: 9pt; }
.dayhead { background-color: #0b5394; color: #ffffff; padding: 4pt 6pt; font-size: 15pt; margin: 0 0 6pt 0; }
"""


def entry_files(upto: str):
    files = sorted(p for p in ENTRIES.glob("*.md") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem))
    return [p for p in files if p.stem <= upto]


def nice(d: str) -> str:
    return date.fromisoformat(d).strftime("%A, %B %d, %Y").replace(" 0", " ")


def build(upto: str) -> Path:
    files = entry_files(upto)
    if not files:
        sys.exit(f"no entries up to {upto} in {ENTRIES}")
    newest_first = list(reversed(files))
    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])

    parts = [
        "<h1>Chedam: work log</h1>",
        f"<p class='meta'>Cumulative record of every working day, newest first. "
        f"This copy covers up to {nice(upto)}. Owner: Sreya. "
        f"Baseline: Master Specification v1.0.</p>",
        "<h3>Days in this log</h3><ul>",
    ]
    for f in newest_first:
        first = f.read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip()
        parts.append(f"<li><b>{f.stem}</b>: {first}</li>")
    parts.append("</ul>")

    for f in newest_first:
        text = f.read_text(encoding="utf-8")
        lines = text.splitlines()
        title = lines[0].lstrip("# ").strip()
        body = md.reset().convert("\n".join(lines[1:]))
        # Entry headings shift down one level under the day banner
        body = re.sub(r"<(/?)h([1-5])>", lambda m: f"<{m.group(1)}h{min(int(m.group(2)) + 1, 6)}>", body)
        parts.append(
            f"<div class='day'><p class='dayhead'>{f.stem} ({nice(f.stem)})</p>"
            f"<h2>{title}</h2>{body}</div>"
        )

    html = "\n".join(parts)
    out = LOG_DIR / f"Chedam-Work-Log-{upto}.pdf"
    story = pymupdf.Story(html=html, user_css=CSS)
    page = pymupdf.paper_rect("letter")
    where = page + (42, 46, -42, -50)
    writer = pymupdf.DocumentWriter(str(out))
    more = True
    while more:
        dev = writer.begin_page(page)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()

    # Footer with page numbers
    doc = pymupdf.open(str(out))
    for i, p in enumerate(doc, 1):
        p.insert_text((42, page.height - 26), f"Chedam work log (to {upto})   Page {i} of {doc.page_count}",
                      fontsize=7.5, color=(0.4, 0.4, 0.4))
    doc.saveIncr()
    doc.close()
    return out


if __name__ == "__main__":
    upto = sys.argv[1] if len(sys.argv) > 1 else entry_files("9999-99-99")[-1].stem
    print(build(upto))
