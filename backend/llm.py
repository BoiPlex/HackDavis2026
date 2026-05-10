import os

from backboard import BackboardClient
from dotenv import load_dotenv
import requests

load_dotenv()

client = BackboardClient(api_key=os.getenv("BACKBOARD_API_KEY"))


async def ask_backboard(message: str, userId: str, assistantId: str, thread_id: str | None = None):
    response = await client.send_message(
        message,
        thread_id=thread_id,
        assistant_id=assistantId, # Assistant is per user
        memory="Auto",
        llm_provider="google",
        model_name="gemini-2.5-flash"
    )

    return {
        "content": response.content,
        "thread_id": response.thread_id,
        "assistantId": response.assistant_id,
    }

async def create_assistant():
    response = requests.post(
        "https://app.backboard.io/api/assistants",
        headers={"X-API-Key": os.getenv("BACKBOARD_API_KEY")},
        json={
            "name": "FlowState Assistant",
            "system_prompt": f"""            
                You're a concise productivity coach for a browser activity tracker that helps you focus and manage your time effectively.
                No introduction needed, answer the user's question using only the data provided as well as tailored thoughtful time management advice.
                Be supportive and helpful. The user struggles with focusing and distractions.
                Given:
                - 24 hour usage summary
                - Heatmap goes by 24 hours and 5 minute buckets, and shows a variety of useful metrics.
                - Current quest, one of Research, Work, or Distractions.
                - user-specified productive (contributing) and unproductive domains in tabs, heatmap, 
                - Goal and timer represent the user's Pomodoro timer goal and state.
                Be specific about domains, focus/idle time, tab switching, clicks, keystrokes, scrolling, cursor movement, and overall engagement when relevant.
                If the summary or any provided data does not contain enough evidence, say what data is missing.
                Naturally convert time into the smallest unit of time possible.
                Write response in plaintext, styling is not possible.""",
            "tok_k": 15,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "search_kb",
                        "description": "Search the product knowledge base",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "Search query"}
                            },
                            "required": ["query"]
                        }
                    }
                }
            ]
        }
    )
    assistant = response.json()
    return assistant["assistant_id"]
