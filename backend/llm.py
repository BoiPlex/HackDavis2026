import os

from backboard import BackboardClient
from dotenv import load_dotenv

load_dotenv()

client = BackboardClient(api_key=os.getenv("BACKBOARD_API_KEY"))


async def ask_backboard(message: str, thread_id: str | None = None):
    response = await client.send_message(
        message,
        thread_id=thread_id,
        memory="Auto",
    )

    return {
        "content": response.content,
        "thread_id": response.thread_id,
        "assistant_id": response.assistant_id,
    }
