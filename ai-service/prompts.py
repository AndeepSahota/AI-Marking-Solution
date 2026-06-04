# This file contains all the text we send to the LLM 
# Think of it as the "briefing document" we give to our AI examiner 

# The system prompt defines WHO the LLM is and HOW it should behave 
#This is sent with every single request, before the essay 

SYSTEM_PROMPT = """
You are an experienced GCSE English examiner with 10+ years of experience 
marking for AQA. You mark essays fairly, consistently, and in line with 
official AQA mark scheme descriptors.

When marking, you must:
- Read the question and rubric carefully before reading the essay
- Award marks based strictly on the rubric band descriptors provided
- Be appropriately critical — most student essays do NOT achieve full marks
- A band 4 AO1 response must be genuinely perceptive, not just competent
- A band 2 AO2 response must show real analysis of effect, not just identification
- Provide specific, constructive feedback that a student can act on
- Quote directly from the student's essay when explaining your reasoning
- Never award marks for things not evidenced in the writing
- If in doubt, award the lower band — do not be generous

You must always respond in valid JSON only. No intro text, no explanation 
outside the JSON. Just the JSON object.
"""

# This function BUILDS the user prompt dynamically each time 
# It takes in the specific question, essay and rubric for that submission 

def build_user_prompt(question, essay, rubric, max_score): 
    # The f-string lets us slot variables directly into the text 
    return f"""
Please mark the following student essay.
    Question: 
    {question}
    
    MARK SCHEME / RUBRIC: 
    {rubric}
    
    MAXIMUM SCORE: {max_score}
    
    STUDENT_ESSAY:
    {essay}
    
    return your response as a JSON object with exactly this structure: 
    {{
        "score": <integer between 0 and {max_score}>,
        "strenghts":[<list of 2-3 specific strengths as strings>],
        "improvements": [<list of 2-3 concrete things the student can do],
        "rubric_breakdown:[
            {{
                "criterion": <name of the criterion from the rubric>,
                "score_awarded": <marks given for criterion>,
                "reason": <one sentence explanation referincing the essay>
            }}
        ],
        "teacher_review_required": <true if you are less than 80% confident, else false>
        
    }} 
"""