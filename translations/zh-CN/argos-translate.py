#!/usr/bin/env python3
"""Create local Argos English-to-Chinese drafts without altering protected tokens."""
import json
import re
import sys
from pathlib import Path

import argostranslate.translate

catalog_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
translated = {}
if output_path.exists():
    translated = json.loads(output_path.read_text(encoding="utf-8"))

protected = re.compile(
    r"(\{\{\w+\}\}|(?<!\{)\{[A-Z][A-Z0-9_]*\}(?!\})|"
    r"</?[A-Za-z][A-Za-z0-9]*>|/|"
    r"(?<![A-Za-z0-9])(?:WSJT-X|JS8Call|pota\.app|QRZ\.com|HRDLog\.net|"
    r"eQSL|TQSL|CHIRP|Hamlib|Wavelog|VarAC|FreeDV|ClubLog|QSOs|QSLs)(?![A-Za-z0-9])|"
    r"\b(?:FT8|FT4|CW|RTTY|PSK31|JS8|SSTV|APRS|ADIF|CAT|PTT|VFO|RST|QSO|QSL|QTH|UTC|LoTW|QRZ|POTA|SOTA|DXCC|MHz|kHz|Hz|WPM)\b)"
)
technical_names = re.compile(
    r"(?<![A-Za-z0-9])(?:FT8|FT4|CW|RTTY|PSK31|JS8|SSTV|APRS|ADIF|CAT|PTT|VFO|RST|"
    r"QSO|QSL|QTH|UTC|LoTW|QRZ|POTA|SOTA|DXCC|MHz|kHz|Hz|WPM|WSJT-X|JS8Call|"
    r"eQSL|TQSL|CHIRP|Hamlib|Wavelog|VarAC|FreeDV|ClubLog)(?![A-Za-z0-9])"
)
if "--force" in sys.argv:
    translated = {}
translate = argostranslate.translate.get_translation_from_codes("en", "zh").translate
cache = {}
include_reviewed = "--reviewed" in sys.argv
pending = [
    row for row in catalog["rows"]
    if (row["status"] == "untranslated" or (include_reviewed and row["status"] == "reviewed"))
    and row["id"] not in translated
]

for index, row in enumerate(pending, 1):
    english = row["english"]
    try:
        if english not in cache:
            pieces = protected.split(english)
            result = []
            for piece in pieces:
                if not piece or protected.fullmatch(piece) or piece.isspace():
                    result.append(piece)
                    continue
                leading = re.match(r"^\s*", piece).group(0)
                trailing = re.search(r"\s*$", piece).group(0)
                end = len(piece) - len(trailing) if trailing else len(piece)
                core = piece[len(leading):end]
                result.append(leading + (translate(core) if core else "") + trailing)
            cache[english] = technical_names.sub(lambda match: f" {match.group(0)} ", "".join(result)).strip()
        translated[row["id"]] = cache[english]
    except Exception as error:  # Keep failures visible and retryable on the next run.
        print(f"translation failed for {row['id']}: {error}", file=sys.stderr)
    if index % 100 == 0:
        output_path.write_text(json.dumps(translated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"translated {index}/{len(pending)}", file=sys.stderr)

output_path.write_text(json.dumps(translated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"processed": len(pending), "total": len(translated)}))
