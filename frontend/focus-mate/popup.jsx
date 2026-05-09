import { useState, useEffect, useRef } from "react"

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

// ---- Storage abstraction (works in extension OR plain dev) ----
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

// ---- Mock heatmap data (replace with /activity_logs query) ----
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
      row.push({ focus: Math.round(focus), dist: Math.round(dist) })
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
    <div style={{
      position: "absolute", left: x, top: y, pointerEvents: "none", fontSize: 18,
      animation: "sparklePop 700ms ease-out forwards"
    }}>✨</div>
  )
}

function HeroRing({ progress, size = 170, stroke = 14, color, primaryLabel, subLabel, mode }) {
  const radius = (size - stroke) / 2
  const C = 2 * Math.PI * radius
  const offset = C - progress * C
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <div style={{
        position: "absolute", inset: -8, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
        filter: "blur(8px)", opacity: progress > 0 ? 1 : 0,
        transition: "opacity 800ms ease"
      }}/>
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
          style={{ transition: "stroke-dashoffset 0.6s linear",
                   transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}/>
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", color: "#1F2937"
      }}>
        <div style={{ fontSize: 9, opacity: 0.6, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{mode}</div>
        <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{primaryLabel}</div>
        <div style={{ fontSize: 9, opacity: 0.6, marginTop: 3, textAlign: "center", padding: "0 10px" }}>{subLabel}</div>
      </div>
    </div>
  )
}

function HeatMap({ data }) {
  const maxTotal = Math.max(1, ...data.flat().map((c) => c.focus + c.dist))
  const HOURS = 24, BUCKETS = 12
  return (
    <div style={{ width: "100%" }}>
      {/* hour labels */}
      <div style={{
        display: "grid", gridTemplateColumns: `28px repeat(${HOURS}, 1fr)`,
        gap: 2, marginBottom: 4
      }}>
        <div />
        {Array.from({ length: HOURS }).map((_, h) => (
          <div key={h} style={{
            fontSize: 9, opacity: 0.6, textAlign: "center",
            visibility: h % 3 === 0 ? "visible" : "hidden", fontWeight: 600
          }}>{String(h).padStart(2, "0")}</div>
        ))}
      </div>
      {/* grid */}
      {Array.from({ length: BUCKETS }).map((_, b) => (
        <div key={b} style={{
          display: "grid", gridTemplateColumns: `28px repeat(${HOURS}, 1fr)`,
          gap: 2, marginBottom: 2
        }}>
          <div style={{
            fontSize: 9, opacity: 0.6, textAlign: "right", paddingRight: 4,
            display: "flex", alignItems: "center", justifyContent: "flex-end", fontWeight: 600
          }}>
            {b % 2 === 0 ? `:${String(b * 5).padStart(2, "0")}` : ""}
          </div>
          {Array.from({ length: HOURS }).map((_, h) => {
            const cell = data[h][b]
            return (
              <div key={h}
                title={`${String(h).padStart(2,"0")}:${String(b*5).padStart(2,"0")} · focus ${cell.focus}s · activity ${cell.dist}`}
                style={{
                  height: 20, borderRadius: 3,
                  background: heatColor(cell, maxTotal),
                  transition: "background 200ms ease"
                }}/>
            )
          })}
        </div>
      ))}
      {/* legend */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginTop: 12, fontSize: 10, opacity: 0.75
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 16, height: 10, background: "rgba(59,130,246,0.85)", borderRadius: 2 }}/>
          <span>Deep focus</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 16, height: 10, background: "rgba(245,158,11,0.85)", borderRadius: 2 }}/>
          <span>Tab-switching / scrolling</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 16, height: 10, background: "rgba(0,0,0,0.06)", borderRadius: 2 }}/>
          <span>Quiet</span>
        </div>
      </div>
    </div>
  )
}

// =================================================================
function IndexPopup() {
  // 🔑 Heatmap is ALWAYS the default view on popup open.
  const [view, setView] = useState("heatmap")

  // setup
  const [activeQuest, setActiveQuest] = useState(null)
  const [goal, setGoal] = useState(MICRO_GOALS[1])
  const [isCustom, setIsCustom] = useState(false)
  const [customWork, setCustomWork] = useState(20)
  const [customBreak, setCustomBreak] = useState(7)

  // mirrors chrome.storage.local
  const [timer, setTimer] = useState(null)
  const [, force] = useState(0)

  const [sparkles, setSparkles] = useState([])
  const [bodyDouble, setBodyDouble] = useState(127)
  const [showNudge, setShowNudge] = useState(false)
  const [activeProject] = useState("Deep Work")

  const [tabs, setTabs] = useState([
    { id: 1, title: "Google: react hooks tutorial", url: "google.com",       contributing: false, visits: 3, secondsOn: 124, friction: 0.1 },
    { id: 2, title: "useEffect docs",                url: "react.dev",         contributing: false, visits: 5, secondsOn: 312, friction: 0.2 },
    { id: 3, title: "Stack Overflow: cleanup",       url: "stackoverflow.com", contributing: false, visits: 2, secondsOn: 88,  friction: 0.3 },
    { id: 4, title: "Reddit r/programming",          url: "reddit.com",        contributing: false, visits: 8, secondsOn: 540, friction: 0.92 }
  ])
  const [newDomain, setNewDomain] = useState("")
  const [savedCount, setSavedCount] = useState(0)
  const [heatData] = useState(generateMockHeatmap())

  const containerRef = useRef(null)
  const hydratedRef = useRef(false)

  const isSideQuest = activeQuest?.id === "sidequest"
  const localWorkMins = isCustom ? customWork : goal.mins
  const localBreakMins = isSideQuest ? 0 : (isCustom ? customBreak : goal.break)

  // ---- Initial load + subscribe to storage ----
  useEffect(() => {
    let mounted = true
    const sync = async () => {
      const s = await readStore()
      if (!mounted) return
      setTimer(s)
      // Only hydrate the QUEST selection from storage on first load,
      // but DO NOT change the default view (heatmap stays default).
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

  // ---- Local tick: keeps countdown smooth + handles phase boundaries while popup is open ----
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

  // body double
  useEffect(() => {
    const id = setInterval(() => {
      setBodyDouble((n) => Math.max(50, n + Math.floor(Math.random() * 7 - 3)))
    }, 4000)
    return () => clearInterval(id)
  }, [])

  // nudge
  useEffect(() => {
    const distract = tabs.find((t) => !t.contributing && t.friction > 0.85)
    if (distract && timer?.phase === "work" && !timer?.pausedAt) {
      const t = setTimeout(() => setShowNudge(true), 6000)
      return () => clearTimeout(t)
    }
  }, [tabs, timer])

  // ---- Reward ----
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

  // ---- Actions: write to storage; background reschedules its alarm ----
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
      id: Date.now(), title: cleaned, url: cleaned,
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
      style={{
        position: "relative", width: 760, height: 580, padding: 14,
        fontFamily: "'Inter', system-ui, sans-serif",
        background: `linear-gradient(180deg, ${bgColor} 0%, #FFFFFF 130%)`,
        color: "#1F2937", transition: "background 1.2s ease",
        overflow: "hidden", boxSizing: "border-box",
        display: "flex", flexDirection: "column"
      }}>
      <style>{`
        @keyframes sparklePop { 0%{transform:scale(.4) translateY(0);opacity:1} 100%{transform:scale(1.6) translateY(-30px);opacity:0} }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.4);opacity:.6} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .quest-btn { border:none; padding:7px 12px; border-radius:999px; font-size:11px; font-weight:600; cursor:pointer; color:white;
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
          font-size:11px; font-weight:700; cursor:pointer; color:#1F2937; transition: background 150ms ease; }
        .icon-btn:hover { background: rgba(0,0,0,0.12); }
      `}</style>

      {sparkles.map((s) => <Sparkle key={s.id} x={s.x} y={s.y} />)}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {view === "focus" && (
            <button className="icon-btn" onClick={() => setView("heatmap")}>← Back</button>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>🧠 FocusBuddy</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              {view === "heatmap" ? "Today's focus rhythm" : "Your supportive coach"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(phase === "work" || phase === "break") && view === "heatmap" && (
            <button className="icon-btn" onClick={() => setView("focus")}>⏱ {timeLeft}</button>
          )}
          <div title="People focusing right now"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.7)",
              padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600
            }}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: "#34D399", animation: "pulse 1.6s infinite"
            }}/>
            {bodyDouble}
          </div>
        </div>
      </div>

      {/* ============== HEATMAP (DEFAULT) ============== */}
      {view === "heatmap" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 10 }}>
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, letterSpacing: 1 }}>
                📊 ACTIVITY HEAT MAP · LAST 24H
              </div>
              <div style={{ fontSize: 9, opacity: 0.55 }}>Privacy-respecting · no URLs shown</div>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, padding: "4px 2px" }}>
              <HeatMap data={heatData} />
            </div>
          </div>

          <button onClick={() => setView("focus")}
            style={{
              padding: "12px", border: "none", borderRadius: 12,
              background: "#1F2937", color: "white", fontWeight: 700, fontSize: 13,
              cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.15)", flexShrink: 0,
              transition: "transform 120ms ease"
            }}
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
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
          flex: 1, minHeight: 0
        }}>
          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            <div className="card" style={{ flexShrink: 0, padding: "8px 12px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.55, marginBottom: 6, letterSpacing: 1.5 }}>
                STEP 1 · CHOOSE YOUR QUEST
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {QUEST_TAGS.map((q) => {
                  const selected = activeQuest?.id === q.id
                  const dimmed = activeQuest && !selected
                  return (
                    <button key={q.id} className="quest-btn" onClick={(e) => pickQuest(q, e)}
                      style={{
                        background: q.color, opacity: dimmed ? 0.35 : 1,
                        outline: selected ? "3px solid rgba(0,0,0,0.15)" : "none"
                      }}>{q.label}</button>
                  )
                })}
              </div>
              {isSideQuest && (
                <div style={{ fontSize: 9, opacity: 0.7, marginTop: 5, fontStyle: "italic" }}>
                  Side Quests are stimulation, not failure — running without a break.
                </div>
              )}
            </div>

            <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.65, letterSpacing: 1 }}>
                  STEP 2 · 🧭 ACTIVE GOAL MAP
                </div>
                <button onClick={brainDump} disabled={sideQuestTabs.length === 0}
                  style={{
                    border: "none", padding: "3px 8px", borderRadius: 999,
                    background: sideQuestTabs.length ? "#EF4444" : "rgba(0,0,0,0.1)",
                    color: "white", fontSize: 9, fontWeight: 700,
                    cursor: sideQuestTabs.length ? "pointer" : "not-allowed"
                  }}>🔥 Brain Dump ({sideQuestTabs.length})</button>
              </div>

              <div style={{ display: "flex", gap: 5, margin: "6px 0", flexShrink: 0 }}>
                <input value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTrailDomain()}
                  placeholder="Add a domain (e.g. react.dev)"
                  style={{
                    flex: 1, padding: "5px 9px", fontSize: 11,
                    border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8,
                    background: "rgba(255,255,255,0.8)", outline: "none"
                  }}/>
                <button onClick={addTrailDomain} disabled={!newDomain.trim()}
                  style={{
                    border: "none", padding: "5px 11px", borderRadius: 8,
                    background: newDomain.trim() ? "#1F2937" : "rgba(0,0,0,0.1)",
                    color: "white", fontSize: 11, fontWeight: 700,
                    cursor: newDomain.trim() ? "pointer" : "not-allowed"
                  }}>+ Add</button>
              </div>

              <div className="scroll-y" style={{ flex: 1, minHeight: 0, paddingRight: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#059669", marginBottom: 3, letterSpacing: 0.5 }}>
                  ✓ ON THE TRAIL · {formatTime(totalContributingSecs)} invested
                </div>
                {contributingTabs.length === 0 && (
                  <div style={{ fontSize: 10, opacity: 0.5, fontStyle: "italic", padding: "3px 0 6px" }}>
                    No quest tabs yet. Add one above to unlock the timer.
                  </div>
                )}
                {contributingTabs.map((t) => (
                  <div key={t.id} className="tab-row tab-contrib">
                    <input type="checkbox" checked={t.contributing}
                      onChange={() => toggleContributing(t.id)} style={{ cursor: "pointer" }}/>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{t.title}</div>
                      <div style={{ fontSize: 9, opacity: 0.6, display: "flex", gap: 6 }}>
                        <span>{t.url}</span><span>·</span>
                        <span>{t.visits} visits</span><span>·</span>
                        <span>{formatTime(t.secondsOn)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {sideQuestTabs.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", marginTop: 6, marginBottom: 3, letterSpacing: 0.5 }}>
                      🐇 SIDE QUESTS · stimulation, not failure
                    </div>
                    {sideQuestTabs.map((t) => (
                      <div key={t.id} className="tab-row tab-side">
                        <input type="checkbox" checked={t.contributing}
                          onChange={() => toggleContributing(t.id)} style={{ cursor: "pointer" }}/>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                          <div style={{ fontSize: 9, opacity: 0.6, display: "flex", gap: 6 }}>
                            <span>{t.url}</span><span>·</span>
                            <span>{t.visits} visits</span><span>·</span>
                            <span>{formatTime(t.secondsOn)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {savedCount > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10, opacity: 0.7 }}>
                    💾 {savedCount} tab{savedCount !== 1 ? "s" : ""} saved to "Read Later"
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
            <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "10px 12px" }}>
              <HeroRing
                progress={progress}
                color={ringColor}
                primaryLabel={phase === "idle" || phase === "done" ? formatTime(displayWorkTotal) : timeLeft}
                subLabel={ringSub}
                mode={ringMode}
              />

              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.55, marginBottom: 4, letterSpacing: 1.5, textAlign: "center" }}>
                  STEP 3 · MICRO-GOAL{isSideQuest ? " (no break)" : ""}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
                  {MICRO_GOALS.map((g) => {
                    const selected = !isCustom && goal.mins === g.mins
                    return (
                      <button key={g.mins}
                        onClick={() => { setGoal(g); setIsCustom(false) }}
                        disabled={running}
                        style={{
                          border: "none", padding: "5px 2px", borderRadius: 8,
                          fontSize: 10, fontWeight: 700,
                          cursor: running ? "not-allowed" : "pointer",
                          background: selected ? "#1F2937" : "rgba(0,0,0,0.06)",
                          color: selected ? "white" : "#1F2937",
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 1
                        }}>
                        <span style={{ fontSize: 11 }}>{g.mins}m</span>
                        {!isSideQuest && (
                          <span style={{ fontSize: 8, opacity: 0.7, fontWeight: 500 }}>+{g.break}m</span>
                        )}
                      </button>
                    )
                  })}
                  <button onClick={() => setIsCustom(true)} disabled={running}
                    style={{
                      border: "none", padding: "5px 2px", borderRadius: 8,
                      fontSize: 10, fontWeight: 700,
                      cursor: running ? "not-allowed" : "pointer",
                      background: isCustom ? "#1F2937" : "rgba(0,0,0,0.06)",
                      color: isCustom ? "white" : "#1F2937",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 1
                    }}>
                    <span style={{ fontSize: 11 }}>⚙</span>
                    <span style={{ fontSize: 8, opacity: 0.7, fontWeight: 500 }}>custom</span>
                  </button>
                </div>

                {isCustom && (
                  <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center", justifyContent: "center" }}>
                    <label style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>
                      Work
                      <input type="number" min={1} max={180} value={customWork}
                        onChange={(e) => setCustomWork(Math.max(1, parseInt(e.target.value) || 1))}
                        disabled={running} style={inputStyle}/> m
                    </label>
                    {!isSideQuest && (
                      <label style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>
                        Break
                        <input type="number" min={0} max={60} value={customBreak}
                          onChange={(e) => setCustomBreak(Math.max(0, parseInt(e.target.value) || 0))}
                          disabled={running} style={inputStyle}/> m
                      </label>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", gap: 6 }}>
                {phase === "idle" || phase === "done" ? (
                  <button onClick={startQuest} disabled={!canStart}
                    title={!activeQuest ? "Pick a quest first"
                      : contributingTabs.length === 0 ? "Add at least 1 trail tab" : ""}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 12, border: "none",
                      background: canStart ? ringColor : "rgba(0,0,0,0.15)",
                      color: "white", fontWeight: 700, fontSize: 12,
                      cursor: canStart ? "pointer" : "not-allowed",
                      boxShadow: canStart ? `0 4px 14px ${ringColor}55` : "none",
                      transition: "all 200ms ease"
                    }}>
                    {!activeQuest ? "Pick a quest ↖"
                      : contributingTabs.length === 0 ? "Add a trail tab ↖"
                      : `▶ Start ${activeQuest.label}`}
                  </button>
                ) : (
                  <>
                    {running
                      ? <button onClick={pauseQuest}  style={controlBtn("#1F2937")}>⏸ Pause</button>
                      : <button onClick={resumeQuest} style={controlBtn(ringColor)}>▶ Resume</button>}
                    <button onClick={resetQuest} style={controlBtn("rgba(0,0,0,0.08)", "#1F2937")}>↺</button>
                  </>
                )}
              </div>
            </div>

            {showNudge && (
              <div className="card" style={{ background: "linear-gradient(90deg, #FEF3C7, #FDE68A)", border: "1px solid #F59E0B", flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>👋 Hey, gentle check-in</div>
                <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 6 }}>
                  Is this what you meant to be doing right now? No judgment.
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setShowNudge(false)}
                    style={{ flex: 1, padding: "7px", borderRadius: 8, border: "none",
                      background: "#1F2937", color: "white", fontWeight: 700, fontSize: 10, cursor: "pointer" }}>
                    ↩ Take me back to {activeProject}
                  </button>
                  <button onClick={() => setShowNudge(false)}
                    style={{ padding: "7px 9px", borderRadius: 8, border: "none",
                      background: "rgba(0,0,0,0.08)", fontSize: 10, cursor: "pointer" }}>
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

const inputStyle = {
  width: 42, marginLeft: 4, padding: "3px 5px", fontSize: 11, fontWeight: 700,
  border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6,
  background: "rgba(255,255,255,0.9)", outline: "none", textAlign: "center"
}
function controlBtn(bg, color = "white") {
  return {
    flex: 1, padding: "10px", borderRadius: 12, border: "none",
    background: bg, color, fontWeight: 700, fontSize: 12, cursor: "pointer"
  }
}

export default IndexPopup
