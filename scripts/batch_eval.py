"""
Batch behavioral evaluation — automates what we've been doing by hand with
curl all session: log in, upload a mark scheme once, then mark several essays
against it and compare KLASSIO's marks to known official marks.

Step 1 (this version): just login + upload the mark scheme, print the lesson
ID back. Nothing else yet — get this piece working before adding the
essay-marking loop on top of it.
"""

import requests

BACKEND_URL = "http://localhost:3001"
EMAIL = "e2e-verify-test@example.com"
PASSWORD = "Testpass123!!"
CLASS_ID = 3

MARK_SCHEME_PATH = "/Users/andeepsahota/Desktop/AQA-Exemplars/Q5-wildlife-writing-READY-TO-TEST/mark-scheme.pdf"


def login(session: requests.Session):
    resp = session.post(
        f"{BACKEND_URL}/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
    )
    resp.raise_for_status()
    print("Logged in as:", resp.json()["user"]["name"])

    # The backend sets aimira_token with the Secure flag (only sent back over
    # HTTPS) — fine for a browser hitting the real deployed app, but requests'
    # cookie jar enforces that strictly even for our own http://localhost dev
    # server, so it silently drops the cookie on every request after this one.
    # Attaching it as a raw header instead bypasses that check entirely.
    token = session.cookies.get("aimira_token")
    session.headers["Cookie"] = f"aimira_token={token}"


def upload_mark_scheme(session: requests.Session, path: str) -> int:
    with open(path, "rb") as f:
        resp = session.post(
            f"{BACKEND_URL}/lessons",
            data={"classId": CLASS_ID},
            files={"markScheme": ("mark-scheme.pdf", f, "application/pdf")},
        )
    resp.raise_for_status()

    # /lessons streams NDJSON — one JSON object per line — same shape the
    # frontend's createLesson() already parses. We only care about the final
    # "done" event, which carries the new lesson's id.
    lesson_id = None
    for line in resp.text.strip().split("\n"):
        if not line.strip():
            continue
        import json
        event = json.loads(line)
        if event.get("type") == "done":
            lesson_id = event["data"]["id"]
        elif event.get("type") == "error":
            raise RuntimeError(f"Mark scheme upload failed: {event}")

    if lesson_id is None:
        raise RuntimeError("No 'done' event received — mark scheme upload didn't complete")

    return lesson_id


if __name__ == "__main__":
    session = requests.Session()
    login(session)
    lesson_id = upload_mark_scheme(session, MARK_SCHEME_PATH)
    print("Mark scheme uploaded. Lesson ID:", lesson_id)
