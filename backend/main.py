from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import db
from models import *

from llm import ask_backboard

LIMIT = 100 # Limit when querying all documents

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

# --- AI ---
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

# --- Users ---

@app.get("/users")
async def get_users():
    users = await db.users.find().to_list(length=LIMIT)
    users = [serialize_doc(user) for user in users]
    
    return {"users": users}

@app.get("/users/{userId}")
async def get_user(userId: str):
    user = await db.users.find_one({"userId": userId})
    user = serialize_doc(user)
    
    return {"user": user}

# --- Activity logs ---

@app.get("/activity")
async def get_activity_logs():
    logs = await db.activity_logs.find().to_list(length=LIMIT)
    logs = [serialize_doc(log) for log in logs]
    
    return {
        "count": len(logs),
        "logs": logs
    }

@app.get("/activity/{userId}")
async def get_activity_logs(userId: str):
    logs = await db.activity_logs.find({"userId": userId}).to_list(length=LIMIT)
    logs = [serialize_doc(log) for log in logs]
    
    return {
        "count": len(logs),
        "logs": logs
    }

@app.post("/activity/{userId}")
async def post_activity_log(userId: str, activityLog: ActivityLog):
    activityLog.userId = userId
    await db.activity_logs.insert_one(activityLog.model_dump())

    return {"message": "Successfully added activity log"}

# --- Helpers ---
    
def serialize_doc(doc):
    doc["_id"] = str(doc["_id"])
    return doc
