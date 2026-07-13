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


def generate_llm_response(question, essay, rubric, max_score=6, exemplars=None):
    user_prompt = build_user_prompt(question, essay, rubric, exemplars=exemplars)
    
    # This is the actual API call to OPEN AI 
    # Think of it like sending a letter - System prompt is in the rulebook,
    # user prompt is the actual request 
    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=0.0,
        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ]
    )
    
    # The response comes back as an object - we need to dig into it 
    # to get the actual text the LLM produced 
    raw_text = response.choices[0].message.content
    
    # The LLM returns a string - but we told it to write JSON 
    # json.loads() converts that JSON string to a python dictionary 
    # So we can use it like: result["score"], results["strengths"] etc.
    # GPT-4o sometimes wraps response in markdown code blocks
    # This strips them out before parsing
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        # Remove first line (```json) and last line (```)
        cleaned = "\n".join(cleaned.split("\n")[1:-1])

    try:
        results = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned invalid JSON: {e}\nRaw: {cleaned[:300]}")

    detected_max = results.get("max_score_detected") or max_score
    breakdown = results.get("rubric_breakdown", [])
    results["score"]    = min(
        sum(min(ao.get("score_awarded", 0), ao.get("max_marks", detected_max)) for ao in breakdown),
        detected_max
    )
    results["maxScore"] = detected_max

    return results
    
    
