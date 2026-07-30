# How the AI Service Works — Plain English

## The big picture in one sentence

The AI service takes a student essay and a mark scheme, reads them both, and returns a score and feedback in a structured format.

---

## Where the AI service sits

The project has three layers. You only need to care about the middle one:

```
Browser (what the teacher sees)
        ↓
Backend (Node.js — just a middleman, passes things around)
        ↓
AI Service (Python — THIS IS WHAT THIS DOCUMENT IS ABOUT)
```

The AI service is a self-contained Python program. It receives files, processes them, and returns results. It has no database, no user accounts — it just does work and hands back answers.

---

## The two jobs the AI service does

### Job 1 — OCR (reading a document)

A PDF or photo is just pixels. The computer cannot read it as text. OCR fixes that.

```
Student essay (PDF/photo)  →  OCR  →  "The writer uses imagery to convey..."
```

This project uses a service called **Datalab** for OCR. Here's exactly what happens:

1. The file bytes are sent to Datalab's API over the internet
2. Datalab processes it and gives back a URL to check
3. The code polls (checks repeatedly, every 2 seconds) until Datalab says it's done
4. The extracted text comes back as markdown

**File:** `ocr_service.py`

---

### Job 2 — LLM marking (the AI examiner)

Once we have the essay and mark scheme as text, we send them to **GPT-4o** (OpenAI's model) with a detailed set of instructions telling it how to mark.

**File:** `llm_service.py`

Here is what gets sent to GPT-4o:

```
System prompt  →  "You are an experienced GCSE examiner. Here are your marking rules..."
User prompt    →  "Here is the mark scheme: [text]
                   Here is the student essay: [text]
                   Return your result as JSON."
```

GPT-4o replies with a JSON object — a structured set of labelled boxes:

```json
{
  "max_score_detected": 25,
  "rubric_breakdown": [
    {
      "criterion": "AO1",
      "score_awarded": 8,
      "max_marks": 12,
      "reason": "Student identifies key themes but doesn't develop argument..."
    },
    {
      "criterion": "AO2",
      "score_awarded": 6,
      "max_marks": 13,
      "reason": "Technique identified but effect not explained..."
    }
  ],
  "strengths": [
    "Clear opening argument supported by a direct quote"
  ],
  "improvements": [
    "AO2 analysis stops at identifying the technique — needs to explain the effect"
  ],
  "actionable_steps": [
    "After naming a technique, always ask yourself: what does this make the reader feel, and why?"
  ],
  "teacher_review_required": false,
  "question_mismatch": false,
  "annotations": [
    {
      "quote": "the darkness crept in like a thief",
      "comment": "Good use of simile but effect not explored",
      "type": "improvement"
    }
  ]
}
```

---

## What each field means

| Field | What it means |
|---|---|
| `max_score_detected` | The total marks available — the LLM reads this from the mark scheme |
| `rubric_breakdown` | Per-AO scores with the reason for each mark decision |
| `strengths` | 2–3 specific things the student did well, with quotes |
| `improvements` | 2–3 specific things that lost marks |
| `actionable_steps` | Concrete things to do differently in the next draft |
| `teacher_review_required` | `true` if the AI is less than 80% confident — teacher should double-check |
| `question_mismatch` | `true` if the question and mark scheme appear to be for different tasks |
| `annotations` | Exact quotes from the essay with a comment — used to highlight the essay on screen |

---

## How the final score is calculated

The LLM does **not** produce a single total score directly. Instead:

1. It scores each AO individually in `rubric_breakdown`
2. After it replies, the code adds those scores up
3. The total is capped at `max_score_detected` as a safety net

```python
# In llm_service.py
detected_max = results.get("max_score_detected") or max_score
breakdown    = results.get("rubric_breakdown", [])
results["score"] = min(
    sum(ao.get("score_awarded", 0) for ao in breakdown),
    detected_max
)
```

Why do it this way? Because if the LLM produces its own total score separately, it can disagree with the breakdown. Now the total **has** to match the breakdown — they're the same numbers.

---

## The four files and what they do

### `main.py` — the front door
Defines the URL endpoints (routes) the backend can call:

| Endpoint | What it does |
|---|---|
| `POST /ocr` | Receives a file, runs OCR, returns text |
| `POST /mark-with-scheme-text` | Receives student file + mark scheme text, returns full marking result |
| `POST /bulk-mark-with-scheme-text` | Same but for a whole class in one PDF — splits, OCRs, and marks each student |

### `ocr_service.py` — the document reader
Sends files to Datalab, polls for the result, returns the extracted text as a string. Nothing clever here — just an API call and a wait loop.

### `llm_service.py` — the examiner brain
Builds the prompt, sends it to GPT-4o, parses the JSON reply, calculates the score. This is where the marking logic lives.

### `prompts.py` — the instructions
Two things:
- `SYSTEM_PROMPT` — tells GPT-4o who it is and how to mark (strict examiner rules, band descriptors, common mistakes to avoid)
- `build_user_prompt()` — assembles the per-essay prompt: mark scheme + student response + JSON format instructions

---

## The flow for a single student submission

```
1. Backend sends: student PDF + mark scheme text

2. main.py receives it at POST /mark-with-scheme-text

3. ocr_service.py reads the student PDF → returns student text

4. llm_service.py builds the prompt:
      system: "You are a GCSE examiner..."
      user:   "Mark scheme: [text] | Essay: [text] | Return JSON"

5. GPT-4o replies with JSON

6. llm_service.py:
      - parses the JSON
      - reads max_score_detected from it
      - sums rubric_breakdown scores
      - clamps total to max_score_detected

7. main.py assembles a clean response:
      score, maxScore, feedback string, annotations, etc.

8. Returns it to the Backend

9. Backend sanitizes it (checks all field types, drops anything unexpected)

10. Backend saves to database + sends to frontend
```

---

## Known gaps in the AI service (as of July 2026)

| Gap | Plain English |
|---|---|
| `teacher_review_required` is never shown to the teacher | The AI tells us when it's unsure — we're ignoring it |
| No per-AO cap | AO2 worth 13 marks could be awarded 15 by mistake — we only cap the total |
| Single LLM call | The same essay submitted twice might get slightly different scores |
| OCR quality depends on scan quality | A blurry photo will produce garbled text and a bad mark |
