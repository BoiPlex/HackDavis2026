import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start",
  all_frames: false
}

const FLUSH_DEBOUNCE_MS = 500
const STORAGE_KEY_PREFIX = "tab-input:"

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

const claimTab = async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "claim-tab" })
    tabId = typeof resp === "number" ? resp : null
    if (tabId !== null && dirty) flush()
  } catch {
    tabId = null
  }
}

const flush = async () => {
  if (tabId === null || !dirty) return
  dirty = false
  try {
    await chrome.storage.local.set({
      [`${STORAGE_KEY_PREFIX}${tabId}`]: {
        clickCount,
        keystrokeCount,
        scrollDelta,
        cursorDelta,
        url: location.href,
        lastUpdate: Date.now()
      }
    })
  } catch {
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
  scheduleFlush()
}

const onKeydown = (e: KeyboardEvent) => {
  // Treat any key (including modifiers) as a keystroke; filter as needed.
  if (e.isComposing) return
  keystrokeCount += 1
  scheduleFlush()
}

const onScroll = () => {
  const y = window.scrollY
  const x = window.scrollX
  scrollDelta += Math.abs(y - lastScrollY) + Math.abs(x - lastScrollX)
  lastScrollY = y
  lastScrollX = x
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
claimTab()
