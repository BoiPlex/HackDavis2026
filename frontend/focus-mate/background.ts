/// <reference types="chrome" />
export {}

const SNAPSHOT_ALARM = "focus-mate-snapshot"
const SNAPSHOT_PERIOD_MINUTES = 1
const IDLE_THRESHOLD_SECONDS = 15
const INPUT_KEY_PREFIX = "tab-input:"
const USER_ID_KEY = "user-id"
const STATE_KEY = "focus-mate-state"
const PERSIST_DEBOUNCE_MS = 1000
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
// Single-flight bootstrap: top-level + onInstalled + onStartup all call
// startBootstrap on every SW wake, and concurrent bootstraps would race
// on the tabs Map. This pins one in-flight run per SW lifetime.
let bootstrapPromise: Promise<void> | null = null

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

// MV3 service workers terminate after ~30s of inactivity when the popup is
// closed. Anything in `tabs`, `windowMetrics`, or `lastSeenInput` would be
// lost on the next wake — and losing `lastSeenInput` while the cumulative
// counters in `tab-input:*` storage survive would cause severe over-count
// on the next drain. Persist on every state change so recovery is exact.
type PersistedState = {
  windowMetrics: WindowMetrics
  tabs: TabMetric[]
  lastSeenInput: Array<[number, StoredInput]>
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

const persistState = async () => {
  const payload: PersistedState = {
    windowMetrics: { ...windowMetrics },
    tabs: Array.from(tabs.values()).map((t) => ({ ...t })),
    lastSeenInput: Array.from(lastSeenInput.entries())
  }
  try {
    await new Promise<void>((resolve) =>
      chrome.storage.local.set({ [STATE_KEY]: payload }, () => resolve())
    )
  } catch (e) {
    console.warn("[focus-mate] state persist failed", e)
  }
}

const schedulePersist = () => {
  if (persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistState()
  }, PERSIST_DEBOUNCE_MS)
}

const restoreState = async (): Promise<boolean> => {
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get(STATE_KEY, (v) => resolve(v ?? {}))
  )
  const s = stored[STATE_KEY] as PersistedState | undefined
  if (!s) return false
  Object.assign(windowMetrics, s.windowMetrics)
  for (const t of s.tabs) tabs.set(t.tabId, t)
  for (const [id, input] of s.lastSeenInput) lastSeenInput.set(id, input)
  return true
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
  console.log("[focus-mate] applyInputDelta", {
    tabId,
    attributeToTab,
    reset,
    cur: { c: curC, k: curK, s: Math.round(curS), cu: Math.round(curCu) },
    prev: prev
      ? {
          c: prev.clickCount,
          k: prev.keystrokeCount,
          s: Math.round(prev.scrollDelta),
          cu: Math.round(prev.cursorDelta)
        }
      : null,
    delta: { c: dC, k: dK, s: Math.round(dS), cu: Math.round(dCu) }
  })
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
  const inputKeys = Object.keys(all).filter((k) =>
    k.startsWith(INPUT_KEY_PREFIX)
  )
  console.log("[focus-mate] drain start", {
    inputKeysFound: inputKeys,
    tabsTracked: Array.from(tabs.keys())
  })
  for (const key of inputKeys) {
    const tabId = Number(key.slice(INPUT_KEY_PREFIX.length))
    if (!Number.isFinite(tabId)) {
      console.warn("[focus-mate] drain skipped (bad tabId)", key)
      continue
    }
    if (!tabs.has(tabId)) {
      console.warn(
        "[focus-mate] drain skipped (tab not tracked)",
        key,
        all[key]
      )
      continue
    }
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

  // Reset BEFORE the network call so tracking continues unblocked while the
  // POST is in flight. `snap` is a deep-enough copy (windowMetrics spread,
  // tabs mapped through `{ ...t }`), so zeroing live state here doesn't
  // mutate the payload.
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
  // Persist the freshly-zeroed state synchronously so a SW death between
  // here and the next event won't resurrect stale counters.
  await persistState()

  postSnapshot(snap)
}

const ensureSnapshotAlarm = async () => {
  // chrome.alarms.create with an existing name *replaces* the alarm and
  // resets its period. Calling it on every SW wake (the previous design)
  // meant frequent events could indefinitely defer the snapshot. Only
  // create if it doesn't already exist — alarms persist across SW deaths.
  const existing = await chrome.alarms.get(SNAPSHOT_ALARM)
  if (!existing) {
    chrome.alarms.create(SNAPSHOT_ALARM, {
      periodInMinutes: SNAPSHOT_PERIOD_MINUTES
    })
  }
}

const bootstrap = async () => {
  userId = await ensureUserId()
  upsertUser(userId)

  // Hydrate counters from the previous SW lifetime. Additive — if no prior
  // state exists (fresh install), the maps just stay empty and the rest of
  // bootstrap fills them.
  const restored = await restoreState()

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
    // Don't increment tabSwitchIn here. On a SW restart this would fire
    // every wake and double-count. The first real onActivated will count
    // the user's next switch; on fresh install we just miss the very
    // first "switch into" the initially-active tab, which is acceptable.
  }

  const focused = await chrome.windows.getLastFocused().catch(() => null)
  windowFocused = focused?.focused ?? true
  // Reset the accounting clock so the dead-time gap between SW death and
  // wake is not credited as focus or idle seconds.
  lastAccountedAt = Date.now()

  await ensureSnapshotAlarm()
  if (!restored) await persistState()
}

// Every handler awaits `ready` before mutating. On a SW wake driven by one
// of these events, the handler would otherwise run before bootstrap's
// `restoreState` has loaded the previous lifetime's tab map, and the
// restore would overwrite the handler's mutations.

chrome.tabs.onCreated.addListener(async (tab) => {
  await ready
  ensureTab(tab)
  schedulePersist()
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready
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
  schedulePersist()
})

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  await ready
  const entry = ensureTab(tab)
  if (!entry) return
  if (changeInfo.url) {
    entry.url = changeInfo.url
    entry.domain = domainOf(changeInfo.url)
  }
  if (changeInfo.title !== undefined) entry.title = changeInfo.title
  schedulePersist()
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready
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
  schedulePersist()
})

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await ready
  accountElapsed()
  windowFocused = windowId !== chrome.windows.WINDOW_ID_NONE
  schedulePersist()
})

chrome.idle.onStateChanged.addListener(async (state) => {
  await ready
  accountElapsed()
  idleState = state
  schedulePersist()
})

// One-shot handshake: content scripts have no way to discover their own
// tab id, so they ask us once on load. After that, they write input
// counters directly to chrome.storage.local under `tab-input:<tabId>`.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "claim-tab") return
  const id = sender.tab?.id ?? null
  console.log("[focus-mate] claim-tab", { id, url: sender.tab?.url })
  sendResponse(id)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNAPSHOT_ALARM) emitSnapshot()
})

const startBootstrap = () => {
  if (bootstrapPromise) return bootstrapPromise
  const run = bootstrap().catch((e) => {
    console.error("[focus-mate] bootstrap failed", e)
  })
  bootstrapPromise = run
  ready = run
  return run
}

chrome.runtime.onInstalled.addListener(() => {
  startBootstrap()
})
chrome.runtime.onStartup.addListener(() => {
  startBootstrap()
})

// Top-level call covers every other SW wake (event-driven). single-flight
// guard above prevents duplicate concurrent bootstraps.
startBootstrap()
console.log("[focus-mate] background initialized")
