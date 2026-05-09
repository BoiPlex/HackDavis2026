from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import db
from pydantic import BaseModel

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
