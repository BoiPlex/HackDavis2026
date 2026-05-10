import "./style.css" // tailwind entrypoint

import { useEffect, useRef, useState } from "react"

const STORAGE_KEY = "focusbuddy_timer"
const THEME_KEY = "flowstate_theme"
const MICRO_GOAL_KEY = "flowstate_micro_goal"
const TRAIL_DOMAINS_KEY = "flowstate_trail_domains"
const BACKEND_URL = "http://localhost:8000"
const PRODUCTIVE_CATEGORIES = new Set(["school", "work", "productive"])
const SUMMARY_MIN_WORK_SECS = 5 * 60

const QUEST_TAGS = [
  { id: "research", label: "🔍 Research", color: "#7C5CFF" },
  { id: "work", label: "💼 Work", color: "#34D399" },
  { id: "sidequest", label: "🐇 Distractions", color: "#EF4444" }
]

const MICRO_GOALS = [
  { mins: 5, break: 2, label: "Tiny Sprint" },
  { mins: 15, break: 5, label: "Quick Quest" },
  { mins: 25, break: 10, label: "Pomodoro" },
  { mins: 45, break: 15, label: "Deep Dive" }
]

// const TIMEFRAMES = [
//   { id: "24h",   label: "24h"   },
//   { id: "week",  label: "Week"  },
//   { id: "month", label: "Month" },
//   { id: "year",  label: "Year"  }
// ]

// Tailwind helper class strings used in place of the old inline-style helpers
const inputClasses =
  "w-[63px] ml-1 px-[8px] py-[5px] text-base font-bold text-center border border-black/10 rounded-md bg-white/90 outline-none"
const controlBtnClasses =
  "flex-1 p-2.5 rounded-xl border-0 font-bold text-base cursor-pointer"

// ---- Storage abstraction ----
const hasChrome = typeof chrome !== "undefined" && chrome?.storage?.local
async function readStore() {
  if (hasChrome) {
    const r = await chrome.storage.local.get(STORAGE_KEY)
    return r[STORAGE_KEY] || null
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
  } catch {
    return null
  }
}
async function writeStore(s) {
  if (hasChrome) {
    if (s === null) await chrome.storage.local.remove(STORAGE_KEY)
    else await chrome.storage.local.set({ [STORAGE_KEY]: s })
  } else {
    if (s === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }
}
async function readTheme() {
  if (hasChrome) {
    const r = await chrome.storage.local.get(THEME_KEY)
    return r[THEME_KEY] || "light"
  }
  return localStorage.getItem(THEME_KEY) || "light"
}
async function writeTheme(theme) {
  if (hasChrome) await chrome.storage.local.set({ [THEME_KEY]: theme })
  else localStorage.setItem(THEME_KEY, theme)
}
async function readMicroGoal() {
  if (hasChrome) {
    const r = await chrome.storage.local.get(MICRO_GOAL_KEY)
    return r[MICRO_GOAL_KEY] || null
  }
  try {
    return JSON.parse(localStorage.getItem(MICRO_GOAL_KEY) || "null")
  } catch {
    return null
  }
}
async function writeMicroGoal(value) {
  if (hasChrome) await chrome.storage.local.set({ [MICRO_GOAL_KEY]: value })
  else localStorage.setItem(MICRO_GOAL_KEY, JSON.stringify(value))
}
async function readTrailDomains() {
  if (hasChrome) {
    const r = await chrome.storage.local.get(TRAIL_DOMAINS_KEY)
    return Array.isArray(r[TRAIL_DOMAINS_KEY]) ? r[TRAIL_DOMAINS_KEY] : []
  }
  try {
    return JSON.parse(localStorage.getItem(TRAIL_DOMAINS_KEY) || "[]")
  } catch {
    return []
  }
}
async function writeTrailDomains(domains) {
  if (hasChrome)
    await chrome.storage.local.set({ [TRAIL_DOMAINS_KEY]: domains })
  else localStorage.setItem(TRAIL_DOMAINS_KEY, JSON.stringify(domains))
}
function normalizeSavedDomain(item) {
  const domain = normalizeDomain(
    typeof item === "string" ? item : item?.domain || item?.url || ""
  )
  if (!domain) return null
  const status =
    typeof item === "object" &&
    ["stored", "productive", "distraction"].includes(item?.status)
      ? item.status
      : "productive"
  return { domain, status }
}
function normalizeDomain(value) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  try {
    return new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
    ).hostname.replace(/^www\./, "")
  } catch {
    return trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
  }
}
function createTrailTab(domain, status = "stored") {
  return {
    id: `domain:${domain}`,
    title: domain,
    url: domain,
    contributing: status === "stored" ? null : status === "productive",
    savedDomain: true,
    domainStatus: status,
    visits: 0,
    secondsOn: 0,
    friction: 0.1
  }
}

async function readUserId() {
  if (!hasChrome) return null
  const r = await chrome.storage.local.get("user-id")
  return r["user-id"] || null
}

function emptyHeatmap() {
  return Array.from({ length: 24 }, () =>
    Array.from({ length: 12 }, () => ({
      focus: 0,
      dist: 0,
      distractions: 0,
      longestStreak: 0
    }))
  )
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function nowISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function isValidGrid(g) {
  return (
    Array.isArray(g) &&
    g.length === 24 &&
    g.every((row) => Array.isArray(row) && row.length === 12)
  )
}

function cloneGrid(grid) {
  return grid.map((row) => row.map((cell) => ({ ...cell })))
}

// Backend may return ISO strings without an explicit offset (Mongo/Motor default
// is tz-naive). JS would treat those as local time, but the values are UTC —
// so append "Z" when no offset is present.
function parseTimestamp(ts) {
  if (ts instanceof Date) return ts
  if (typeof ts !== "string") return new Date(ts)
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(ts)) return new Date(ts)
  return new Date(ts + "Z")
}

// Aggregate every log into the grid by its own hour/minute-of-day. No date
// filtering — multi-day logs collapse onto the same 24×12 grid.
function mergeLogsIntoGrid(grid, logs) {
  const next = cloneGrid(grid)

  const todays = []
  for (const log of logs) {
    const d = parseTimestamp(log.timestamp)
    if (isNaN(d.getTime())) continue
    const h = d.getHours()
    const minuteOfHour = d.getMinutes()
    const b = Math.floor(minuteOfHour / 5)
    const minute = h * 60 + minuteOfHour
    let focus = 0,
      dist = 0
    for (const tab of log.tabs || []) {
      const secs = tab.focusSeconds || 0
      if (PRODUCTIVE_CATEGORIES.has(tab.category)) focus += secs
      else dist += secs
    }
    next[h][b].focus += focus
    next[h][b].dist += dist
    next[h][b].distractions += log.windowMetrics?.tabChangeCount || 0
    todays.push({ minute, h, b, focus, dist })
  }

  todays.sort((a, b) => a.minute - b.minute)
  let runMin = -1,
    prevMin = -2
  const flush = () => {
    if (runMin < 0) return
    const len = prevMin - runMin + 1
    const cell = next[Math.floor(runMin / 60)][Math.floor((runMin % 60) / 5)]
    if (len > cell.longestStreak) cell.longestStreak = len
    runMin = -1
  }
  for (const m of todays) {
    const productive = m.focus > m.dist // && m.focus > 15
    if (productive) {
      if (m.minute === prevMin + 1 && runMin >= 0) {
        prevMin = m.minute
      } else {
        flush()
        runMin = m.minute
        prevMin = m.minute
      }
    } else {
      flush()
    }
  }
  flush()
  return next
}

// ---- Math ----
function elapsedSecs(s) {
  if (!s?.startedAt) return 0
  const ref = s.pausedAt ?? Date.now()
  return Math.max(
    0,
    Math.floor((ref - s.startedAt - (s.accumulatedPaused || 0)) / 1000)
  )
}
function shiftColor(p) {
  const a = { r: 219, g: 234, b: 254 },
    b = { r: 76, g: 29, b: 149 }
  return `rgb(${Math.round(a.r + (b.r - a.r) * p)}, ${Math.round(a.g + (b.g - a.g) * p)}, ${Math.round(a.b + (b.b - a.b) * p)})`
}
function shiftBreakColor(p) {
  const a = { r: 209, g: 250, b: 229 },
    b = { r: 13, g: 148, b: 136 }
  return `rgb(${Math.round(a.r + (b.r - a.r) * p)}, ${Math.round(a.g + (b.g - a.g) * p)}, ${Math.round(a.b + (b.b - a.b) * p)})`
}
function formatTime(secs) {
  const m = Math.floor(secs / 60),
    s = secs % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function formatCellTime(hourIndex, bucketIndex) {
  const hour = String(hourIndex).padStart(2, "0")
  const minute = String(bucketIndex * 5).padStart(2, "0")
  return `${hour}:${minute}`
}

// ---- Mock heatmap data (per cell: focus, dist, distractions, longestStreak) ----
function generateMockHeatmap() {
  const grid = []
  for (let h = 0; h < 24; h++) {
    const row = []
    for (let b = 0; b < 12; b++) {
      let focus = 0,
        dist = 0
      if (h >= 9 && h <= 12) {
        focus = Math.random() * 280 + 50
        dist = Math.random() * 60
      } else if (h >= 13 && h <= 17) {
        focus = Math.random() * 240 + 30
        dist = Math.random() * 90
      } else if (h >= 20 && h <= 23) {
        focus = Math.random() * 60
        dist = Math.random() * 200 + 60
      } else if (h >= 7 && h <= 8) {
        focus = Math.random() * 120
        dist = Math.random() * 80
      } else {
        focus = Math.random() * 30
        dist = Math.random() * 30
      }
      if (Math.random() < 0.15) {
        focus *= 0.2
        dist *= 1.4
      }

      const offTrailHits = Math.floor(dist / 35)
      const idleBlips = Math.random() < 0.4 ? Math.floor(Math.random() * 3) : 0
      const distractions = offTrailHits + idleBlips
      // longest contiguous focus streak in MINUTES (uses focus magnitude as a proxy)
      const longestStreak =
        focus > 80
          ? Math.max(3, Math.floor((focus / 60) * 0.8 + Math.random() * 6))
          : Math.floor(Math.random() * 3)

      row.push({
        focus: Math.round(focus),
        dist: Math.round(dist),
        distractions,
        longestStreak
      })
    }
    grid.push(row)
  }
  return grid
}

function heatColor(cell, maxTotal) {
  const total = cell.focus + cell.dist
  if (total < 4) return "rgba(0,0,0,0.04)"
  const ratio = cell.focus / total
  const r = Math.round(59 * ratio + 245 * (1 - ratio))
  const g = Math.round(130 * ratio + 158 * (1 - ratio))
  const b = Math.round(246 * ratio + 11 * (1 - ratio))
  const a = 0.18 + Math.min(1, total / maxTotal) * 0.82
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// ---- Components ----
function Sparkle({ x, y }) {
  return (
    <div
      className="absolute pointer-events-none text-[18px] animate-[sparklePop_700ms_ease-out_forwards]"
      style={{ left: x, top: y }}>
      ✨
    </div>
  )
}

function HeroRing({
  progress,
  size = 170,
  stroke = 14,
  color,
  primaryLabel,
  subLabel,
  mode
}) {
  const radius = (size - stroke) / 2
  const C = 2 * Math.PI * radius
  const offset = C - progress * C
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="absolute -inset-2 rounded-full blur-[8px] transition-opacity duration-[800ms]"
        style={{
          background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
          opacity: progress > 0 ? 1 : 0
        }}
      />
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {progress > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#ringGrad)"
            strokeWidth={stroke}
            fill="transparent"
            strokeDasharray={C}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="[transition:stroke-dashoffset_0.6s_linear] [transform:rotate(-90deg)] [transform-origin:50%_50%]"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-[#1F2937]">
        <div className="text-sm opacity-60 font-bold tracking-[2px] uppercase">
          {mode}
        </div>
        <div className="text-[32px] font-extrabold leading-none mt-0.5 tabular-nums">
          {primaryLabel}
        </div>
        <div className="text-sm opacity-60 mt-[3px] text-center px-2.5">
          {subLabel}
        </div>
      </div>
    </div>
  )
}

function HeatMap({ data }) {
  const [selected, setSelected] = useState(null) // { h, b, focus, dist, distractions, longestStreak }
  const maxTotal = Math.max(1, ...data.flat().map((c) => c.focus + c.dist))
  const HOURS = 24,
    BUCKETS = 12

  return (
    <div className="w-full flex flex-col">
      {/* ===== Legend (TOP) ===== */}
      <div className="flex items-center justify-center gap-4 mb-2 text-sm opacity-80">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-[rgba(59,130,246,0.85)] rounded-sm" />
          <span>Deep focus</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-[rgba(245,158,11,0.85)] rounded-sm" />
          <span>Tab-switching / scrolling</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-black/[0.06] rounded-sm" />
          <span>Quiet</span>
        </div>
      </div>

      {/* ===== Plot area: Y-axis title + grid ===== */}
      <div className="flex">
        {/* Y-axis title — "HOURS" */}
        <div
          className="flex items-center justify-center pr-1 select-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          <span className="text-sm font-bold opacity-70 tracking-[2px] uppercase">
            Hours
          </span>
        </div>

        <div className="flex-1">
          {/* Grid rows */}
          {Array.from({ length: BUCKETS }).map((_, b) => (
            <div
              key={b}
              className="grid gap-[2px] mb-0.5"
              style={{ gridTemplateColumns: `28px repeat(${HOURS}, 1fr)` }}>
              {/* Y-axis numbers — increment by 3 up to 12 (rows 2,5,8,11 → 3,6,9,12) */}
              <div className="text-sm opacity-60 text-right pr-1 flex items-center justify-end font-semibold">
                {(b + 1) % 3 === 0 ? `${b + 1}` : ""}
              </div>
              {Array.from({ length: HOURS }).map((_, h) => {
                const cell = data[h][b]
                const isSelected = selected?.h === h && selected?.b === b
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setSelected({ h, b, ...cell })}
                    title="Click for details"
                    className={`h-5 rounded-[3px] border-0 cursor-pointer transition-all duration-150 hover:scale-[1.25] hover:z-10 hover:shadow-md ${isSelected ? "ring-2 ring-gray-800 ring-offset-1 scale-[1.15]" : ""}`}
                    style={{ background: heatColor(cell, maxTotal) }}
                  />
                )
              })}
            </div>
          ))}

          {/* X-axis numbers (BOTTOM) — start at 1, +3: 1,4,7,10,13,16,19,22 */}
          <div
            className="grid gap-[2px] mt-1"
            style={{ gridTemplateColumns: `28px repeat(${HOURS}, 1fr)` }}>
            <div />
            {Array.from({ length: HOURS }).map((_, h) => (
              <div
                key={h}
                className={`text-sm opacity-60 text-center font-semibold ${h % 3 === 0 ? "visible" : "invisible"}`}>
                {h + 1}
              </div>
            ))}
          </div>

          {/* X-axis title */}
          <div className="text-sm font-bold opacity-70 tracking-[2px] uppercase text-center mt-1">
            Minutes
          </div>
        </div>
      </div>

      {/* ===== Selected cell detail ===== */}
      {selected && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-white/85 border border-black/10 flex items-center justify-between text-base animate-[fadeIn_200ms_ease]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-bold tabular-nums">
              {formatCellTime(selected.h, selected.b)}
            </span>
            <span className="opacity-75">
              Distracted{" "}
              <span
                className={`font-extrabold ${selected.distractions > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {selected.distractions}
              </span>{" "}
              {selected.distractions === 1 ? "time" : "times"}
            </span>
            <span className="opacity-75">
              Longest focus streak{" "}
              <span className="font-extrabold text-blue-600">
                {selected.longestStreak}m
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-base opacity-50 hover:opacity-100 cursor-pointer border-0 bg-transparent">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// =================================================================
function IndexPopup() {
  const [view, setView] = useState("heatmap")
  // const [timeframe, setTimeframe] = useState("24h")
  const [theme, setTheme] = useState("light")

  const [activeQuest, setActiveQuest] = useState(null)
  const [goal, setGoal] = useState(MICRO_GOALS[1])
  const [isCustom, setIsCustom] = useState(false)
  const [customWork, setCustomWork] = useState(20)
  const [customBreak, setCustomBreak] = useState(7)
  const [pendingMicroGoal, setPendingMicroGoal] = useState(null)

  const [timer, setTimer] = useState(null)
  const [, force] = useState(0)

  const [sparkles, setSparkles] = useState([])
  const [bodyDouble, setBodyDouble] = useState(127)
  const [showNudge, setShowNudge] = useState(false)
  const [activeProject] = useState("Deep Work")

  const [tabs, setTabs] = useState([
    {
      id: 1,
      title: "Google: react hooks tutorial",
      url: "google.com",
      contributing: false,
      visits: 3,
      secondsOn: 124,
      friction: 0.1
    },
    {
      id: 2,
      title: "useEffect docs",
      url: "react.dev",
      contributing: false,
      visits: 5,
      secondsOn: 312,
      friction: 0.2
    },
    {
      id: 3,
      title: "Stack Overflow: cleanup",
      url: "stackoverflow.com",
      contributing: false,
      visits: 2,
      secondsOn: 88,
      friction: 0.3
    },
    {
      id: 4,
      title: "Reddit r/programming",
      url: "reddit.com",
      contributing: false,
      visits: 8,
      secondsOn: 540,
      friction: 0.92
    }
  ])
  const [newDomain, setNewDomain] = useState("")
  const [savedCount, setSavedCount] = useState(0)
  const [heatData, setHeatData] = useState(emptyHeatmap())

  const [aiQuestion, setAiQuestion] = useState("What was my biggest distraction today?")
  const [aiAnswer, setAiAnswer] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState("")

  const containerRef = useRef(null)
  const hydratedRef = useRef(false)
  const settingsLoadedRef = useRef(false)
  const heatmapCacheRef = useRef({
    grid: emptyHeatmap(),
    lastTimestamp: null,
    date: null
  })

  const isSideQuest = activeQuest?.id === "sidequest"
  const isDark = theme === "dark"
  const hasPausedTimer =
    !!timer?.pausedAt && (timer.phase === "work" || timer.phase === "break")
  const localWorkMins = isCustom ? customWork : goal.mins
  const localBreakMins = isSideQuest ? 0 : isCustom ? customBreak : goal.break

  // ---- Initial load + storage subscription ----
  useEffect(() => {
    let mounted = true

    // Theme
    readTheme().then((savedTheme) => {
      if (mounted) setTheme(savedTheme === "dark" ? "dark" : "light")
    })

    // Micro goal
    readMicroGoal().then((savedGoal) => {
      if (!mounted || !savedGoal) return
      if (savedGoal.isCustom) {
        setIsCustom(true)
        setCustomWork(savedGoal.customWork || 20)
        setCustomBreak(savedGoal.customBreak ?? 7)
        return
      }
      const savedPreset = MICRO_GOALS.find(
        (g) => g.mins === savedGoal.mins && g.break === savedGoal.break
      )
      if (savedPreset) {
        setGoal(savedPreset)
        setIsCustom(false)
      }
    })

    // ✅ TRAIL DOMAINS (merged feature)
    readTrailDomains().then((savedDomains) => {
      if (!mounted || !savedDomains?.length) return

      const savedEntries = savedDomains
        .map(normalizeSavedDomain)
        .filter(Boolean)
        .filter(
          (entry, index, arr) =>
            arr.findIndex((o) => o.domain === entry.domain) === index
        )

      if (!savedEntries.length) return

      setTabs((currentTabs) => {
        const savedMap = new Map(savedEntries.map((e) => [e.domain, e.status]))

        const existing = new Set(currentTabs.map((t) => normalizeDomain(t.url)))

        // restore existing tabs
        const restored = currentTabs.map((tab) => {
          const domain = normalizeDomain(tab.url)
          if (!savedMap.has(domain)) return tab

          const status = savedMap.get(domain)

          return {
            ...tab,
            savedDomain: true,
            domainStatus: status,
            contributing:
              status === "productive"
                ? true
                : status === "distraction"
                  ? false
                  : null
          }
        })

        // add missing saved domains
        const newTabs = savedEntries
          .filter((e) => !existing.has(e.domain))
          .map((e) => createTrailTab(e.domain, e.status))

        return [...restored, ...newTabs]
      })
    })

    // Timer sync
    const sync = async () => {
      const s = await readStore()
      if (!mounted) return

      setTimer(s)

      if (!hydratedRef.current && s?.quest) {
        const q = QUEST_TAGS.find((t) => t.id === s.quest.id)
        if (q) setActiveQuest(q)
        hydratedRef.current = true
      }
    }

    sync()

    const onChanged = (changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) sync()
    }

    if (hasChrome && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(onChanged)
    }

    return () => {
      mounted = false
      if (hasChrome && chrome.storage.onChanged) {
        chrome.storage.onChanged.removeListener(onChanged)
      }
    }
  }, [])

  // ---- Local tick: phase transitions + UI re-render ----
  useEffect(() => {
    const id = setInterval(async () => {
      const s = await readStore()
      if (!s) {
        setTimer(null)
        force((t) => t + 1)
        return
      }
      if (
        s.startedAt &&
        !s.pausedAt &&
        (s.phase === "work" || s.phase === "break")
      ) {
        const total = s.phase === "work" ? s.workSecs : s.breakSecs
        const e = elapsedSecs(s)
        if (e >= total) {
          let next
          if (s.phase === "work" && s.hasBreak && s.breakSecs > 0) {
            next = {
              ...s,
              phase: "break",
              startedAt: Date.now(),
              accumulatedPaused: 0,
              pausedAt: null
            }
          } else {
            next = { ...s, phase: "done", startedAt: null, pausedAt: null }
          }
          await writeStore(next)
          setTimer(next)
        } else {
          setTimer(s)
        }
      } else {
        setTimer(s)
      }
      force((t) => t + 1)
    }, 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setBodyDouble((n) => Math.max(50, n + Math.floor(Math.random() * 7 - 3)))
    }, 4000)
    return () => clearInterval(id)
  }, [])

  // ---- User record load + heatmap incremental sync ----
  useEffect(() => {
    let mounted = true
    let intervalId = null

    const fetchHeat = async (userId) => {
      if (!mounted) return
      try {
        const today = todayKey()
        const cache = heatmapCacheRef.current
        const useBase = cache.date === today && isValidGrid(cache.grid)
        const base = useBase ? cache.grid : emptyHeatmap()
        const since = useBase ? cache.lastTimestamp : null

        const url = since
          ? `${BACKEND_URL}/activity/${userId}?since=${encodeURIComponent(since)}`
          : `${BACKEND_URL}/activity/${userId}`
        const res = await fetch(url)
        const { logs } = await res.json()
        if (!mounted) return

        if (!logs || logs.length === 0) {
          if (!useBase) {
            heatmapCacheRef.current = {
              grid: base,
              lastTimestamp: null,
              date: today
            }
            setHeatData(base)
          }
          return
        }

        const newGrid = mergeLogsIntoGrid(base, logs)

        let latestTs = since
        for (const log of logs) {
          const d = parseTimestamp(log.timestamp)
          if (isNaN(d.getTime())) continue
          const iso = d.toISOString()
          if (!latestTs || iso > latestTs) latestTs = iso
        }

        heatmapCacheRef.current = {
          grid: newGrid,
          lastTimestamp: latestTs,
          date: today
        }
        setHeatData(newGrid)

        try {
          await fetch(`${BACKEND_URL}/users/${userId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              heatmap: { date: today, grid: newGrid, lastTimestamp: latestTs }
            })
          })
        } catch (e) {
          console.warn("heatmap save failed", e)
        }
      } catch (e) {
        console.warn("heatmap fetch failed", e)
      }
    }

    const init = async () => {
      const userId = await readUserId()
      if (!userId) {
        settingsLoadedRef.current = true
        return
      }

      try {
        const res = await fetch(`${BACKEND_URL}/users/${userId}`)
        const { user } = await res.json()
        const s = user?.settings || {}
        if (!mounted) return
        if (s.quest) setActiveQuest((prev) => prev ?? s.quest)
        if (s.goal && typeof s.goal.mins === "number") setGoal(s.goal)
        if (typeof s.isCustom === "boolean") setIsCustom(s.isCustom)
        if (typeof s.customWork === "number") setCustomWork(s.customWork)
        if (typeof s.customBreak === "number") setCustomBreak(s.customBreak)
        if (typeof s.savedCount === "number") setSavedCount(s.savedCount)
        if (s.view === "heatmap" || s.view === "focus") setView(s.view)
        if (Array.isArray(s.tabs)) setTabs(s.tabs)

        const today = todayKey()
        const cached = user?.heatmap
        if (cached && cached.date === today && isValidGrid(cached.grid)) {
          heatmapCacheRef.current = {
            grid: cached.grid,
            lastTimestamp: cached.lastTimestamp || null,
            date: today
          }
          setHeatData(cached.grid)
        } else {
          heatmapCacheRef.current = {
            grid: emptyHeatmap(),
            lastTimestamp: null,
            date: today
          }
        }

        if (user?.timer) {
          const localTimer = await readStore()
          if (!localTimer && mounted) {
            await writeStore(user.timer)
            setTimer(user.timer)
          }
        }
      } catch (e) {
        console.warn("user fetch failed", e)
      } finally {
        settingsLoadedRef.current = true
      }

      if (!mounted) return
      await fetchHeat(userId)
      intervalId = setInterval(() => fetchHeat(userId), 60_000)
    }

    init()
    return () => {
      mounted = false
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  // ---- Settings save (debounced) ----
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    const id = setTimeout(async () => {
      const userId = await readUserId()
      if (!userId) return
      const settings = {
        quest: activeQuest,
        goal,
        isCustom,
        customWork,
        customBreak,
        savedCount,
        view,
        tabs
      }
      try {
        await fetch(`${BACKEND_URL}/users/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings })
        })
      } catch (e) {
        console.warn("settings save failed", e)
      }
    }, 500)
    return () => clearTimeout(id)
  }, [activeQuest, goal, isCustom, customWork, customBreak, savedCount, view, tabs])

  // ---- Timer save (scalar deps to avoid 250ms tick churn) ----
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    const id = setTimeout(async () => {
      const userId = await readUserId()
      if (!userId) return
      try {
        await fetch(`${BACKEND_URL}/users/${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timer })
        })
      } catch (e) {
        console.warn("timer save failed", e)
      }
    }, 500)
    return () => clearTimeout(id)
  }, [
    timer?.phase,
    timer?.startedAt,
    timer?.pausedAt,
    timer?.workSecs,
    timer?.breakSecs,
    timer?.accumulatedPaused,
    timer?.hasBreak,
    timer?.quest?.id
  ])

  // ---- Mirror saved-domain tabs to chrome.storage trail domains ----
  useEffect(() => {
    if (!settingsLoadedRef.current) return
    const saved = tabs
      .filter((t) => t.savedDomain)
      .map((t) => ({
        domain: normalizeDomain(t.url),
        status: t.domainStatus || "stored"
      }))
      .filter((e) => e.domain)
    writeTrailDomains(saved).catch((e) =>
      console.warn("trail domains save failed", e)
    )
  }, [tabs])

  useEffect(() => {
    const distract = tabs.find((t) => !t.contributing && t.friction > 0.85)
    if (distract && timer?.phase === "work" && !timer?.pausedAt) {
      const t = setTimeout(() => setShowNudge(true), 6000)
      return () => clearTimeout(t)
    }
  }, [tabs, timer])

  // ---- Handlers ----
  const toggleTheme = async () => {
    const next = isDark ? "light" : "dark"
    setTheme(next)
    await writeTheme(next)
  }
  const applyMicroGoal = async (selection) => {
    const nextWork = selection.isCustom
      ? selection.customWork
      : selection.goal.mins
    const nextBreak = isSideQuest
      ? 0
      : selection.isCustom
        ? selection.customBreak
        : selection.goal.break

    if (selection.isCustom) {
      setIsCustom(true)
      setCustomWork(nextWork)
      setCustomBreak(nextBreak)
      await writeMicroGoal({
        isCustom: true,
        customWork: nextWork,
        customBreak: nextBreak
      })
    } else {
      setGoal(selection.goal)
      setIsCustom(false)
      await writeMicroGoal({
        isCustom: false,
        mins: selection.goal.mins,
        break: selection.goal.break
      })
    }

    if (hasPausedTimer) {
      const nextTimer = {
        ...timer,
        phase: "done",
        startedAt: null,
        pausedAt: null,
        accumulatedPaused: 0,
        workSecs: nextWork * 60,
        breakSecs: nextBreak * 60,
        hasBreak: !isSideQuest
      }
      await writeStore(nextTimer)
      setTimer(nextTimer)
    }

    setPendingMicroGoal(null)
  }
  const chooseMicroGoal = async (nextGoal) => {
    const selection = {
      isCustom: false,
      goal: nextGoal,
      label: `${nextGoal.mins}m${isSideQuest ? "" : ` + ${nextGoal.break}m break`}`
    }
    if (hasPausedTimer) {
      setPendingMicroGoal(selection)
      return
    }
    await applyMicroGoal(selection)
  }
  const chooseCustomGoal = async () => {
    setIsCustom(true)
    if (hasPausedTimer) {
      setPendingMicroGoal({
        isCustom: true,
        customWork,
        customBreak,
        label: `${customWork}m${isSideQuest ? "" : ` + ${customBreak}m break`}`
      })
      return
    }
    await writeMicroGoal({ isCustom: true, customWork, customBreak })
  }
  const updateCustomWork = async (value) => {
    const next = Math.max(1, parseInt(value) || 1)
    setCustomWork(next)
    if (hasPausedTimer) {
      setPendingMicroGoal({
        isCustom: true,
        customWork: next,
        customBreak,
        label: `${next}m${isSideQuest ? "" : ` + ${customBreak}m break`}`
      })
      return
    }
    await writeMicroGoal({ isCustom: true, customWork: next, customBreak })
  }
  const updateCustomBreak = async (value) => {
    const next = Math.max(0, parseInt(value) || 0)
    setCustomBreak(next)
    if (hasPausedTimer) {
      setPendingMicroGoal({
        isCustom: true,
        customWork,
        customBreak: next,
        label: `${customWork}m + ${next}m break`
      })
      return
    }
    await writeMicroGoal({ isCustom: true, customWork, customBreak: next })
  }

  const triggerReward = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const x = (e?.clientX ?? 0) - (rect?.left || 0)
    const y = (e?.clientY ?? 0) - (rect?.top || 0)
    const id = Date.now()
    setSparkles((s) => [...s, { id, x, y }])
    setTimeout(() => setSparkles((s) => s.filter((sp) => sp.id !== id)), 700)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g)
      g.connect(ctx.destination)
      o.frequency.value = 880
      g.gain.setValueAtTime(0.05, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      o.start()
      o.stop(ctx.currentTime + 0.15)
    } catch {}
  }
  const pickQuest = (q, e) => {
    setActiveQuest(q)
    triggerReward(e)
  }

  const savedDomainTabs = tabs.filter(
    (t) => t.savedDomain && t.contributing === null
  )
  const contributingTabs = tabs.filter((t) => t.contributing === true)
  const sideQuestTabs = tabs.filter((t) => t.contributing === false)
  const totalContributingSecs = contributingTabs.reduce(
    (sum, t) => sum + t.secondsOn,
    0
  )

  const canStart =
    !!activeQuest &&
    contributingTabs.length > 0 &&
    (!isCustom || (customWork > 0 && (isSideQuest || customBreak >= 0)))

  const startQuest = async () => {
    if (!canStart) return
    const next = {
      phase: "work",
      startedAt: Date.now(),
      pausedAt: null,
      accumulatedPaused: 0,
      workSecs: localWorkMins * 60,
      breakSecs: localBreakMins * 60,
      quest: activeQuest,
      hasBreak: !isSideQuest
    }
    await writeStore(next)
    setTimer(next)
  }
  const pauseQuest = async () => {
    if (!timer || timer.pausedAt) return
    const next = { ...timer, pausedAt: Date.now() }
    await writeStore(next)
    setTimer(next)
  }
  const resumeQuest = async () => {
    if (!timer || !timer.pausedAt) return
    setPendingMicroGoal(null)
    const next = {
      ...timer,
      accumulatedPaused:
        (timer.accumulatedPaused || 0) + (Date.now() - timer.pausedAt),
      pausedAt: null
    }
    await writeStore(next)
    setTimer(next)
  }
  const resetQuest = async () => {
    await writeStore(null)
    setTimer(null)
  }

  const addTrailDomain = () => {
    const v = newDomain.trim()
    if (!v) return
    const domain = normalizeDomain(v)
    if (!domain) return
    setTabs((ts) => {
      if (ts.some((t) => normalizeDomain(t.url) === domain)) return ts
      return [...ts, createTrailTab(domain, "stored")]
    })
    setNewDomain("")
  }
  const classifySavedDomain = (id, status) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === id
          ? {
              ...t,
              domainStatus: status,
              contributing: status === "productive"
            }
          : t
      )
    )
  }
  const deleteSavedDomain = (id) => {
    setTabs((ts) => ts.filter((t) => t.id !== id))
  }
  const moveSavedDomainToStored = (id) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === id
          ? { ...t, domainStatus: "stored", contributing: null }
          : t
      )
    )
  }


  const askUsageQuestion = async () => {
    const question = aiQuestion.trim()
    if (!question || aiLoading) return

    setAiLoading(true)
    setAiError("")

    try {
      const userId = await readUserId()
      if (!userId) {
        throw new Error("No user ID found yet. Open the extension once after login, then try again.")
      }

      const response = await fetch(
        `${BACKEND_URL}/ai/usage/${encodeURIComponent(userId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question })
        }
      )

      const responseText = await response.text()
      let data
      try {
        data = responseText ? JSON.parse(responseText) : {}
      } catch {
        data = {
          detail: responseText || "The backend returned a non-JSON response."
        }
      }

      if (!response.ok) {
        throw new Error(data?.detail || "Could not get an insight yet.")
      }

      setAiAnswer(data.answer || "No answer returned yet.")
    } catch (error) {
      setAiError(error?.message || "Could not reach the AI coach.")
    } finally {
      setAiLoading(false)
    }
  }

  // ---- Display values ----
  const phase = timer?.phase || "idle"
  const running =
    !!timer?.startedAt &&
    !timer?.pausedAt &&
    (phase === "work" || phase === "break")
  const liveElapsed = timer ? elapsedSecs(timer) : 0

  const displayWorkTotal =
    phase === "work" || phase === "break" ? timer.workSecs : localWorkMins * 60
  const displayBreakTotal =
    phase === "work" || phase === "break"
      ? timer.breakSecs
      : localBreakMins * 60
  const totalSecs = phase === "break" ? displayBreakTotal : displayWorkTotal
  const progress = totalSecs > 0 ? Math.min(liveElapsed / totalSecs, 1) : 0
  const bgColor =
    phase === "break"
      ? shiftBreakColor(progress)
      : phase === "work"
        ? shiftColor(progress)
        : "rgb(245, 247, 252)"
  const appBackground = isDark
    ? `linear-gradient(180deg, #101827 0%, #0B1020 72%, ${phase === "idle" ? "#111827" : bgColor} 170%)`
    : `linear-gradient(180deg, ${bgColor} 0%, #FFFFFF 130%)`
  const ringColor =
    phase === "break" ? "#0D9488" : activeQuest?.color || "#7C5CFF"

  const timeLeft = formatTime(Math.max(totalSecs - liveElapsed, 0))
  const ringMode =
    phase === "idle"
      ? "Ready"
      : phase === "work"
        ? "Focus"
        : phase === "break"
          ? "Break"
          : "Done"
  const ringSub =
    phase === "idle"
      ? isSideQuest
        ? `${localWorkMins}m · no break`
        : `${localWorkMins}m focus · ${localBreakMins}m break`
      : phase === "work"
        ? timer?.hasBreak && timer?.breakSecs > 0
          ? `then ${Math.round(timer.breakSecs / 60)}m break`
          : "no break this round"
        : phase === "break"
          ? "rest your brain"
          : "🎉 nice work"

  return (
    <div
      ref={containerRef}
      data-theme={theme}
      className="relative w-[760px] h-[580px] p-[14px] font-['Segoe_UI_Variable','Segoe_UI',system-ui,sans-serif] text-[#1F2937] text-base overflow-hidden box-border flex flex-col transition-[background] duration-[1200ms]"
      style={{ background: appBackground }}>
      <style>{`
        @keyframes sparklePop { 0%{transform:scale(.4) translateY(0);opacity:1} 100%{transform:scale(1.6) translateY(-30px);opacity:0} }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:.6} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .quest-btn { border:none; padding:7px 12px; border-radius:999px; font-size:0.875rem; font-weight:600; cursor:pointer; color:white;
          transition: opacity 220ms ease, transform 120ms ease, box-shadow 120ms ease; }
        .quest-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .card { background: rgba(255,255,255,0.82); backdrop-filter: blur(8px);
          border-radius: 12px; padding: 10px 12px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.06); animation: fadeIn 300ms ease; box-sizing: border-box; }
        .tab-row { display:flex; align-items:center; gap:8px; padding:5px 7px; border-radius:8px; margin-bottom:3px;
          font-size:11px; background: rgba(255,255,255,0.6); transition: background 200ms ease; }
        .tab-contrib { background: linear-gradient(90deg, #DCFCE7, rgba(255,255,255,0.6)); border-left: 3px solid #34D399; }
        .tab-side    { background: linear-gradient(90deg, #FEE2E2, rgba(255,255,255,0.6)); border-left: 3px solid #EF4444; opacity: 0.9; }
        .scroll-y { overflow-y:auto; scrollbar-width: thin; }
        .scroll-y::-webkit-scrollbar { width: 6px; }
        .scroll-y::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
        .icon-btn { border:none; background: rgba(0,0,0,0.06); padding:5px 10px; border-radius:999px;
          font-size:1rem; font-weight:700; cursor:pointer; color:#1F2937; transition: background 150ms ease; }
        .icon-btn:hover { background: rgba(0,0,0,0.12); }
        .brand-lockup { display:flex; align-items:center; gap:9px; }
        .brand-mark {
          width:30px; height:30px; border-radius:9px;
          display:flex; align-items:center; justify-content:center;
          background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
          color:#92400E; font-size:17px;
          box-shadow: 0 8px 18px rgba(245,158,11,0.22);
        }
        .brand-name {
          font-family: "Playfair Display", Georgia, "Times New Roman", serif;
          font-size:22px; font-weight:700; line-height:1;
          letter-spacing:0;
          color:#111827;
        }
        .brand-subtitle {
          margin-top:2px; font-size:0.875rem; font-weight:650;
          color:rgba(31,41,55,0.62); letter-spacing:0;
        }
        .theme-toggle {
          border:1px solid rgba(17,24,39,0.08);
          background: rgba(255,255,255,0.72);
          color:#1F2937;
          width:30px; height:30px; border-radius:999px;
          display:flex; align-items:center; justify-content:center;
          font-size:14px; cursor:pointer;
          box-shadow: 0 4px 12px rgba(31,41,55,0.08);
          transition: transform 150ms ease, background 150ms ease, box-shadow 150ms ease;
        }
        .theme-toggle:hover { transform: translateY(-1px); box-shadow: 0 7px 16px rgba(31,41,55,0.12); }
        .theme-pill { color:#1F2937; }
        [data-theme="dark"] { color:#E5E7EB; }
        [data-theme="dark"] .card {
          background: rgba(15,23,42,0.78);
          border: 1px solid rgba(148,163,184,0.16);
          box-shadow: 0 8px 24px rgba(0,0,0,0.22);
        }
        [data-theme="dark"] .tab-row { background: rgba(30,41,59,0.72); }
        [data-theme="dark"] .tab-contrib {
          background: linear-gradient(90deg, rgba(20,83,45,0.68), rgba(15,23,42,0.5));
        }
        [data-theme="dark"] .tab-side {
          background: linear-gradient(90deg, rgba(127,29,29,0.68), rgba(15,23,42,0.5));
        }
        [data-theme="dark"] .icon-btn,
        [data-theme="dark"] .theme-toggle,
        [data-theme="dark"] .theme-pill {
          background: rgba(15,23,42,0.72);
          border-color: rgba(148,163,184,0.18);
          color:#E5E7EB;
        }
        [data-theme="dark"] .brand-name { color:#F8FAFC; }
        [data-theme="dark"] .brand-subtitle { color:rgba(226,232,240,0.68); }
        [data-theme="dark"] input {
          background: rgba(15,23,42,0.8);
          color:#F8FAFC;
          border-color: rgba(148,163,184,0.24);
        }
        [data-theme="dark"] .text-\\[\\#1F2937\\],
        [data-theme="dark"] .text-\\[\\#111827\\] {
          color:#F8FAFC !important;
        }
      `}</style>

      {sparkles.map((s) => (
        <Sparkle key={s.id} x={s.x} y={s.y} />
      ))}

      {/* Header */}
      <div className="flex items-center justify-between mb-2.5 shrink-0">
        <div className="flex items-center gap-2.5">
          {view === "focus" && (
            <button className="icon-btn" onClick={() => setView("heatmap")}>
              ← Back
            </button>
          )}
          <div className="brand-lockup">
            <div className="brand-mark">💡</div>
            <div>
              <div className="brand-name">FlowState</div>
              <div className="brand-subtitle">
                {view === "heatmap"
                  ? "Today's focus rhythm"
                  : "Your supportive coach"}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            className="theme-toggle"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}>
            {isDark ? "☀" : "☾"}
          </button>
          {(phase === "work" || phase === "break") && view === "heatmap" && (
            <button className="icon-btn" onClick={() => setView("focus")}>
              ⏱ {timeLeft}
            </button>
          )}
          <div
            title="Other FlowState users in a focus session right now"
            className="theme-pill flex items-center gap-1.5 bg-white/70 px-2.5 py-[5px] rounded-full text-sm font-semibold">
            <span className="inline-block w-2 h-2 rounded-full bg-[#34D399] animate-[pulse_1.6s_infinite]" />
            {bodyDouble} others focusing now
          </div>
        </div>
      </div>

      {/* ============== HEATMAP (DEFAULT) ============== */}
      {view === "heatmap" && (
        <div className="grid grid-cols-[minmax(0,1fr)_230px] flex-1 min-h-0 gap-2.5">
          <div className="flex flex-col min-h-0 gap-2.5">
            <div className="card flex-1 flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-2 gap-3">
              <div className="text-base font-bold opacity-70 tracking-[1px]">
                📊 ACTIVITY HEAT MAP
              </div>

              {/* Timeframe selector */}
              {/* <div className="flex items-center gap-1 bg-black/[0.05] rounded-full p-0.5">
                {TIMEFRAMES.map((tf) => {
                  const active = timeframe === tf.id
                  return (
                    <button
                      key={tf.id}
                      onClick={() => setTimeframe(tf.id)}
                      className={`px-2.5 py-[3px] rounded-full text-sm font-bold transition-colors cursor-pointer ${active ? "bg-[#1F2937] text-white" : "text-[#1F2937]/70 hover:text-[#1F2937]"}`}>
                      {tf.label}
                    </button>
                  )
                })}
              </div> */}

              <div className="text-xs opacity-[0.55] whitespace-nowrap">
                Privacy-respecting · no URLs shown
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0 px-0.5 py-1">
              <HeatMap data={heatData} />
            </div>
          </div>

            <button
              onClick={() => setView("focus")}
              className="p-3 border-0 rounded-xl bg-[#1F2937] text-white font-bold text-base cursor-pointer shadow-[0_4px_14px_rgba(0,0,0,0.15)] shrink-0 transition-transform duration-[120ms]"
            onMouseDown={(e) =>
              (e.currentTarget.style.transform = "scale(0.98)")
            }
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
            {phase === "work" || phase === "break"
              ? `▶ Resume Focus Session · ${timeLeft}`
              : "✨ Start a Focus Session"}
          </button>
          </div>

          <div className="card flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[11px] font-bold opacity-70 tracking-[1px]">
                AI USAGE COACH
              </div>
              <button
                type="button"
                onClick={() =>
                  setAiQuestion(
                    "Summarize my focus patterns and give me one recommendation."
                  )
                }
                className="icon-btn">
                Suggest
              </button>
            </div>

            <div className="flex flex-col gap-2 shrink-0">
              <textarea
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    askUsageQuestion()
                  }
                }}
                placeholder="Ask about your usage..."
                className="w-full h-[74px] resize-none px-3 py-2 text-[11px] leading-snug border border-black/10 rounded-lg bg-white/85 outline-none box-border"
              />

              <button
                type="button"
                onClick={askUsageQuestion}
                disabled={aiLoading || !aiQuestion.trim()}
                className={`w-full px-3 py-2 rounded-lg border-0 text-white text-[11px] font-bold ${
                  aiLoading || !aiQuestion.trim()
                    ? "bg-black/15 cursor-not-allowed"
                    : "bg-[#1F2937] cursor-pointer"
                }`}>
                {aiLoading ? "Thinking..." : "Ask"}
              </button>
            </div>

            <div
              className={`mt-2 flex-1 min-h-0 px-3 py-2 rounded-lg text-[11px] leading-relaxed border scroll-y whitespace-pre-wrap ${
                aiError
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-white/85 border-black/10 text-[#1F2937]"
              }`}>
              {aiLoading ? (
                <span className="opacity-60">
                  Reading your recent activity...
                </span>
              ) : aiError || aiAnswer ? (
                aiError || aiAnswer
              ) : (
                <span className="opacity-55">
                  Ask a question to see personalized usage insight here.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============== FOCUS / TIMER VIEW ============== */}
      {view === "focus" && (
        <div className="grid grid-cols-2 gap-2.5 flex-1 min-h-0">
          {/* LEFT */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="card shrink-0 !py-3 !px-3">
              <div className="text-sm font-bold opacity-[0.55] mb-6 tracking-[1.5px]">
                1 · CHOOSE YOUR QUEST
              </div>
              <div className="flex flex-wrap gap-[5px]">
                {QUEST_TAGS.map((q) => {
                  const selected = activeQuest?.id === q.id
                  const dimmed = activeQuest && !selected
                  return (
                    <button
                      key={q.id}
                      onClick={(e) => pickQuest(q, e)}
                      className={`quest-btn ${dimmed ? "opacity-[0.35]" : "opacity-100"} ${selected ? "outline outline-[3px] outline-black/15" : "outline-none"}`}
                      style={{ background: q.color }}>
                      {q.label}
                    </button>
                  )
                })}
              </div>
              {isSideQuest && (
                <div className="text-sm opacity-70 mt-[5px] italic">
                  Distrations are stimulation, not failure — running without a
                  break.
                </div>
              )}
            </div>

            <div className="card flex-1 flex flex-col min-h-0 py-6">
              <div className="flex justify-between items-center">
                <div className="text-sm font-bold opacity-[0.65] tracking-[1px]">
                  2 · 🧭 GOAL MAP
                </div>
                {/* <button onClick={brainDump} disabled={sideQuestTabs.length === 0}
                  className={`border-0 px-2 py-[3px] rounded-full text-white text-xs font-bold ${sideQuestTabs.length ? "bg-[#EF4444] cursor-pointer" : "bg-black/10 cursor-not-allowed"}`}>
                  🔥 Brain Dump ({sideQuestTabs.length})
                </button> */}
              </div>

              <div className="flex gap-[5px] my-6 shrink-0">
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTrailDomain()}
                  placeholder="Add a domain (e.g. react.dev)"
                  className="flex-1 px-[9px] py-[5px] text-base border border-black/10 rounded-lg bg-white/80 outline-none"
                />
                <button
                  onClick={addTrailDomain}
                  disabled={!newDomain.trim()}
                  className={`border-0 px-[11px] py-[5px] rounded-lg text-white text-base font-bold ${newDomain.trim() ? "bg-[#1F2937] cursor-pointer" : "bg-black/10 cursor-not-allowed"}`}>
                  + Add
                </button>
              </div>

              <div className="scroll-y flex-1 min-h-0 pr-1">
                {savedDomainTabs.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-[#4F46E5] mb-[3px] tracking-[0.5px]">
                      STORED DOMAINS
                    </div>
                    {savedDomainTabs.map((t) => (
                      <div key={`stored-${t.id}`} className="tab-row">
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate font-semibold text-base">
                            {t.title}
                          </div>
                          <div className="text-[0.875rem] opacity-60 truncate">
                            {t.url}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            classifySavedDomain(t.id, "productive")
                          }
                          title="Add to productive"
                          className={`border-0 rounded-md px-2 py-1 text-xs font-bold cursor-pointer ${t.domainStatus === "productive" ? "bg-[#059669] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
                          Productive
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            classifySavedDomain(t.id, "distraction")
                          }
                          title="Add to distractions"
                          className={`border-0 rounded-md px-2 py-1 text-xs font-bold cursor-pointer ${t.domainStatus === "distraction" ? "bg-[#DC2626] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
                          Distraction
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedDomain(t.id)}
                          title="Delete domain"
                          aria-label={`Delete ${t.url}`}
                          className="border-0 rounded-md px-2 py-1 text-sm font-bold cursor-pointer bg-black/[0.06] text-[#1F2937]">
                          x
                        </button>
                      </div>
                    ))}
                  </>
                )}

                <div className="text-sm font-bold text-[#059669] mb-[3px] tracking-[0.5px]">
                  ✓ PRODUCTIVE TABS · {formatTime(totalContributingSecs)}{" "}
                  invested
                </div>
                {contributingTabs.length === 0 && (
                  <div className="text-sm opacity-50 italic pt-[3px] pb-1.5">
                    No productive tabs yet. Add one to unlock the timer.
                  </div>
                )}
                {contributingTabs.map((t) => (
                  <div key={t.id} className="tab-row tab-contrib">
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate font-semibold text-base">
                        {t.title}
                      </div>
                      <div className="text-[0.875rem] opacity-60 flex gap-1.5">
                        <span>{t.url}</span>
                        <span>·</span>
                        <span>{t.visits} visits</span>
                        <span>·</span>
                        <span>{formatTime(t.secondsOn)}</span>
                      </div>
                    </div>
                    {t.savedDomain && (
                      <button
                        type="button"
                        onClick={() => moveSavedDomainToStored(t.id)}
                        title="Move back to stored domains"
                        aria-label={`Move ${t.url} back to stored domains`}
                        className="border-0 rounded-md px-2 py-1 text-sm font-bold cursor-pointer bg-black/[0.06] text-[#1F2937]">
                        ↑
                      </button>
                    )}
                  </div>
                ))}

                {sideQuestTabs.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-[#DC2626] mt-1.5 mb-[3px] tracking-[0.5px]">
                      🐇 DISTRACTIONS · stimulation, not failure
                    </div>
                    {sideQuestTabs.map((t) => (
                      <div key={t.id} className="tab-row tab-side">
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate text-base font-semibold">
                            {t.title}
                          </div>
                          <div className="text-[0.875rem] opacity-60 flex gap-1.5">
                            <span>{t.url}</span>
                            <span>·</span>
                            <span>{t.visits} visits</span>
                            <span>·</span>
                            <span>{formatTime(t.secondsOn)}</span>
                          </div>
                        </div>
                        {t.savedDomain && (
                          <button
                            type="button"
                            onClick={() => moveSavedDomainToStored(t.id)}
                            title="Move back to stored domains"
                            aria-label={`Move ${t.url} back to stored domains`}
                            className="border-0 rounded-md px-2 py-1 text-sm font-bold cursor-pointer bg-black/[0.06] text-[#1F2937]">
                            ↑
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {savedCount > 0 && (
                  <div className="mt-1.5 text-sm opacity-70">
                    💾 {savedCount} tab{savedCount !== 1 ? "s" : ""} saved to
                    "Read Later"
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="card flex-1 flex flex-col overflow-y-auto">
              <HeroRing
                progress={progress}
                color={ringColor}
                primaryLabel={
                  phase === "idle" || phase === "done"
                    ? formatTime(displayWorkTotal)
                    : timeLeft
                }
                subLabel={ringSub}
                mode={ringMode}
              />

              <div className="mt-1">
                <div className="text-sm font-bold opacity-[0.55] mb-6 tracking-[1.5px] text-center">
                  3 · MICRO-GOAL{isSideQuest ? " (no break)" : ""}
                </div>
                {/* 4-col tracking grid lets the 4 micro-goals form a 2×2,
    while the custom button sits centered (col-start-2 col-span-2)
    below them as the bottom-middle slot. */}
                <div className="grid grid-cols-4 gap-1.5">
                  {MICRO_GOALS.map((g) => {
                    const selected =
                      pendingMicroGoal?.isCustom === false
                        ? pendingMicroGoal.goal.mins === g.mins
                        : !isCustom && goal.mins === g.mins
                    return (
                      <button
                        key={g.mins}
                        onClick={() => chooseMicroGoal(g)}
                        disabled={running}
                        className={`col-span-2 border-0 px-2 py-2.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 ${running ? "cursor-not-allowed" : "cursor-pointer"} ${selected ? "bg-[#1F2937] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
                        <span className="text-[1rem]">{g.mins}m</span>
                        {!isSideQuest && (
                          <span className="text-[0.875rem] opacity-70 font-medium">
                            +{g.break}m break
                          </span>
                        )}
                      </button>
                    )
                  })}

                  {/* Custom — centered under the 2×2 */}
                  <button
                    onClick={chooseCustomGoal}
                    disabled={running}
                    className={`col-start-2 col-span-2 border-0 px- py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-2 min-h-[38px] ${running ? "cursor-not-allowed" : "cursor-pointer"} ${pendingMicroGoal?.isCustom || (!pendingMicroGoal && isCustom) ? "bg-[#1F2937] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
                    <span className="text-[1.1rem]">⚙</span>
                    <span className="text-[0.875rem] opacity-70 font-medium">
                      custom
                    </span>
                  </button>
                </div>

                {isCustom && (
                  <div className="flex gap-2 mt-[5px] items-center justify-center">
                    <label className="text-sm font-semibold opacity-70">
                      Work
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={customWork}
                        onChange={(e) => updateCustomWork(e.target.value)}
                        disabled={running}
                        className={inputClasses}
                      />{" "}
                      m
                    </label>
                    {!isSideQuest && (
                      <label className="text-sm font-semibold opacity-70">
                        Break
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={customBreak}
                          onChange={(e) => updateCustomBreak(e.target.value)}
                          disabled={running}
                          className={inputClasses}
                        />{" "}
                        m
                      </label>
                    )}
                  </div>
                )}
                {pendingMicroGoal && (
                  <button
                    type="button"
                    onClick={() => applyMicroGoal(pendingMicroGoal)}
                    className="mt-2 w-full border-0 rounded-lg bg-[#F59E0B] text-white text-sm font-bold px-3 py-2 cursor-pointer shadow-[0_4px_12px_rgba(245,158,11,0.28)]">
                    Confirm new time: {pendingMicroGoal.label}
                  </button>
                )}
              </div>

              <div className="mt-auto pt-2 flex gap-1.5">
                {phase === "idle" || phase === "done" ? (
                  <button
                    onClick={startQuest}
                    disabled={!canStart}
                    title={
                      !activeQuest
                        ? "Pick a quest first"
                        : contributingTabs.length === 0
                          ? "Add at least 1 trail tab"
                          : ""
                    }
                    className={`flex-1 p-2.5 rounded-xl border-0 text-white font-bold text-base transition-all duration-200 ${canStart ? "cursor-pointer" : "cursor-not-allowed"}`}
                    style={{
                      background: canStart ? ringColor : "rgba(0,0,0,0.15)",
                      boxShadow: canStart ? `0 4px 14px ${ringColor}55` : "none"
                    }}>
                    {!activeQuest
                      ? "Pick a quest ↖"
                      : contributingTabs.length === 0
                        ? "Add a trail tab ↖"
                        : `▶ Start ${activeQuest.label}`}
                  </button>
                ) : (
                  <>
                    {running ? (
                      <button
                        onClick={pauseQuest}
                        className={`${controlBtnClasses} text-white`}
                        style={{ background: "#1F2937" }}>
                        ⏸ Pause
                      </button>
                    ) : (
                      <button
                        onClick={resumeQuest}
                        className={`${controlBtnClasses} text-white`}
                        style={{ background: ringColor }}>
                        ▶ Resume
                      </button>
                    )}
                    <button
                      onClick={resetQuest}
                      className={controlBtnClasses}
                      style={{
                        background: "rgba(0,0,0,0.08)",
                        color: "#1F2937"
                      }}>
                      ↺
                    </button>
                  </>
                )}
              </div>
            </div>

            {showNudge && (
              <div className="card bg-gradient-to-r from-[#FEF3C7] to-[#FDE68A] border border-[#F59E0B] shrink-0">
                <div className="text-base font-bold mb-[3px]">
                  👋 Hey, gentle check-in
                </div>
                <div className="text-sm opacity-80 mb-1.5">
                  Is this what you meant to be doing right now? No judgment.
                </div>
                <div className="flex gap-[5px]">
                  <button
                    onClick={() => setShowNudge(false)}
                    className="flex-1 p-[7px] rounded-lg border-0 bg-[#1F2937] text-white font-bold text-sm cursor-pointer">
                    ↩ Take me back to {activeProject}
                  </button>
                  <button
                    onClick={() => setShowNudge(false)}
                    className="px-[9px] py-[7px] rounded-lg border-0 bg-black/[0.08] text-sm cursor-pointer">
                    Not now
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default IndexPopup
