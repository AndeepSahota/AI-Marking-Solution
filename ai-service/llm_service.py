import os 
import json 
from openai import OpenAI
from dotenv import load_dotenv
from prompts import SYSTEM_PROMPT, build_user_prompt, EXTRACTION_SYSTEM_PROMPT, build_extraction_prompt

# This line reads the .env file and loads the variables in the enviroment 
# Without this, python has no idea my API key exists 
load_dotenv()

# This creates the OpenAI client object 
# It automatically looks for OPEN_AI_KEY in your enviroment variables 
# This is why the key is never hardcoded - it is pulled securly from .env
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def extract_mark_scheme(scheme_text):
    user_prompt = build_extraction_prompt(scheme_text)

    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=0,
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user",   "content": user_prompt}
        ]
    )

    raw_text = response.choices[0].message.content
    cleaned  = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:-1])

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Extraction returned invalid JSON: {e}\nRaw: {cleaned[:300]}")

def _mark_samples(question, essay, rubric, max_score, exemplars, temperature, n):
    user_prompt = build_user_prompt(question, essay, rubric, exemplars=exemplars)

    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=temperature,
        n=n,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ]
    )

    results_list = []
    last_error = None

    for choice in response.choices:
        raw_text = choice.message.content
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:-1])

        try:
            results = json.loads(cleaned)
        except json.JSONDecodeError as e:
            last_error = f"LLM returned invalid JSON: {e}\nRaw: {cleaned[:300]}"
            continue

        detected_max = results.get("max_score_detected") or max_score
        breakdown = results.get("rubric_breakdown", [])
        results["score"] = min(
            sum(min(ao.get("score_awarded", 0), ao.get("max_marks", detected_max)) for ao in breakdown),
            detected_max
        )
        results["maxScore"] = detected_max

        if not breakdown or any(not ao.get("evidence") for ao in breakdown):
            results["teacher_review_required"] = True

        results_list.append(results)

    return results_list, last_error

def generate_llm_response(question, essay, rubric, max_score=6, exemplars=None):
    results_list, last_error = _mark_samples(question, essay, rubric, max_score, exemplars, temperature=0.0, n=1)
    if not results_list:
        raise ValueError(last_error)
    return results_list[0]
    
    
