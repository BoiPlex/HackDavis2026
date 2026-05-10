from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from bson import ObjectId

from db import db
from models import *
from llm import ask_backboard, create_assistant

LIMIT = 100
ACTIVITY_LIMIT = 10000

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

    try:
        return await ask_backboard(message)
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"AI provider request failed: {error}"
        )


@app.post("/ai/usage/{userId}")
async def ai_usage_question(userId: str, payload: dict = Body(default_factory=dict)):
    question = payload.get("question") or "Give me a concise insight about my recent usage."

    logs = await db.activity_logs.find({"userId": userId}).sort("timestamp", -1).to_list(length=60)
    logs = [serialize_doc(log) for log in logs]

    if not logs:
        raise HTTPException(status_code=404, detail="No activity logs found for this user yet.")

    user_data = await get_user(userId)
    user = user_data.get("user", {})
    settings = user.get("settings", {})
    
    if "assistantId" not in user:
        user["assistantId"] = await create_assistant()
        await update_user(userId, {"assistantId": user["assistantId"]}) # non-blocking to save user's new assistant
        print(f"user {userId} created assistant {user['assistantId']}")
    else:
        print(f"user {userId} using assistant {user['assistantId']}")
    
    usage_summary = summarize_activity_logs(logs)

    message = f"""
    User question:
    {question}

    Compact usage summary:
    {usage_summary}
    
    Heatmap:
    {user.get("heatmap")}
    
    Current quest:
    {settings.get("quest")}
    
    User-specified tabs:
    {settings.get("tabs")}

    Goal:
    {settings.get("goal")}
    
    Timer:
    {user.get("timer")}
    """

    try:
        response = await ask_backboard(message, userId, assistantId=user["assistantId"])
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"AI provider request failed: {error}"
        )

    return {
        "userId": userId,
        "question": question,
        "logCount": len(logs),
        "answer": response["content"],
        "thread_id": response["thread_id"],
    }    

# --- Users ---

@app.get("/users")
async def get_users():
    users = await db.users.find().to_list(length=LIMIT)
    users = [serialize_doc(user) for user in users]

    return {"users": users}


@app.get("/users/{userId}")
async def get_user(userId: str):
    user = await db.users.find_one({"userId": userId})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user = serialize_doc(user)
    return {"user": user}


@app.post("/users/{userId}")
async def update_user(userId: str, user_data: dict = Body(default_factory=dict)):
    user_data.pop("userId", None)
    user_data.pop("createdAt", None)

    update = {
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
async def get_all_activity_logs():
    logs = await db.activity_logs.find().to_list(length=LIMIT)
    logs = [serialize_doc(log) for log in logs]

    return {
        "count": len(logs),
        "logs": logs
    }


@app.get("/activity/{userId}")
async def get_user_activity_logs(userId: str, since: Optional[str] = None):
    query = {"userId": userId}

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["timestamp"] = {"$gt": since_dt}
        except (ValueError, TypeError):
            pass

    cursor = db.activity_logs.find(query).sort("timestamp", 1)
    logs = await cursor.to_list(length=ACTIVITY_LIMIT)
    logs = [serialize_doc(log) for log in logs]

    return {
        "count": len(logs),
        "logs": logs
    }


@app.post("/activity/{userId}")
async def post_activity_log(userId: str, snapshot: dict = Body(default_factory=dict)):
    snapshot["userId"] = userId
    snapshot["createdAt"] = datetime.now(timezone.utc)

    ts = snapshot.get("timestamp")

    if isinstance(ts, str):
        snapshot["timestamp"] = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    elif isinstance(ts, (int, float)):
        snapshot["timestamp"] = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)

    await db.activity_logs.insert_one(snapshot)

    try:
        await _increment_user_tab_stats(userId, snapshot)
    except Exception as error:
        print(f"tab stat increment failed for {userId}: {error}")

    return {"message": "Successfully added activity log"}


# --- Helpers ---

def serialize_mongo_document(value):
    if isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, list):
        return [serialize_mongo_document(item) for item in value]

    if isinstance(value, dict):
        return {
            key: serialize_mongo_document(item)
            for key, item in value.items()
        }

    return value


def serialize_doc(doc):
    return serialize_mongo_document(doc)


def _normalize_domain(value) -> str:
    if not isinstance(value, str):
        return ""
    trimmed = value.strip().lower()
    if not trimmed:
        return ""
    candidate = trimmed if trimmed.startswith(("http://", "https://")) else f"https://{trimmed}"
    try:
        host = urlparse(candidate).hostname or ""
    except Exception:
        host = trimmed.replace("https://", "").replace("http://", "").split("/")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


async def _increment_user_tab_stats(userId: str, snapshot: dict) -> None:
    snapshot_tabs = snapshot.get("tabs") or snapshot.get("Tabs") or []
    if not snapshot_tabs:
        return

    per_domain: dict[str, dict[str, int]] = {}
    for tab in snapshot_tabs:
        domain = _normalize_domain(tab.get("domain") or tab.get("Domain") or "")
        if not domain:
            continue
        agg = per_domain.setdefault(domain, {"secondsOn": 0, "visits": 0})
        agg["secondsOn"] += int(tab.get("focusSeconds") or 0)
        agg["visits"] += int(tab.get("tabSwitchIn") or 0)

    if not per_domain:
        return

    for domain, stats in per_domain.items():
        if stats["secondsOn"] == 0 and stats["visits"] == 0:
            continue
        await db.users.update_one(
            {"userId": userId},
            {
                "$inc": {
                    "settings.tabs.$[elem].secondsOn": stats["secondsOn"],
                    "settings.tabs.$[elem].visits": stats["visits"],
                }
            },
            array_filters=[{"elem.url": domain}],
        )


def summarize_activity_logs(logs: list[dict]):
    totals = {
        "focusSeconds": 0,
        "idleSeconds": 0,
        "tabChangeCount": 0,
        "clickCount": 0,
        "keystrokeCount": 0,
        "scrollDelta": 0,
        "cursorDelta": 0,
    }

    domains = {}

    for log in logs:
        metrics = log.get("windowMetrics") or {}

        totals["focusSeconds"] += int(metrics.get("focusSeconds") or metrics.get("activeSeconds") or 0)
        totals["idleSeconds"] += int(metrics.get("idleSeconds") or 0)
        totals["tabChangeCount"] += int(metrics.get("tabChangeCount") or 0)
        totals["clickCount"] += int(metrics.get("clickCount") or 0)
        totals["keystrokeCount"] += int(metrics.get("keystrokeCount") or 0)
        totals["scrollDelta"] += int(metrics.get("scrollDelta") or 0)
        totals["cursorDelta"] += int(metrics.get("cursorDelta") or 0)

        for tab in log.get("tabs") or log.get("Tabs") or []:
            domain = tab.get("domain") or tab.get("Domain") or "unknown"

            entry = domains.setdefault(domain, {
                "domain": domain,
                "focusSeconds": 0,
                "idleSeconds": 0,
                "tabSwitchIn": 0,
                "tabSwitchOut": 0,
                "clickCount": 0,
                "keystrokeCount": 0,
                "scrollDelta": 0,
                "cursorDelta": 0,
                "sampleTitles": [],
            })

            entry["focusSeconds"] += int(tab.get("focusSeconds") or 0)
            entry["idleSeconds"] += int(tab.get("idleSeconds") or 0)
            entry["tabSwitchIn"] += int(tab.get("tabSwitchIn") or 0)
            entry["tabSwitchOut"] += int(tab.get("tabSwitchOut") or 0)
            entry["clickCount"] += int(tab.get("clickCount") or 0)
            entry["keystrokeCount"] += int(tab.get("keystrokeCount") or 0)
            entry["scrollDelta"] += int(tab.get("scrollDelta") or 0)
            entry["cursorDelta"] += int(tab.get("cursorDelta") or 0)

            title = tab.get("title")
            if title and title not in entry["sampleTitles"] and len(entry["sampleTitles"]) < 3:
                entry["sampleTitles"].append(title[:80])

    top_domains = sorted(
        domains.values(),
        key=lambda item: item["focusSeconds"] + item["idleSeconds"],
        reverse=True,
    )[:12]

    return {
        "logCount": len(logs),
        "firstTimestamp": logs[-1].get("timestamp") if logs else None,
        "lastTimestamp": logs[0].get("timestamp") if logs else None,
        "totals": totals,
        "topDomains": top_domains,
    }