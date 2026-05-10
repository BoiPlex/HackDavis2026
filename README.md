# HackDavis2026 — FlowState

FlowState is an AI-powered productivity and focus assistant built for HackDavis 2026. It helps students and ADHD users understand their work habits through browser activity tracking, focus analytics, and personalized AI insights.

## Features

- AI productivity coach
- Activity heat map
- Real-time focus tracking
- Dark mode interface
- Productive vs distracting tab tracking
- Personalized usage summaries
- Chrome extension support
- FastAPI backend

## Tech Stack

### Frontend
- React
- Plasmo
- JavaScript / JSX
- CSS / TailwindCSS

### Backend
- Python
- FastAPI
- LLM (Gemini) --> AI Manager (Backboard)
- MongoDB

## Project Structure

```bash
HackDavis2026/
├── frontend/
│   └── focus-mate/
├── backend/
└── README.md

## Getting Started

Frontend: Run the following

```
cd frontend/focus-mate
npm install
npm run dev
```
Next, open your chromium browser, click "manage extensions", turn on "developer mode", and load the unpacked extension from the `frontend/focus-mate/build/chrome-mv3-dev` folder. Your browser should now have the extension installed and running. Pin it for easy access.


Backend: Run the following

```
cd backend
pip install -r requirements.txt
python main.py
```