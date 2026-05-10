/// <reference types="chrome" />
export {}

const SNAPSHOT_ALARM = "focus-mate-snapshot"
const SNAPSHOT_PERIOD_MINUTES = 1
const IDLE_THRESHOLD_SECONDS = 15
const INPUT_KEY_PREFIX = "tab-input:"
const USER_ID_KEY = "user-id"
const BACKEND_URL = "http://localhost:8000"

type StoredInput = {
  clickCount: number
  keystrokeCount: number
  scrollDelta: number
  cursorDelta: number
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
  cursorDelta: number
  createdAt: number
}

type WindowMetrics = {
  focusSeconds: number
  idleSeconds: number
  tabChangeCount: number
  clickCount: number
  keystrokeCount: number
  scrollDelta: number
  cursorDelta: number
}

type Snapshot = {
  id: string
  userId: string
  timestamp: string
  windowMetrics: WindowMetrics
  tabs: TabMetric[]
}

const tabs = new Map<number, TabMetric>()
const lastSeenInput = new Map<number, StoredInput>()
const windowMetrics: WindowMetrics = {
  focusSeconds: 0,
  idleSeconds: 0,
  tabChangeCount: 0,
  clickCount: 0,
  keystrokeCount: 0,
  scrollDelta: 0,
  cursorDelta: 0
}
let activeTabId: number | null = null
let idleState: chrome.idle.IdleState = "active"
let windowFocused = true
let lastAccountedAt = Date.now()
let userId = "anonymous"
// Resolves when bootstrap has populated `tabs`. Drains must await this
// or they race the alarm-driven worker wakeup and skip every entry.
let ready: Promise<void> = Promise.resolve()

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

// Read the persisted userId, or generate one and persist it. Runs once
// per browser profile — the same id is reused across sessions.
const ensureUserId = async (): Promise<string> => {
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get(USER_ID_KEY, (v) => resolve(v ?? {}))
  )
  const existing = stored[USER_ID_KEY]
  if (typeof existing === "string" && existing.length > 0) return existing
  const fresh = crypto.randomUUID()
  await new Promise<void>((resolve) =>
    chrome.storage.local.set({ [USER_ID_KEY]: fresh }, () => resolve())
  )
  return fresh
}

// Upsert the user record on the backend. POST /users/{userId} creates the
// row on first run and is a no-op on subsequent calls (or merges any
// settings passed in).
const upsertUser = async (
  id: string,
  patch: Record<string, unknown> = {}
) => {
  try {
    await fetch(`${BACKEND_URL}/users/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    })
  } catch (e) {
    console.warn("[focus-mate] user upsert failed", e)
  }
}

const postSnapshot = async (snap: Snapshot) => {
  try {
    await fetch(`${BACKEND_URL}/activity/${encodeURIComponent(snap.userId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap)
    })
  } catch (e) {
    console.warn("[focus-mate] snapshot post failed", e)
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
      cursorDelta: 0,
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
  if (userActive) windowMetrics.focusSeconds += dt
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
  timestamp: new Date().toISOString(),
  windowMetrics: { ...windowMetrics },
  tabs: Array.from(tabs.values()).map((t) => ({ ...t }))
})

// Diff `cur` against the last-seen cumulative counters for `tabId` and
// apply the deltas. Counter-decrease (page reload re-init) is treated as
// a reset. The tab record may be gone (tab just closed) — pass false for
// `attributeToTab` to attribute only to window totals.
const applyInputDelta = (
  tabId: number,
  cur: StoredInput,
  attributeToTab: boolean
) => {
  // Coerce missing fields. Stale content scripts (e.g. tabs open across an
  // extension reload that added a new metric) may flush entries without
  // every field, and `undefined - number` is NaN — which would poison the
  // shared windowMetrics counter for the rest of the period.
  const curC = cur.clickCount ?? 0
  const curK = cur.keystrokeCount ?? 0
  const curS = cur.scrollDelta ?? 0
  const curCu = cur.cursorDelta ?? 0

  const prev = lastSeenInput.get(tabId)
  const reset =
    !prev ||
    curC < prev.clickCount ||
    curK < prev.keystrokeCount ||
    curS < prev.scrollDelta ||
    curCu < prev.cursorDelta
  const dC = reset ? curC : curC - prev!.clickCount
  const dK = reset ? curK : curK - prev!.keystrokeCount
  const dS = reset ? curS : curS - prev!.scrollDelta
  const dCu = reset ? curCu : curCu - prev!.cursorDelta
  if (attributeToTab) {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.clickCount += dC
      tab.keystrokeCount += dK
      tab.scrollDelta += dS
      tab.cursorDelta += dCu
    }
  }
  windowMetrics.clickCount += dC
  windowMetrics.keystrokeCount += dK
  windowMetrics.scrollDelta += dS
  windowMetrics.cursorDelta += dCu
  lastSeenInput.set(tabId, {
    clickCount: curC,
    keystrokeCount: curK,
    scrollDelta: curS,
    cursorDelta: curCu
  })
}

const drainInputCounters = async () => {
  const all = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get(null, (items) => resolve(items ?? {}))
  )
  for (const key of Object.keys(all)) {
    if (!key.startsWith(INPUT_KEY_PREFIX)) continue
    const tabId = Number(key.slice(INPUT_KEY_PREFIX.length))
    if (!Number.isFinite(tabId)) continue
    if (!tabs.has(tabId)) continue
    applyInputDelta(tabId, all[key] as StoredInput, true)
  }
}

const emitSnapshot = async () => {
  await ready
  accountElapsed()
  await drainInputCounters()
  const snap = snapshot()
  console.log("[focus-mate] snapshot", snap)
  console.log("[focus-mate] userId", userId)

  postSnapshot(snap)

  windowMetrics.focusSeconds = 0
  windowMetrics.idleSeconds = 0
  windowMetrics.tabChangeCount = 0
  windowMetrics.clickCount = 0
  windowMetrics.keystrokeCount = 0
  windowMetrics.scrollDelta = 0
  windowMetrics.cursorDelta = 0
  for (const t of tabs.values()) {
    t.focusSeconds = 0
    t.idleSeconds = 0
    t.tabSwitchIn = 0
    t.tabSwitchOut = 0
    t.clickCount = 0
    t.keystrokeCount = 0
    t.scrollDelta = 0
    t.cursorDelta = 0
  }
}

const bootstrap = async () => {
  userId = await ensureUserId()
  upsertUser(userId)

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
    if (entry) {
      entry.isActive = true
      entry.tabSwitchIn += 1
    }
  }

  const focused = await chrome.windows.getLastFocused().catch(() => null)
  windowFocused = focused?.focused ?? true
  lastAccountedAt = Date.now()
}

chrome.tabs.onCreated.addListener((tab) => {
  ensureTab(tab)
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeTabId === tabId) {
    accountElapsed()
    activeTabId = null
  }
  // Salvage any unread input the content script flushed on pagehide before
  // tearing down. Per-tab counters are gone with the tab; window totals
  // must reflect everything the user did before close.
  const key = `${INPUT_KEY_PREFIX}${tabId}`
  const items = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get(key, (v) => resolve(v ?? {}))
  )
  const cur = items[key] as StoredInput | undefined
  if (cur) applyInputDelta(tabId, cur, false)
  tabs.delete(tabId)
  lastSeenInput.delete(tabId)
  chrome.storage.local.remove(key)
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

const startBootstrap = () => {
  ready = bootstrap().catch((e) => {
    console.error("[focus-mate] bootstrap failed", e)
  })
}

chrome.runtime.onInstalled.addListener(startBootstrap)
chrome.runtime.onStartup.addListener(startBootstrap)

startBootstrap()
console.log("[focus-mate] background initialized")
