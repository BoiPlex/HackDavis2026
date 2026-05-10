import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start",
  all_frames: false
}

const FLUSH_DEBOUNCE_MS = 500
const STORAGE_KEY_PREFIX = "tab-input:"
const MOUSEMOVE_LOG_INTERVAL_MS = 2000

const logTag = "[focus-mate/tracker]"

let tabId: number | null = null
let clickCount = 0
let keystrokeCount = 0
let scrollDelta = 0
let cursorDelta = 0
let lastScrollY = 0
let lastScrollX = 0
let lastMouseX = 0
let lastMouseY = 0
let hasLastMouse = false
let dirty = false
let flushTimer: number | null = null
let lastMouseLogAt = 0

const claimTab = async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "claim-tab" })
    tabId = typeof resp === "number" ? resp : null
    console.log(logTag, "claim-tab response", { tabId, url: location.href })
    if (tabId !== null && dirty) flush()
  } catch (e) {
    console.warn(logTag, "claim-tab failed", e)
    tabId = null
  }
}

const flush = async () => {
  if (tabId === null || !dirty) {
    console.log(logTag, "flush skipped", { tabId, dirty })
    return
  }
  dirty = false
  const payload = {
    clickCount,
    keystrokeCount,
    scrollDelta,
    cursorDelta,
    url: location.href,
    lastUpdate: Date.now()
  }
  try {
    await chrome.storage.local.set({
      [`${STORAGE_KEY_PREFIX}${tabId}`]: payload
    })
    console.log(logTag, "flush ok", {
      key: `${STORAGE_KEY_PREFIX}${tabId}`,
      ...payload
    })
  } catch (e) {
    console.warn(logTag, "flush failed", e)
    dirty = true
  }
}

const scheduleFlush = () => {
  dirty = true
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_DEBOUNCE_MS)
}

const onClick = () => {
  clickCount += 1
  console.log(logTag, "click", { clickCount })
  scheduleFlush()
}

const onKeydown = (e: KeyboardEvent) => {
  // Treat any key (including modifiers) as a keystroke; filter as needed.
  if (e.isComposing) return
  keystrokeCount += 1
  console.log(logTag, "key", { key: e.key, keystrokeCount })
  scheduleFlush()
}

const onScroll = () => {
  const y = window.scrollY
  const x = window.scrollX
  scrollDelta += Math.abs(y - lastScrollY) + Math.abs(x - lastScrollX)
  lastScrollY = y
  lastScrollX = x
  console.log(logTag, "scroll", { scrollDelta: Math.round(scrollDelta) })
  scheduleFlush()
}

const onMouseMove = (e: MouseEvent) => {
  const x = e.clientX
  const y = e.clientY
  if (hasLastMouse) {
    cursorDelta += Math.hypot(x - lastMouseX, y - lastMouseY)
  }
  lastMouseX = x
  lastMouseY = y
  hasLastMouse = true
  // mousemove fires constantly; throttle the log to once every couple of seconds
  const now = Date.now()
  if (now - lastMouseLogAt > MOUSEMOVE_LOG_INTERVAL_MS) {
    lastMouseLogAt = now
    console.log(logTag, "mousemove", { cursorDelta: Math.round(cursorDelta) })
  }
  scheduleFlush()
}

const onPageHide = () => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  flush()
}

window.addEventListener("click", onClick, { capture: true, passive: true })
window.addEventListener("keydown", onKeydown, { capture: true, passive: true })
window.addEventListener("scroll", onScroll, { capture: true, passive: true })
window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true })
window.addEventListener("pagehide", onPageHide)

lastScrollY = window.scrollY
lastScrollX = window.scrollX
console.log(logTag, "init", {
  url: location.href,
  readyState: document.readyState
})
claimTab()
