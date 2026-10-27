import hashlib
import sqlite3
import json
import os
from typing import List, Optional, Dict, Any

_HERE   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "data", "exemplars.sqlite")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("""
        CREATE TABLE IF NOT EXISTS exemplars (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            question_number TEXT    NOT NULL,
            essay_text      TEXT    NOT NULL,
            score           INTEGER NOT NULL,
            max_marks       INTEGER NOT NULL,
            band            INTEGER,
            source          TEXT    NOT NULL DEFAULT '',
            embedding       TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    """)
    columns = {row["name"] for row in db.execute("PRAGMA table_info(exemplars)")}
    if "scheme_key" not in columns:
        db.execute("ALTER TABLE exemplars ADD COLUMN scheme_key TEXT")
    db.commit()
    return db


def scheme_fingerprint(question_extraction: Optional[Dict[str, Any]]) -> Optional[str]:
    """Identifies the specific mark scheme a question is marked against, so
    examples are only ever shown alongside the scheme they were marked on.

    Built from the level IDs and level wording only (whitespace and case
    ignored) -- not the whole stored extraction, because re-extracting the
    same PDF words other fields differently: across the four real lessons
    sharing one AO4 scheme, a whole-extraction hash gave three different
    keys, this gave one. None for a question with no levels (point-based
    questions such as Q1), so they never share a key with each other."""
    if not isinstance(question_extraction, dict):
        return None
    levels = {}
    for ao_key, ao in (question_extraction.get("assessment_objectives") or {}).items():
        for thread_key, thread in (ao.get("threads") or {}).items():
            levels[f"{ao_key}/{thread_key}"] = sorted(
                (level.get("descriptor_id", ""), _normalise(level.get("text", "")))
                for level in thread.get("levels") or []
            )
    if not any(levels.values()):
        return None
    canonical = json.dumps(levels, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _embed(text: str) -> List[float]:
    from llm_service import client
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
    )
    return resp.data[0].embedding


def _cosine(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    ma  = sum(x * x for x in a) ** 0.5
    mb  = sum(x * x for x in b) ** 0.5
    return dot / (ma * mb) if ma and mb else 0.0


def add_exemplar(
    essay_text: str,
    question_number: str,
    score: int,
    max_marks: int,
    scheme_key: str,
    band: Optional[int] = None,
    source: str = "",
) -> int:
    embedding = _embed(essay_text)
    db = _conn()
    cur = db.execute(
        "INSERT INTO exemplars "
        "(question_number, essay_text, score, max_marks, band, source, embedding, scheme_key) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (question_number, essay_text, score, max_marks, band, source, json.dumps(embedding), scheme_key),
    )
    db.commit()
    db.close()
    return cur.lastrowid


def get_similar(
    essay_text: str,
    scheme_key: Optional[str],
    n: int = 3,
) -> List[Dict[str, Any]]:
    """Most similar stored examples marked on the same mark scheme. No
    scheme_key means no examples, rather than falling back to examples
    marked against some other scheme."""
    if not scheme_key:
        return []
    db = _conn()
    rows = db.execute(
        "SELECT id, question_number, essay_text, score, max_marks, band, source, embedding "
        "FROM exemplars WHERE scheme_key = ?",
        (scheme_key,),
    ).fetchall()
    db.close()

    if not rows:
        return []

    query_emb = _embed(essay_text)
    scored = []
    for row in rows:
        emb = json.loads(row["embedding"])
        scored.append({
            "id":              row["id"],
            "question_number": row["question_number"],
            "essay_text":      row["essay_text"],
            "score":           row["score"],
            "max_marks":       row["max_marks"],
            "band":            row["band"],
            "source":          row["source"],
            "similarity":      _cosine(query_emb, emb),
        })

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:n]


def list_exemplars() -> List[Dict[str, Any]]:
    db = _conn()
    rows = db.execute(
        "SELECT id, question_number, scheme_key, score, max_marks, band, source, created_at "
        "FROM exemplars ORDER BY created_at DESC"
    ).fetchall()
    db.close()
    return [dict(row) for row in rows]


def _normalise(text: str) -> str:
    return " ".join(text.split()).lower()


def get_examples_by_band(
    scheme_key: Optional[str],
    per_band: int = 3,
    exclude_texts: tuple[str, ...] = (),
) -> List[Dict[str, Any]]:
    """Up to per_band stored examples for each band, lowest band first, for
    the specialists -- only examples marked on this same mark scheme. Any
    example whose text matches one of exclude_texts (the essay being marked,
    test essays) is never returned. No embedding call -- selection is by
    band, not similarity."""
    if not scheme_key:
        return []
    excluded = {_normalise(t) for t in exclude_texts if t}
    db = _conn()
    rows = db.execute(
        "SELECT id, essay_text, score, max_marks, band, source FROM exemplars "
        "WHERE scheme_key = ? AND band IS NOT NULL ORDER BY band, id",
        (scheme_key,),
    ).fetchall()
    db.close()

    picked: Dict[int, List[Dict[str, Any]]] = {}
    for row in rows:
        if _normalise(row["essay_text"]) in excluded:
            continue
        bucket = picked.setdefault(row["band"], [])
        if len(bucket) < per_band:
            bucket.append(dict(row))
    return [example for band in sorted(picked) for example in picked[band]]


def delete_exemplar(exemplar_id: int) -> bool:
    db = _conn()
    result = db.execute("DELETE FROM exemplars WHERE id = ?", (exemplar_id,))
    db.commit()
    db.close()
    return result.rowcount > 0
