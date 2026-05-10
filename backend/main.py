from datetime import datetime, timezone

from fastapi import Body, FastAPI
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

@app.post("/users/{userId}")
async def update_user(userId: str, user_data: dict = Body(default_factory=dict)):
    # Strip server-managed fields so clients can't override them.
    user_data.pop("userId", None)
    user_data.pop("createdAt", None)

    update: dict = {
        "$setOnInsert": {
            "userId": userId,
            "createdAt": datetime.now(timezone.utc),
        }
    }
    if user_data:
        update["$set"] = user_data

    await db.users.update_one({"userId": userId}, update, upsert=True)
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
async def post_activity_log(userId: str, snapshot: dict = Body(default_factory=dict)):
    # Stamp server-side so clients can't spoof attribution.
    snapshot["userId"] = userId
    snapshot["createdAt"] = datetime.now(timezone.utc)

    # Coerce client `timestamp` to a real datetime so Mongo stores ISODate.
    ts = snapshot.get("timestamp")
    if isinstance(ts, str):
        snapshot["timestamp"] = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    elif isinstance(ts, (int, float)):
        snapshot["timestamp"] = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)

    await db.activity_logs.insert_one(snapshot)

    return {"message": "Successfully added activity log"}

# --- Helpers ---
    
def serialize_doc(doc):
    doc["_id"] = str(doc["_id"])
    return doc
