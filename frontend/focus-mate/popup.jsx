import { useState, useEffect, useRef } from "react"
import "./style.css" // tailwind entrypoint

const STORAGE_KEY = "focusbuddy_timer"

const QUEST_TAGS = [
  { id: "research",  label: "🔍 Research",   color: "#7C5CFF" },
  { id: "work",      label: "💼 Work",       color: "#34D399" },
  { id: "sidequest", label: "🐇 Side Quest", color: "#EF4444" }
]

const MICRO_GOALS = [
  { mins: 5,  break: 2,  label: "Tiny Sprint" },
  { mins: 15, break: 5,  label: "Quick Quest" },
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
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") }
  catch { return null }
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

// ---- Math ----
function elapsedSecs(s) {
  if (!s?.startedAt) return 0
  const ref = s.pausedAt ?? Date.now()
  return Math.max(0, Math.floor((ref - s.startedAt - (s.accumulatedPaused || 0)) / 1000))
}
function shiftColor(p) {
  const a = { r: 219, g: 234, b: 254 }, b = { r: 76, g: 29, b: 149 }
  return `rgb(${Math.round(a.r+(b.r-a.r)*p)}, ${Math.round(a.g+(b.g-a.g)*p)}, ${Math.round(a.b+(b.b-a.b)*p)})`
}
function shiftBreakColor(p) {
  const a = { r: 209, g: 250, b: 229 }, b = { r: 13, g: 148, b: 136 }
  return `rgb(${Math.round(a.r+(b.r-a.r)*p)}, ${Math.round(a.g+(b.g-a.g)*p)}, ${Math.round(a.b+(b.b-a.b)*p)})`
}
function formatTime(secs) {
  const m = Math.floor(secs/60), s = secs%60
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
}

// ---- Mock heatmap data (per cell: focus, dist, distractions, longestStreak) ----
function generateMockHeatmap() {
  const grid = []
  for (let h = 0; h < 24; h++) {
    const row = []
    for (let b = 0; b < 12; b++) {
      let focus = 0, dist = 0
      if (h >= 9 && h <= 12)        { focus = Math.random() * 280 + 50; dist = Math.random() * 60 }
      else if (h >= 13 && h <= 17)  { focus = Math.random() * 240 + 30; dist = Math.random() * 90 }
      else if (h >= 20 && h <= 23)  { focus = Math.random() * 60;        dist = Math.random() * 200 + 60 }
      else if (h >= 7 && h <= 8)    { focus = Math.random() * 120;       dist = Math.random() * 80 }
      else                           { focus = Math.random() * 30;        dist = Math.random() * 30 }
      if (Math.random() < 0.15) { focus *= 0.2; dist *= 1.4 }

      const offTrailHits  = Math.floor(dist / 35)
      const idleBlips     = Math.random() < 0.4 ? Math.floor(Math.random() * 3) : 0
      const distractions  = offTrailHits + idleBlips
      // longest contiguous focus streak in MINUTES (uses focus magnitude as a proxy)
      const longestStreak = focus > 80
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
  const r = Math.round(59  * ratio + 245 * (1 - ratio))
  const g = Math.round(130 * ratio + 158 * (1 - ratio))
  const b = Math.round(246 * ratio +  11 * (1 - ratio))
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

function HeroRing({ progress, size = 170, stroke = 14, color, primaryLabel, subLabel, mode }) {
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
        <circle cx={size/2} cy={size/2} r={radius}
          stroke="rgba(255,255,255,0.55)" strokeWidth={stroke} fill="transparent"/>
        <circle cx={size/2} cy={size/2} r={radius}
          stroke="url(#ringGrad)" strokeWidth={stroke} fill="transparent"
          strokeDasharray={C} strokeDashoffset={offset} strokeLinecap="round"
          className="[transition:stroke-dashoffset_0.6s_linear] [transform:rotate(-90deg)] [transform-origin:50%_50%]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-[#1F2937]">
        <div className="text-sm opacity-60 font-bold tracking-[2px] uppercase">{mode}</div>
        <div className="text-[32px] font-extrabold leading-none mt-0.5 tabular-nums">{primaryLabel}</div>
        <div className="text-sm opacity-60 mt-[3px] text-center px-2.5">{subLabel}</div>
      </div>
    </div>
  )
}

function HeatMap({ data }) {
  const [selected, setSelected] = useState(null) // { h, b, focus, dist, distractions, longestStreak }
  const maxTotal = Math.max(1, ...data.flat().map((c) => c.focus + c.dist))
  const HOURS = 24, BUCKETS = 12

  return (
    <div className="w-full flex flex-col">

      {/* ===== Legend (TOP) ===== */}
      <div className="flex items-center justify-center gap-4 mb-2 text-sm opacity-80">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-[rgba(59,130,246,0.85)] rounded-sm"/>
          <span>Deep focus</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-[rgba(245,158,11,0.85)] rounded-sm"/>
          <span>Tab-switching / scrolling</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-2.5 bg-black/[0.06] rounded-sm"/>
          <span>Quiet</span>
        </div>
      </div>

      {/* ===== Plot area: Y-axis title + grid ===== */}
      <div className="flex">
        {/* Y-axis title — "HOURS" */}
        <div
          className="flex items-center justify-center pr-1 select-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          <span className="text-sm font-bold opacity-70 tracking-[2px] uppercase">Hours</span>
        </div>

        <div className="flex-1">
          {/* Grid rows */}
          {Array.from({ length: BUCKETS }).map((_, b) => (
            <div key={b}
              className="grid gap-[2px] mb-0.5"
              style={{ gridTemplateColumns: `28px repeat(${HOURS}, 1fr)` }}>
              {/* Y-axis numbers — increment by 3 up to 12 (rows 2,5,8,11 → 3,6,9,12) */}
              <div className="text-sm opacity-60 text-right pr-1 flex items-center justify-end font-semibold">
                {((b + 1) % 3 === 0) ? `${b + 1}` : ""}
              </div>
              {Array.from({ length: HOURS }).map((_, h) => {
                const cell = data[h][b]
                const isSelected = selected?.h === h && selected?.b === b
                return (
                  <button key={h}
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
              <div key={h}
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
              cell ({selected.h + 1}, {selected.b + 1})
            </span>
            <span className="opacity-75">
              Distracted{" "}
              <span className={`font-extrabold ${selected.distractions > 0 ? "text-amber-600" : "text-emerald-600"}`}>
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

  const [activeQuest, setActiveQuest] = useState(null)
  const [goal, setGoal] = useState(MICRO_GOALS[1])
  const [isCustom, setIsCustom] = useState(false)
  const [customWork, setCustomWork] = useState(20)
  const [customBreak, setCustomBreak] = useState(7)

  const [timer, setTimer] = useState(null)
  const [, force] = useState(0)

  const [sparkles, setSparkles] = useState([])
  const [bodyDouble, setBodyDouble] = useState(127)
  const [showNudge, setShowNudge] = useState(false)
  const [activeProject] = useState("Deep Work")

  const [tabs, setTabs] = useState([
    { id: 1, domain: "google.com",        contributing: false, visits: 3, secondsOn: 124, friction: 0.1 },
    { id: 2, domain: "react.dev",         contributing: false, visits: 5, secondsOn: 312, friction: 0.2 },
    { id: 3, domain: "stackoverflow.com", contributing: false, visits: 2, secondsOn: 88,  friction: 0.3 },
    { id: 4, domain: "reddit.com",        contributing: false, visits: 8, secondsOn: 540, friction: 0.92 }
  ])
  const [newDomain, setNewDomain] = useState("")
  const [savedCount, setSavedCount] = useState(0)
  const [heatData] = useState(generateMockHeatmap())

  const containerRef = useRef(null)
  const hydratedRef = useRef(false)

  const isSideQuest = activeQuest?.id === "sidequest"
  const localWorkMins = isCustom ? customWork : goal.mins
  const localBreakMins = isSideQuest ? 0 : (isCustom ? customBreak : goal.break)

  // ---- Initial load + storage subscription ----
  useEffect(() => {
    let mounted = true
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

  // ---- Local tick ----
  useEffect(() => {
    const id = setInterval(async () => {
      const s = await readStore()
      if (!s) { setTimer(null); force((t) => t + 1); return }
      if (s.startedAt && !s.pausedAt && (s.phase === "work" || s.phase === "break")) {
        const total = s.phase === "work" ? s.workSecs : s.breakSecs
        const e = elapsedSecs(s)
        if (e >= total) {
          let next
          if (s.phase === "work" && s.hasBreak && s.breakSecs > 0) {
            next = { ...s, phase: "break", startedAt: Date.now(), accumulatedPaused: 0, pausedAt: null }
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

  useEffect(() => {
    const distract = tabs.find((t) => !t.contributing && t.friction > 0.85)
    if (distract && timer?.phase === "work" && !timer?.pausedAt) {
      const t = setTimeout(() => setShowNudge(true), 6000)
      return () => clearTimeout(t)
    }
  }, [tabs, timer])

  const triggerReward = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const x = (e?.clientX ?? 0) - (rect?.left || 0)
    const y = (e?.clientY ?? 0) - (rect?.top || 0)
    const id = Date.now()
    setSparkles((s) => [...s, { id, x, y }])
    setTimeout(() => setSparkles((s) => s.filter((sp) => sp.id !== id)), 700)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = 880
      g.gain.setValueAtTime(0.05, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      o.start(); o.stop(ctx.currentTime + 0.15)
    } catch {}
  }
  const pickQuest = (q, e) => { setActiveQuest(q); triggerReward(e) }

  const contributingTabs = tabs.filter((t) => t.contributing)
  const sideQuestTabs    = tabs.filter((t) => !t.contributing)
  const totalContributingSecs = contributingTabs.reduce((sum, t) => sum + t.secondsOn, 0)

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
    await writeStore(next); setTimer(next)
  }
  const resumeQuest = async () => {
    if (!timer || !timer.pausedAt) return
    const next = {
      ...timer,
      accumulatedPaused: (timer.accumulatedPaused || 0) + (Date.now() - timer.pausedAt),
      pausedAt: null
    }
    await writeStore(next); setTimer(next)
  }
  const resetQuest = async () => { await writeStore(null); setTimer(null) }

  const toggleContributing = (id) =>
    setTabs((ts) => ts.map((t) => t.id === id ? { ...t, contributing: !t.contributing } : t))
  const addTrailDomain = () => {
    const v = newDomain.trim(); if (!v) return
    const cleaned = v.replace(/^https?:\/\//, "").replace(/\/$/, "")
    setTabs((ts) => [...ts, {
      id: Date.now(), domain: cleaned,
      contributing: true, visits: 0, secondsOn: 0, friction: 0.1
    }])
    setNewDomain("")
  }
  const brainDump = () => {
    setSavedCount((c) => c + sideQuestTabs.length)
    setTabs((ts) => ts.filter((t) => t.contributing))
  }

  // ---- Display values ----
  const phase   = timer?.phase || "idle"
  const running = !!timer?.startedAt && !timer?.pausedAt && (phase === "work" || phase === "break")
  const liveElapsed = timer ? elapsedSecs(timer) : 0

  const displayWorkTotal  = (phase === "work" || phase === "break") ? timer.workSecs  : localWorkMins  * 60
  const displayBreakTotal = (phase === "work" || phase === "break") ? timer.breakSecs : localBreakMins * 60
  const totalSecs = phase === "break" ? displayBreakTotal : displayWorkTotal
  const progress = totalSecs > 0 ? Math.min(liveElapsed / totalSecs, 1) : 0
  const bgColor = phase === "break" ? shiftBreakColor(progress)
                : phase === "work"  ? shiftColor(progress)
                : "rgb(245, 247, 252)"
  const ringColor = phase === "break" ? "#0D9488" : (activeQuest?.color || "#7C5CFF")

  const timeLeft = formatTime(Math.max(totalSecs - liveElapsed, 0))
  const ringMode =
    phase === "idle"  ? "Ready" :
    phase === "work"  ? "Focus" :
    phase === "break" ? "Break" : "Done"
  const ringSub =
    phase === "idle"
      ? (isSideQuest ? `${localWorkMins}m · no break` : `${localWorkMins}m focus · ${localBreakMins}m break`)
      : phase === "work"  ? (timer?.hasBreak && timer?.breakSecs > 0 ? `then ${Math.round(timer.breakSecs/60)}m break` : "no break this round")
      : phase === "break" ? "rest your brain"
      : "🎉 nice work"

  return (
    <div ref={containerRef}
      className="relative w-[760px] h-[580px] p-[14px] font-['Segoe_UI_Variable','Segoe_UI',system-ui,sans-serif] text-[#1F2937] text-base overflow-hidden box-border flex flex-col transition-[background] duration-[1200ms]"
      style={{ background: `linear-gradient(180deg, ${bgColor} 0%, #FFFFFF 130%)` }}>
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
      `}</style>

      {sparkles.map((s) => <Sparkle key={s.id} x={s.x} y={s.y} />)}

      {/* Header */}
      <div className="flex items-center justify-between mb-2.5 shrink-0">
        <div className="flex items-center gap-2.5">
          {view === "focus" && (
            <button className="icon-btn" onClick={() => setView("heatmap")}>← Back</button>
          )}
          <div className="brand-lockup">
            <div className="brand-mark">💡</div>
            <div>
              <div className="brand-name">FlowState</div>
              <div className="brand-subtitle">
                {view === "heatmap" ? "Today's focus rhythm" : "Your supportive coach"}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {(phase === "work" || phase === "break") && view === "heatmap" && (
            <button className="icon-btn" onClick={() => setView("focus")}>⏱ {timeLeft}</button>
          )}
          <div title="Other FocusBuddy users in a focus session right now"
            className="flex items-center gap-1.5 bg-white/70 px-2.5 py-[5px] rounded-full text-sm font-semibold">
            <span className="inline-block w-2 h-2 rounded-full bg-[#34D399] animate-[pulse_1.6s_infinite]"/>
            {bodyDouble} others focusing now
          </div>
        </div>
      </div>

      {/* ============== HEATMAP (DEFAULT) ============== */}
      {view === "heatmap" && (
        <div className="flex flex-col flex-1 min-h-0 gap-2.5">
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

              <div className="text-xs opacity-[0.55] whitespace-nowrap">Privacy-respecting · no URLs shown</div>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0 px-0.5 py-1">
              <HeatMap data={heatData} />
            </div>
          </div>

          <button onClick={() => setView("focus")}
            className="p-3 border-0 rounded-xl bg-[#1F2937] text-white font-bold text-base cursor-pointer shadow-[0_4px_14px_rgba(0,0,0,0.15)] shrink-0 transition-transform duration-[120ms]"
            onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
            onMouseUp={(e)   => e.currentTarget.style.transform = "scale(1)"}>
            {phase === "work" || phase === "break"
              ? `▶ Resume Focus Session · ${timeLeft}`
              : "✨ Start a Focus Session"}
          </button>
        </div>
      )}

      {/* ============== FOCUS / TIMER VIEW ============== */}
      {view === "focus" && (
        <div className="grid grid-cols-2 gap-2.5 flex-1 min-h-0">
          {/* LEFT */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="card shrink-0 !py-3 !px-3">
              <div className="text-sm font-bold opacity-[0.55] mb-6 tracking-[1.5px]">
                STEP 1 · CHOOSE YOUR QUEST
              </div>
              <div className="flex flex-wrap gap-[5px]">
                {QUEST_TAGS.map((q) => {
                  const selected = activeQuest?.id === q.id
                  const dimmed = activeQuest && !selected
                  return (
                    <button key={q.id}
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
                  Side Quests are stimulation, not failure — running without a break.
                </div>
              )}
            </div>

            <div className="card flex-1 flex flex-col min-h-0 py-6">
              <div className="flex justify-between items-center">
                <div className="text-sm font-bold opacity-[0.65] tracking-[1px]">
                  STEP 2 · 🧭 GOAL MAP
                </div>
                <button onClick={brainDump} disabled={sideQuestTabs.length === 0}
                  className={`border-0 px-2 py-[3px] rounded-full text-white text-xs font-bold ${sideQuestTabs.length ? "bg-[#EF4444] cursor-pointer" : "bg-black/10 cursor-not-allowed"}`}>
                  🔥 Brain Dump ({sideQuestTabs.length})
                </button>
              </div>

              <div className="flex gap-[5px] my-6 shrink-0">
                <input value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTrailDomain()}
                  placeholder="Add a domain (e.g. react.dev)"
                  className="flex-1 px-[9px] py-[5px] text-base border border-black/10 rounded-lg bg-white/80 outline-none"/>
                <button onClick={addTrailDomain} disabled={!newDomain.trim()}
                  className={`border-0 px-[11px] py-[5px] rounded-lg text-white text-base font-bold ${newDomain.trim() ? "bg-[#1F2937] cursor-pointer" : "bg-black/10 cursor-not-allowed"}`}>
                  + Add
                </button>
              </div>

              <div className="scroll-y flex-1 min-h-0 pr-1">
                <div className="text-sm font-bold text-[#059669] mb-[3px] tracking-[0.5px]">
                  ✓ ON THE TRAIL · {formatTime(totalContributingSecs)} invested
                </div>
                {contributingTabs.length === 0 && (
                  <div className="text-sm opacity-50 italic pt-[3px] pb-1.5">
                    No quest tabs yet. Add one above to unlock the timer.
                  </div>
                )}
                {contributingTabs.map((t) => (
                  <div key={t.id} className="tab-row tab-contrib">
                    <input type="checkbox" checked={t.contributing}
                      onChange={() => toggleContributing(t.id)} className="cursor-pointer"/>
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate font-semibold">{t.domain}</div>
                      <div className="text-[9px] opacity-60 flex gap-1.5">
                        <span>{t.visits} visits</span><span>·</span>
                        <span>{formatTime(t.secondsOn)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {sideQuestTabs.length > 0 && (
                  <>
                    <div className="text-sm font-bold text-[#DC2626] mt-1.5 mb-[3px] tracking-[0.5px]">
                      🐇 SIDE QUESTS · stimulation, not failure
                    </div>
                    {sideQuestTabs.map((t) => (
                      <div key={t.id} className="tab-row tab-side">
                        <input type="checkbox" checked={t.contributing}
                          onChange={() => toggleContributing(t.id)} className="cursor-pointer"/>
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate">{t.domain}</div>
                          <div className="text-[9px] opacity-60 flex gap-1.5">
                            <span>{t.visits} visits</span><span>·</span>
                            <span>{formatTime(t.secondsOn)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {savedCount > 0 && (
                  <div className="mt-1.5 text-sm opacity-70">
                    💾 {savedCount} tab{savedCount !== 1 ? "s" : ""} saved to "Read Later"
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
                primaryLabel={phase === "idle" || phase === "done" ? formatTime(displayWorkTotal) : timeLeft}
                subLabel={ringSub}
                mode={ringMode}
              />

              <div className="mt-1">
                <div className="text-sm font-bold opacity-[0.55] mb-6 tracking-[1.5px] text-center">
                  STEP 3 · MICRO-GOAL{isSideQuest ? " (no break)" : ""}
                </div>
                {/* 4-col tracking grid lets the 4 micro-goals form a 2×2,
    while the custom button sits centered (col-start-2 col-span-2)
    below them as the bottom-middle slot. */}
<div className="grid grid-cols-4 gap-1.5">
  {MICRO_GOALS.map((g) => {
    const selected = !isCustom && goal.mins === g.mins
    return (
      <button key={g.mins}
        onClick={() => { setGoal(g); setIsCustom(false) }}
        disabled={running}
        className={`col-span-2 border-0 px-2 py-2.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 ${running ? "cursor-not-allowed" : "cursor-pointer"} ${selected ? "bg-[#1F2937] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
        <span className="text-[1rem]">{g.mins}m</span>
        {!isSideQuest && (
          <span className="text-[0.875rem] opacity-70 font-medium">+{g.break}m</span>
        )}
      </button>
    )
  })}

  {/* Custom — centered under the 2×2 */}
  <button onClick={() => setIsCustom(true)} disabled={running}
    className={`col-start-2 col-span-2 border-0 px-2 py-2.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 ${running ? "cursor-not-allowed" : "cursor-pointer"} ${isCustom ? "bg-[#1F2937] text-white" : "bg-black/[0.06] text-[#1F2937]"}`}>
    <span className="text-[1.25rem]">⚙</span>
    <span className="text-[0.875rem] opacity-70 font-medium">custom</span>
  </button>
</div>

                {isCustom && (
                  <div className="flex gap-2 mt-[5px] items-center justify-center">
                    <label className="text-sm font-semibold opacity-70">
                      Work
                      <input type="number" min={1} max={180} value={customWork}
                        onChange={(e) => setCustomWork(Math.max(1, parseInt(e.target.value) || 1))}
                        disabled={running} className={inputClasses}/> m
                    </label>
                    {!isSideQuest && (
                      <label className="text-sm font-semibold opacity-70">
                        Break
                        <input type="number" min={0} max={60} value={customBreak}
                          onChange={(e) => setCustomBreak(Math.max(0, parseInt(e.target.value) || 0))}
                          disabled={running} className={inputClasses}/> m
                      </label>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-auto pt-2 flex gap-1.5">
                {phase === "idle" || phase === "done" ? (
                  <button onClick={startQuest} disabled={!canStart}
                    title={!activeQuest ? "Pick a quest first"
                      : contributingTabs.length === 0 ? "Add at least 1 trail tab" : ""}
                    className={`flex-1 p-2.5 rounded-xl border-0 text-white font-bold text-base transition-all duration-200 ${canStart ? "cursor-pointer" : "cursor-not-allowed"}`}
                    style={{
                      background: canStart ? ringColor : "rgba(0,0,0,0.15)",
                      boxShadow: canStart ? `0 4px 14px ${ringColor}55` : "none"
                    }}>
                    {!activeQuest ? "Pick a quest ↖"
                      : contributingTabs.length === 0 ? "Add a trail tab ↖"
                      : `▶ Start ${activeQuest.label}`}
                  </button>
                ) : (
                  <>
                    {running
                      ? <button onClick={pauseQuest}  className={`${controlBtnClasses} text-white`} style={{ background: "#1F2937" }}>⏸ Pause</button>
                      : <button onClick={resumeQuest} className={`${controlBtnClasses} text-white`} style={{ background: ringColor }}>▶ Resume</button>}
                    <button onClick={resetQuest} className={controlBtnClasses} style={{ background: "rgba(0,0,0,0.08)", color: "#1F2937" }}>↺</button>
                  </>
                )}
              </div>
            </div>

            {showNudge && (
              <div className="card bg-gradient-to-r from-[#FEF3C7] to-[#FDE68A] border border-[#F59E0B] shrink-0">
                <div className="text-base font-bold mb-[3px]">👋 Hey, gentle check-in</div>
                <div className="text-sm opacity-80 mb-1.5">
                  Is this what you meant to be doing right now? No judgment.
                </div>
                <div className="flex gap-[5px]">
                  <button onClick={() => setShowNudge(false)}
                    className="flex-1 p-[7px] rounded-lg border-0 bg-[#1F2937] text-white font-bold text-sm cursor-pointer">
                    ↩ Take me back to {activeProject}
                  </button>
                  <button onClick={() => setShowNudge(false)}
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