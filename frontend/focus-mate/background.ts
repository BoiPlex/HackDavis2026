/// <reference types="chrome" />
export {}

const SNAPSHOT_ALARM = "focus-mate-snapshot"
const SNAPSHOT_PERIOD_MINUTES = 1
const IDLE_THRESHOLD_SECONDS = 10
const INPUT_KEY_PREFIX = "tab-input:"

type StoredInput = {
  clickCount: number
  keystrokeCount: number
  scrollDelta: number
  url?: string
  lastUpdate?: number
}

type TabMetric = {
  tabId: number
  url: string
  domain: string
  title: string
  isActive: boolean
  focusSeconds: number
  idleSeconds: number
  tabSwitchIn: number
  tabSwitchOut: number
  clickCount: number
  keystrokeCount: number
  scrollDelta: number
  createdAt: number
}

type WindowMetrics = {
  activeSeconds: number
  idleSeconds: number
  tabChangeCount: number
  clickCount: number
  keystrokeCount: number
  scrollDelta: number
}

type Snapshot = {
  id: string
  userId: string
  timestamp: number
  windowMetrics: WindowMetrics
  tabs: TabMetric[]
}

const tabs = new Map<number, TabMetric>()
const lastSeenInput = new Map<number, StoredInput>()
const windowMetrics: WindowMetrics = {
  activeSeconds: 0,
  idleSeconds: 0,
  tabChangeCount: 0,
  clickCount: 0,
  keystrokeCount: 0,
  scrollDelta: 0
}
let activeTabId: number | null = null
let idleState: chrome.idle.IdleState = "active"
let windowFocused = true
let lastAccountedAt = Date.now()
let userId = "anonymous"

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

const ensureTab = (tab: chrome.tabs.Tab): TabMetric | null => {
  if (tab.id === undefined || tab.id < 0) return null
  let entry = tabs.get(tab.id)
  if (!entry) {
    entry = {
      tabId: tab.id,
      url: tab.url ?? tab.pendingUrl ?? "",
      domain: domainOf(tab.url ?? tab.pendingUrl ?? ""),
      title: tab.title ?? "",
      isActive: tab.active ?? false,
      focusSeconds: 0,
      idleSeconds: 0,
      tabSwitchIn: 0,
      tabSwitchOut: 0,
      clickCount: 0,
      keystrokeCount: 0,
      scrollDelta: 0,
      createdAt: Date.now()
    }
    tabs.set(tab.id, entry)
  }
  return entry
}

// Drain elapsed time into the appropriate active/idle bucket. Called on every
// state-changing event AND on each snapshot, so we don't rely on the service
// worker staying alive between events.
const accountElapsed = () => {
  const now = Date.now()
  const dt = (now - lastAccountedAt) / 1000
  lastAccountedAt = now
  if (dt <= 0) return

  const userActive = idleState === "active" && windowFocused
  if (userActive) windowMetrics.activeSeconds += dt
  else windowMetrics.idleSeconds += dt

  if (activeTabId !== null) {
    const t = tabs.get(activeTabId)
    if (t) {
      if (userActive) t.focusSeconds += dt
      else t.idleSeconds += dt
    }
  }
}

const snapshot = (): Snapshot => ({
  id: crypto.randomUUID(),
  userId,
  timestamp: Date.now(),
  windowMetrics: { ...windowMetrics },
  tabs: Array.from(tabs.values()).map((t) => ({ ...t }))
})

// Read all `tab-input:*` entries that content scripts have written, diff
// against last-seen cumulative values, and apply the deltas to in-memory tab
// metrics. Counter-decrease (page reload re-init) is treated as a reset.
const drainInputCounters = async () => {
  const all = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get(null, (items) => resolve(items ?? {}))
  )
  for (const key of Object.keys(all)) {
    if (!key.startsWith(INPUT_KEY_PREFIX)) continue
    const tabId = Number(key.slice(INPUT_KEY_PREFIX.length))
    if (!Number.isFinite(tabId)) continue
    const tab = tabs.get(tabId)
    if (!tab) continue
    const cur = all[key] as StoredInput
    const prev = lastSeenInput.get(tabId)
    const reset =
      !prev ||
      cur.clickCount < prev.clickCount ||
      cur.keystrokeCount < prev.keystrokeCount ||
      cur.scrollDelta < prev.scrollDelta
    const dC = reset ? cur.clickCount : cur.clickCount - prev!.clickCount
    const dK = reset ? cur.keystrokeCount : cur.keystrokeCount - prev!.keystrokeCount
    const dS = reset ? cur.scrollDelta : cur.scrollDelta - prev!.scrollDelta
    tab.clickCount += dC
    tab.keystrokeCount += dK
    tab.scrollDelta += dS
    windowMetrics.clickCount += dC
    windowMetrics.keystrokeCount += dK
    windowMetrics.scrollDelta += dS
    lastSeenInput.set(tabId, {
      clickCount: cur.clickCount,
      keystrokeCount: cur.keystrokeCount,
      scrollDelta: cur.scrollDelta
    })
  }
}

const emitSnapshot = async () => {
  accountElapsed()
  await drainInputCounters()
  const snap = snapshot()
  console.log("[focus-mate] snapshot", snap)
  windowMetrics.idleSeconds = 0
}

const bootstrap = async () => {
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS)
  idleState = await new Promise<chrome.idle.IdleState>((resolve) =>
    chrome.idle.queryState(IDLE_THRESHOLD_SECONDS, resolve)
  )

  const all = await chrome.tabs.query({})
  for (const t of all) ensureTab(t)

  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  })
  if (active?.id !== undefined) {
    activeTabId = active.id
    const entry = tabs.get(active.id)
    if (entry) entry.isActive = true
  }

  const focused = await chrome.windows.getLastFocused().catch(() => null)
  windowFocused = focused?.focused ?? true
  lastAccountedAt = Date.now()
}

chrome.tabs.onCreated.addListener((tab) => {
  ensureTab(tab)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    accountElapsed()
    activeTabId = null
  }
  tabs.delete(tabId)
  lastSeenInput.delete(tabId)
  chrome.storage.local.remove(`${INPUT_KEY_PREFIX}${tabId}`)
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  const entry = ensureTab(tab)
  if (!entry) return
  if (changeInfo.url) {
    entry.url = changeInfo.url
    entry.domain = domainOf(changeInfo.url)
  }
  if (changeInfo.title !== undefined) entry.title = changeInfo.title
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  accountElapsed()
  windowMetrics.tabChangeCount += 1
  if (activeTabId !== null && activeTabId !== tabId) {
    const prev = tabs.get(activeTabId)
    if (prev) {
      prev.isActive = false
      prev.tabSwitchOut += 1
    }
  }
  try {
    const tab = await chrome.tabs.get(tabId)
    const entry = ensureTab(tab)
    if (entry) {
      entry.isActive = true
      entry.tabSwitchIn += 1
    }
  } catch {}
  activeTabId = tabId
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  accountElapsed()
  windowFocused = windowId !== chrome.windows.WINDOW_ID_NONE
})

chrome.idle.onStateChanged.addListener((state) => {
  accountElapsed()
  idleState = state
})

// One-shot handshake: content scripts have no way to discover their own
// tab id, so they ask us once on load. After that, they write input
// counters directly to chrome.storage.local under `tab-input:<tabId>`.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "claim-tab") return
  sendResponse(sender.tab?.id ?? null)
})

chrome.alarms.create(SNAPSHOT_ALARM, {
  periodInMinutes: SNAPSHOT_PERIOD_MINUTES
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNAPSHOT_ALARM) emitSnapshot()
})

chrome.runtime.onInstalled.addListener(() => {
  bootstrap()
})
chrome.runtime.onStartup.addListener(() => {
  bootstrap()
})

bootstrap()
console.log("[focus-mate] background initialized")
