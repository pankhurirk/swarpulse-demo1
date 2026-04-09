import { useEffect, useMemo, useRef, useState } from "react";

type PracticeItem = {
  title: string;
  notes: string;
};

type ManifestItem = {
  name: string;
  file: string;
};

const STORAGE_KEY = "swarpulse_demo_first_opened_at";
const DEMO_DAYS = 7;
const DEMO_MS = DEMO_DAYS * 24 * 60 * 60 * 1000;
const GAP_SECONDS = 0.05;

const BG = "#1b1717";
const PANEL = "#262020";
const PANEL2 = "#312828";
const ACCENT = "#d6a18f";
const ACCENT2 = "#f3d1c4";
const TEXT = "#fff7f3";
const MUTED = "#dbc1b8";
const ENTRY_BG = "#3a2f2f";
const BORDER = "#6c5650";

const BASE_SWARAS: Record<string, number> = {
  S: 1.0,
  r: 16 / 15,
  R: 9 / 8,
  g: 6 / 5,
  G: 5 / 4,
  m: 4 / 3,
  M: 45 / 32,
  P: 3 / 2,
  d: 8 / 5,
  D: 5 / 3,
  n: 9 / 5,
  N: 15 / 8,
};

const NOTE_FREQUENCIES: Record<string, number> = {
  C: 261.63,
  "C#": 277.18,
  D: 293.66,
  "D#": 311.13,
  E: 329.63,
  F: 349.23,
  "F#": 369.99,
  G: 392.0,
  "G#": 415.3,
  A: 440.0,
  "A#": 466.16,
  B: 493.88,
};

const SA_OPTIONS = Object.keys(NOTE_FREQUENCIES);

const DEMO_NOTES: PracticeItem[] = [
  { title: "Basic Aaroh", notes: "S R G m P D N S'" },
  { title: "Basic Avroh", notes: "S' N D P m G R S" },
  { title: "Simple Pattern", notes: "S R S R G R G m G m P" },
];

function getOrCreateTrialStart() {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return Number(existing);
  const now = Date.now();
  localStorage.setItem(STORAGE_KEY, String(now));
  return now;
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${days}d ${hours}h left`;
}

function parseNoteToken(token: string, defaultDuration: number) {
  let duration = defaultDuration;
  let swarPart = token.trim();

  if (swarPart.includes(":")) {
    const [left, right] = swarPart.split(":");
    swarPart = left.trim();
    duration = Number(right.trim());
  }

  let octaveMultiplier = 1;
  let note = swarPart;

  if (swarPart.startsWith(".")) {
    octaveMultiplier = 0.5;
    note = swarPart.slice(1);
  } else if (swarPart.endsWith("'")) {
    octaveMultiplier = 2;
    note = swarPart.slice(0, -1);
  }

  return { note, octaveMultiplier, duration };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"playback" | "harmonium" | "tanpura" | "practice">("playback");
  const [trialStart, setTrialStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState("Loading...");
  const [currentNote, setCurrentNote] = useState("-");

  const [sa, setSa] = useState("A#");
  const [duration, setDuration] = useState("1.0");
  const [repeatCount, setRepeatCount] = useState("3");

  const [playbackNotes, setPlaybackNotes] = useState("S R G m P D N S'");
  const [harmoniumNotes, setHarmoniumNotes] = useState("S R G m P D N S'");

  const [practiceTitle, setPracticeTitle] = useState("");
  const [practiceBody, setPracticeBody] = useState("");
  const [savedPractice, setSavedPractice] = useState<PracticeItem[]>(DEMO_NOTES);

  const [tanpuraList, setTanpuraList] = useState<ManifestItem[]>([]);
  const [selectedTanpura, setSelectedTanpura] = useState("");
  const [tanpuraOn, setTanpuraOn] = useState(false);

  const [percussionList, setPercussionList] = useState<ManifestItem[]>([]);
  const [selectedBeat, setSelectedBeat] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const loopAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeNodesRef = useRef<any[]>([]);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    setTrialStart(getOrCreateTrialStart());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    loadManifests();
    return () => {
      clearInterval(timer);
      stopAllAudio();
    };
  }, []);

  const remainingMs = useMemo(() => {
    if (!trialStart) return DEMO_MS;
    return trialStart + DEMO_MS - now;
  }, [trialStart, now]);

  const expired = remainingMs <= 0;

  async function loadManifests() {
    try {
      const p = await fetch("/audio/percussion/manifest.json");
      const pdata = await p.json();
      const percussion = Array.isArray(pdata) ? pdata : [];
      setPercussionList(percussion);
      if (percussion.length > 0) setSelectedBeat(percussion[0].file);

      const t = await fetch("/audio/tanpura/manifest.json");
      const tdata = await t.json();
      const tanpura = Array.isArray(tdata) ? tdata : [];
      setTanpuraList(tanpura);
      if (tanpura.length > 0) setSelectedTanpura(tanpura[0].file);

      setStatus("Audio loaded");
    } catch {
      setStatus("Failed to load manifest");
    }
  }

  async function ensureAudioContext() {
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new Ctx();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  function registerNode(node: any) {
    activeNodesRef.current.push(node);
  }

  function stopAllAudio() {
    stopRequestedRef.current = true;

    if (loopAudioRef.current) {
      loopAudioRef.current.pause();
      loopAudioRef.current.currentTime = 0;
      loopAudioRef.current = null;
    }

    activeNodesRef.current.forEach((node) => {
      try { if (node.stop) node.stop(); } catch {}
      try { if (node.disconnect) node.disconnect(); } catch {}
    });
    activeNodesRef.current = [];

    setTanpuraOn(false);
    setCurrentNote("-");
  }

  function stopAudioOnly() {
    stopAllAudio();
    setStatus("Stopped");
  }

  async function playLoop(path: string, label: string, isTanpura = false) {
    stopAllAudio();
    try {
      const audio = new Audio(path);
      audio.loop = true;
      loopAudioRef.current = audio;
      await audio.play();
      setStatus(`Playing ${label}`);
      setCurrentNote(isTanpura ? "Tanpura" : "Beat");
      if (isTanpura) setTanpuraOn(true);
    } catch {
      setStatus(`Error playing ${label}`);
    }
  }

  async function playVoice(params: {
    freq: number;
    startAt: number;
    durationSec: number;
    type?: OscillatorType;
    gainValue?: number;
    attack?: number;
    release?: number;
    harmonic?: boolean;
  }) {
    const {
      freq,
      startAt,
      durationSec,
      type = "sine",
      gainValue = 0.12,
      attack = 0.01,
      release = 0.04,
      harmonic = false,
    } = params;

    const ctx = await ensureAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    filter.type = harmonic ? "lowpass" : "bandpass";
    filter.frequency.setValueAtTime(harmonic ? 1800 : Math.max(500, freq * 2), startAt);
    filter.Q.setValueAtTime(harmonic ? 0.7 : 1.2, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainValue, startAt + attack);
    gain.gain.setValueAtTime(gainValue, startAt + Math.max(attack, durationSec - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startAt);
    osc.stop(startAt + durationSec + 0.02);

    registerNode(osc);
    registerNode(filter);
    registerNode(gain);

    if (harmonic) {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq * 2, startAt);
      gain2.gain.setValueAtTime(0.0001, startAt);
      gain2.gain.exponentialRampToValueAtTime(gainValue * 0.25, startAt + attack);
      gain2.gain.setValueAtTime(gainValue * 0.18, startAt + Math.max(attack, durationSec - release));
      gain2.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(startAt);
      osc2.stop(startAt + durationSec + 0.02);
      registerNode(osc2);
      registerNode(gain2);
    }
  }

  async function playSequence(sequence: string, mode: "synth" | "harmonium") {
    if (expired) return;
    stopAllAudio();
    stopRequestedRef.current = false;

    const ctx = await ensureAudioContext();
    const base = mode === "harmonium" ? NOTE_FREQUENCIES["A#"] : NOTE_FREQUENCIES[sa];
    const defaultDur = Math.max(0.1, Number(duration) || 1);
    const repeats = Math.max(1, Number(repeatCount) || 1);
    const tokens = sequence.split(/\s+/).filter(Boolean);
    let cursor = ctx.currentTime + 0.05;

    setStatus(mode === "synth" ? "Starting synth playback..." : "Starting harmonium playback...");

    for (let loop = 1; loop <= repeats; loop += 1) {
      for (const token of tokens) {
        if (stopRequestedRef.current) return;
        const parsed = parseNoteToken(token, defaultDur);
        if (!BASE_SWARAS[parsed.note]) continue;
        const freq = base * BASE_SWARAS[parsed.note] * parsed.octaveMultiplier;

        setTimeout(() => setCurrentNote(token), Math.max(0, (cursor - ctx.currentTime) * 1000));

        await playVoice({
          freq,
          startAt: cursor,
          durationSec: parsed.duration,
          type: mode === "synth" ? "sine" : "sawtooth",
          gainValue: mode === "synth" ? 0.12 : 0.09,
          attack: mode === "synth" ? 0.01 : 0.04,
          release: mode === "synth" ? 0.04 : 0.08,
          harmonic: mode === "harmonium",
        });

        cursor += parsed.duration + GAP_SECONDS;
      }
    }

    const totalMs = Math.max(0, (cursor - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (!stopRequestedRef.current) {
        setStatus("Finished");
        setCurrentNote("-");
      }
    }, totalMs + 100);
  }

  async function playTanpura() {
    if (expired) return;
    if (!selectedTanpura) {
      setStatus("No tanpura selected");
      return;
    }
    await playLoop(`/audio/tanpura/${selectedTanpura}`, selectedTanpura, true);
  }

  async function playBeat() {
    if (expired) return;
    if (!selectedBeat) {
      setStatus("No beat selected");
      return;
    }
    await playLoop(`/audio/percussion/${selectedBeat}`, selectedBeat, false);
  }

  function savePractice() {
    if (!practiceTitle.trim() || !practiceBody.trim()) {
      setStatus("Please enter both title and notes");
      return;
    }
    setSavedPractice((prev) => [{ title: practiceTitle.trim(), notes: practiceBody.trim() }, ...prev]);
    setPracticeTitle("");
    setPracticeBody("");
    setStatus("Practice note saved");
  }

  function loadPractice(notes: string, target: "playback" | "harmonium") {
    if (target === "playback") {
      setPlaybackNotes(notes);
      setActiveTab("playback");
    } else {
      setHarmoniumNotes(notes);
      setActiveTab("harmonium");
    }
    setStatus(`Loaded notes into ${target}`);
  }

  function resetTrial() {
    localStorage.removeItem(STORAGE_KEY);
    const ts = getOrCreateTrialStart();
    setTrialStart(ts);
    setNow(Date.now());
    setStatus("Demo timer reset");
  }

  const styles = {
    page: { minHeight: "100vh", background: BG, color: TEXT, fontFamily: "Segoe UI, Arial, sans-serif", padding: 20 } as React.CSSProperties,
    wrap: { maxWidth: 1200, margin: "0 auto" } as React.CSSProperties,
    header: { background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 20, marginBottom: 16 } as React.CSSProperties,
    card: { background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 16, marginBottom: 16 } as React.CSSProperties,
    panel: { background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 } as React.CSSProperties,
    input: { width: "100%", background: ENTRY_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" as const },
    textarea: { width: "100%", minHeight: 180, background: ENTRY_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontFamily: "Consolas, monospace", boxSizing: "border-box" as const },
    button: { background: PANEL2, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", marginRight: 8, marginBottom: 8 } as React.CSSProperties,
    primaryButton: { background: ACCENT, color: BG, border: `1px solid ${ACCENT}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", marginRight: 8, marginBottom: 8, fontWeight: 600 } as React.CSSProperties,
    select: { width: "100%", background: ENTRY_BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" as const },
    tabs: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const },
    tab: (active: boolean): React.CSSProperties => ({ background: active ? ACCENT : PANEL2, color: active ? BG : TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600 }),
    grid2: { display: "grid", gridTemplateColumns: "1.3fr 0.9fr", gap: 16 } as React.CSSProperties,
    grid1: { display: "grid", gridTemplateColumns: "1fr", gap: 16 } as React.CSSProperties,
    label: { fontSize: 13, color: MUTED, marginBottom: 6, display: "block" } as React.CSSProperties,
    small: { fontSize: 13, color: MUTED } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, color: ACCENT2, marginBottom: 8 } as React.CSSProperties,
    row3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 } as React.CSSProperties,
  };

  const narrow = typeof window !== "undefined" ? window.innerWidth < 900 : false;

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div style={{ fontSize: 24, fontWeight: 700, color: ACCENT2 }}>SwarPulse</div>
          <div style={{ color: ACCENT, fontWeight: 600, marginTop: 4 }}>Rose Gold Practice Studio · Web Demo</div>
          <div style={{ ...styles.small, marginTop: 8 }}>7-day demo: {expired ? "Expired" : formatRemaining(remainingMs)}</div>
          <div style={{ marginTop: 12 }}>
            <button style={styles.button} onClick={resetTrial}>Reset Demo Timer</button>
            <button style={styles.button} onClick={loadManifests}>Reload Audio</button>
            <button style={styles.button} onClick={stopAudioOnly}>Stop All Audio</button>
          </div>
        </div>

        {expired && (
          <div style={{ ...styles.card, borderColor: "#aa6666" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>This was a free demo version of SwarPulse.</div>
            <div style={styles.small}>Your trial period has ended. Please contact us to continue using the full version.</div>
          </div>
        )}

        <div style={styles.tabs}>
          <button style={styles.tab(activeTab === "playback")} onClick={() => setActiveTab("playback")}>Playback</button>
          <button style={styles.tab(activeTab === "harmonium")} onClick={() => setActiveTab("harmonium")}>Harmonium</button>
          <button style={styles.tab(activeTab === "tanpura")} onClick={() => setActiveTab("tanpura")}>Tanpura</button>
          <button style={styles.tab(activeTab === "practice")} onClick={() => setActiveTab("practice")}>Practice Notes</button>
        </div>

        {activeTab === "playback" && (
          <div style={narrow ? styles.grid1 : styles.grid2}>
            <div style={styles.card}>
              <div style={styles.title}>Playback</div>
              <div style={styles.row3}>
                <div>
                  <label style={styles.label}>Sa note</label>
                  <select style={styles.select} value={sa} onChange={(e) => setSa(e.target.value)}>
                    {SA_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Default duration</label>
                  <input style={styles.input} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
                <div>
                  <label style={styles.label}>Repeat count</label>
                  <input style={styles.input} value={repeatCount} onChange={(e) => setRepeatCount(e.target.value)} />
                </div>
              </div>
              <div style={styles.panel}><div style={styles.small}>Playback tab is for synth playback only.</div></div>
              <label style={styles.label}>Enter Notes</label>
              <textarea style={styles.textarea} value={playbackNotes} onChange={(e) => setPlaybackNotes(e.target.value)} />
              <div style={{ marginTop: 12 }}>
                <button style={styles.primaryButton} disabled={expired} onClick={() => playSequence(playbackNotes, "synth")}>Play</button>
                <button style={styles.button} onClick={stopAudioOnly}>Stop</button>
                <button style={styles.button} onClick={() => setPlaybackNotes("")}>Clear</button>
              </div>
            </div>

            <div>
              <div style={styles.card}>
                <div style={styles.title}>Quick Notes</div>
                {["S R G m P D N S'", ".S .R .G S R G S'", "S:1 R:0.5 G:1 M':2"].map((item) => (
                  <div key={item} style={{ ...styles.panel, cursor: "pointer" }} onClick={() => setPlaybackNotes(item)}>
                    <div style={{ fontFamily: "Consolas, monospace" }}>{item}</div>
                  </div>
                ))}
              </div>
              <div style={styles.card}>
                <div style={styles.title}>Saved Practice Notes</div>
                {savedPractice.map((item, idx) => (
                  <div key={`${item.title}-${idx}`} style={styles.panel}>
                    <div style={{ fontWeight: 700 }}>{item.title}</div>
                    <div style={{ fontFamily: "Consolas, monospace", marginTop: 6 }}>{item.notes}</div>
                    <div style={{ marginTop: 10 }}>
                      <button style={styles.primaryButton} disabled={expired} onClick={() => loadPractice(item.notes, "playback")}>Load to Playback</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "harmonium" && (
          <div style={styles.card}>
            <div style={styles.title}>Harmonium</div>
            <div style={styles.panel}><div style={styles.small}>Harmonium demo mode uses a browser-generated reed-like tone tuned around A#.</div></div>
            <label style={styles.label}>Enter Notes</label>
            <textarea style={styles.textarea} value={harmoniumNotes} onChange={(e) => setHarmoniumNotes(e.target.value)} />
            <div style={{ marginTop: 12 }}>
              <button style={styles.primaryButton} disabled={expired} onClick={() => playSequence(harmoniumNotes, "harmonium")}>Play Harmonium</button>
              <button style={styles.button} onClick={stopAudioOnly}>Stop</button>
              <button style={styles.button} onClick={() => setHarmoniumNotes("")}>Clear</button>
            </div>
          </div>
        )}

        {activeTab === "tanpura" && (
          <div style={narrow ? styles.grid1 : styles.grid2}>
            <div style={styles.card}>
              <div style={styles.title}>Tanpura</div>
              <label style={styles.label}>Select Tanpura</label>
              <select style={styles.select} value={selectedTanpura} onChange={(e) => setSelectedTanpura(e.target.value)}>
                {tanpuraList.map((item) => <option key={item.file} value={item.file}>{item.name}</option>)}
              </select>
              <div style={{ marginTop: 12 }}>
                <button style={styles.primaryButton} disabled={expired} onClick={playTanpura}>Start Tanpura</button>
                <button style={styles.button} onClick={stopAudioOnly}>Stop Tanpura</button>
              </div>
              <div style={{ ...styles.small, marginTop: 12 }}>Current state: {tanpuraOn ? "Running" : "Stopped"}</div>
            </div>

            <div style={styles.card}>
              <div style={styles.title}>Percussion</div>
              <label style={styles.label}>Select Beat</label>
              <select style={styles.select} value={selectedBeat} onChange={(e) => setSelectedBeat(e.target.value)}>
                {percussionList.map((item) => <option key={item.file} value={item.file}>{item.name}</option>)}
              </select>
              <div style={{ marginTop: 12 }}>
                <button style={styles.primaryButton} disabled={expired} onClick={playBeat}>Play Beat</button>
                <button style={styles.button} onClick={stopAudioOnly}>Stop Beat</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "practice" && (
          <div style={narrow ? styles.grid1 : styles.grid2}>
            <div style={styles.card}>
              <div style={styles.title}>Create Practice Note</div>
              <label style={styles.label}>Title</label>
              <input style={styles.input} value={practiceTitle} onChange={(e) => setPracticeTitle(e.target.value)} />
              <div style={{ height: 12 }} />
              <label style={styles.label}>Notes</label>
              <textarea style={styles.textarea} value={practiceBody} onChange={(e) => setPracticeBody(e.target.value)} />
              <div style={{ marginTop: 12 }}>
                <button style={styles.primaryButton} disabled={expired} onClick={savePractice}>Save Practice Note</button>
              </div>
            </div>
            <div style={styles.card}>
              <div style={styles.title}>Saved Practice Notes</div>
              {savedPractice.map((item, idx) => (
                <div key={`${item.title}-${idx}`} style={styles.panel}>
                  <div style={{ fontWeight: 700 }}>{item.title}</div>
                  <div style={{ fontFamily: "Consolas, monospace", marginTop: 6 }}>{item.notes}</div>
                  <div style={{ marginTop: 10 }}>
                    <button style={styles.primaryButton} disabled={expired} onClick={() => loadPractice(item.notes, "playback")}>Load to Playback</button>
                    <button style={styles.button} disabled={expired} onClick={() => loadPractice(item.notes, "harmonium")}>Load to Harmonium</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.title}>Status</div>
          <div><strong>Playback:</strong> {status}</div>
          <div style={{ marginTop: 6 }}><strong>Current note:</strong> {currentNote}</div>
        </div>
      </div>
    </div>
  );
}
