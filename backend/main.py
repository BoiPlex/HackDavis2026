from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import db
from llm import ask_backboard

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Connected!"}

@app.get("/users")
async def get_users():
    users = await db.users.find().to_list(length=100)
    return {"users": users}

@app.post("/ai/summary")
async def ai_summary(payload: dict):
    message = f"""
    Analyze this browser activity data and give a short productivity summary.

    Include:
    - total active time
    - most used domains
    - distracting patterns
    - productive patterns
    - one useful recommendation

    Activity data:
    {payload}
    """

    return await ask_backboard(message)
