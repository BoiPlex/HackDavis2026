// background.js
// Single source of truth: chrome.storage.local["focusbuddy_timer"].
// Background's only job: when storage changes, (re)schedule a chrome.alarm
// for phase end. When alarm fires, transition phase. This keeps the timer
// progressing even when the popup is closed.

const KEY = "focusbuddy_timer"
const ALARM = "focusbuddy-phase-end"

async function getState() {
  const r = await chrome.storage.local.get(KEY)
  return r[KEY] || null
}
async function setState(s) {
  await chrome.storage.local.set({ [KEY]: s })
}

function elapsedMs(s) {
  if (!s?.startedAt) return 0
  const ref = s.pausedAt ?? Date.now()
  return Math.max(0, ref - s.startedAt - (s.accumulatedPaused || 0))
}

async function transition(s) {
  if (!s) return
  if (s.phase === "work") {
    if (s.hasBreak && s.breakSecs > 0) {
      await setState({
        ...s,
        phase: "break",
        startedAt: Date.now(),
        accumulatedPaused: 0,
        pausedAt: null
      })
    } else {
      await setState({ ...s, phase: "done", startedAt: null, pausedAt: null })
    }
  } else if (s.phase === "break") {
    await setState({ ...s, phase: "done", startedAt: null, pausedAt: null })
  }
}

async function reschedule() {
  await chrome.alarms.clear(ALARM)
  const s = await getState()
  if (!s || !s.startedAt || s.pausedAt) return
  if (s.phase !== "work" && s.phase !== "break") return

  const totalMs = (s.phase === "work" ? s.workSecs : s.breakSecs) * 1000
  const remaining = totalMs - elapsedMs(s)

  if (remaining <= 0) {
    await transition(s)
    return reschedule()
  }
  chrome.alarms.create(ALARM, { when: Date.now() + remaining })
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return
  const s = await getState()
  await transition(s)
  reschedule()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY]) reschedule()
})

chrome.runtime.onStartup.addListener(reschedule)
chrome.runtime.onInstalled.addListener(reschedule)