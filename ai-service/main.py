from fastapi import FastAPI, File, UploadFile
from model.marker import run_marking

app = FastAPI()

@app.post("/mark")
async def mark_submission(
    student_work: UploadFile = File(...),
    mark_scheme: UploadFile = File(...)
):
    student_bytes = await student_work.read()
    scheme_bytes = await mark_scheme.read()
    result = run_marking(student_bytes, scheme_bytes)
    return result