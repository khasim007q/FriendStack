import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  Flag,
  Gamepad2,
  Layers3,
  Link,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Maximize2,
  Minimize2,
  Radio,
  RotateCcw,
  ShieldCheck,
  Signal,
  Sparkles,
  Timer,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import Pitch from "./Pitch";
import { useSession } from "./useSession";
import "./styles.css";

const friendlyTeam = (team) => (team === "home" ? "Mint" : "Coral");
const clock = (seconds) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const getName = () => {
  try {
    return localStorage.getItem("friendstack.name") || "";
  } catch {
    return "";
  }
};

function BallIcon({ size = 22, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7 4.7 3.4-1.8 5.5H9.1l-1.8-5.5L12 7Zm0 0V3m4.7 7.4 3.8-1.2m-5.6 6.7 2.3 3.2m-8.1-3.2-2.3 3.2m.5-8.7L3.5 9.2" />
    </svg>
  );
}

function Modal({ title, children, onClose, className = "" }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const el = dialog.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      closeRef.current();
    };
    el.addEventListener("cancel", cancel);
    return () => {
      el.removeEventListener("cancel", cancel);
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${className}`}
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-title">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Help({ close }) {
  return (
    <Modal title="A little football. A lot of fun." onClose={close}>
      <p className="modal-intro">
        No downloads. No sign-ups. Just get your friends onto the same pitch.
      </p>
      <ol className="help-steps">
        <li>
          <span>01</span>
          <div>
            <strong>Make it your match</strong>
            <p>
              Create a room for 1v1 to 5v5. Share the room code or invite link
              with friends connected to this sandbox.
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Pick your people</strong>
            <p>
              Join Mint or Coral and mark yourself ready. The host starts once
              both sides have players and everyone is ready. Uneven teams are
              welcome.
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Find the back of the net</strong>
            <p>
              Run into the ball to dribble. Face the direction you want to
              shoot, then kick. Most goals at the final whistle wins!
            </p>
          </div>
        </li>
      </ol>
      <div className="help-controls">
        <span>
          <kbd>W A S D</kbd> / <kbd>↑ ← ↓ →</kbd> Move
        </span>
        <span>
          <kbd>Space</kbd> Shoot
        </span>
        <span>
          <kbd>Shift</kbd> Sprint
        </span>
      </div>
      <p className="help-note">
        <Signal size={16} /> On a phone or tablet, use the on-screen joystick
        and action buttons.
      </p>
      <button className="primary full" onClick={close}>
        Got it. Let’s play <ArrowRight size={17} />
      </button>
    </Modal>
  );
}

export default function App() {
  const session = useSession();
  const {
    room,
    playerId,
    status,
    send,
    latency,
    busy,
    error,
    clearError,
    delay,
    setDelay,
    clockOffset,
  } = session;
  const [formTab, setFormTab] = useState(
    new URLSearchParams(location.search).has("room") ? "join" : "create",
  );
  const [name, setName] = useState(getName);
  const [code, setCode] = useState(
    new URLSearchParams(location.search).get("room")?.toUpperCase() || "",
  );
  const [teamSize, setTeamSize] = useState(3);
  const [duration, setDuration] = useState(3);
  const [help, setHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [sound, setSound] = useState(false);
  const [touchControls, setTouchControls] = useState(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  const [toast, setToast] = useState("");
  const [copyFallback, setCopyFallback] = useState(null);
  const [roomTab, setRoomTab] = useState("teams");
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [focused, setFocused] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const gameArea = useRef(null);
  const audio = useRef(null);
  const previousGoal = useRef(null);
  const previousPhase = useRef(null);
  const nameInput = useRef(null);
  const me = room?.players.find((p) => p.id === playerId);
  const host = me?.id === room?.hostId;
  const editable = room && ["lobby", "finished"].includes(room.phase);
  const allReady = room && room.players.every((p) => p.ready && p.connected);
  const bothSides =
    room &&
    room.players.some((p) => p.team === "home") &&
    room.players.some((p) => p.team === "away");
  const canStart =
    status === "connected" &&
    host &&
    room?.phase === "lobby" &&
    allReady &&
    bothSides;
  const active = room?.phase === "playing" && status === "connected";
  const errorText = submitError || error;
  const remaining =
    room?.phase === "playing"
      ? Math.ceil((room.endsAt - now - clockOffset.current) / 1000)
      : room?.phase === "finished"
        ? 0
        : duration * 60;
  const countdown =
    room?.phase === "countdown"
      ? Math.max(
          1,
          Math.ceil((room.startsAt - now - clockOffset.current) / 1000),
        )
      : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (room?.code) {
      setRoomTab("teams");
      setSubmitError("");
    }
  }, [room?.code]);
  useEffect(() => {
    function fullscreenChanged() {
      if (!document.fullscreenElement) setExpanded(false);
    }
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () =>
      document.removeEventListener("fullscreenchange", fullscreenChanged);
  }, []);

  function beep(frequency = 440, length = 0.12) {
    if (!sound || !audio.current) return;
    const ctx = audio.current;
    ctx.resume();
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + length);
  }
  useEffect(() => {
    const goalId = room?.goal?.until;
    if (goalId && previousGoal.current !== goalId) {
      beep(660, 0.24);
      setTimeout(() => beep(880, 0.3), 170);
    }
    previousGoal.current = goalId;
    if (room?.phase === "playing" && previousPhase.current === "countdown")
      beep(880, 0.35);
    if (room?.phase === "finished" && previousPhase.current === "playing")
      beep(330, 0.55);
    previousPhase.current = room?.phase;
  }, [room?.goal?.until, room?.phase]);

  function toggleSound() {
    if (!audio.current)
      audio.current = new (window.AudioContext || window.webkitAudioContext)();
    audio.current.resume();
    setSound(!sound);
    setToast(sound ? "Match sounds muted" : "Match sounds on");
  }
  function submit(e) {
    e.preventDefault();
    clearError();
    setSubmitError("");
    if (!name.trim()) {
      setSubmitError("A name gets you on the team. What should we call you?");
      nameInput.current?.focus();
      return;
    }
    if (formTab === "join" && !/^[A-Z2-9]{6}$/.test(code)) {
      setSubmitError("Enter the six-character room code your friend shared.");
      return;
    }
    try {
      localStorage.setItem("friendstack.name", name.trim());
    } catch {
      /* Storage can be unavailable in private browsers. */
    }
    send(
      formTab === "create"
        ? { type: "create", name: name.trim(), teamSize, duration }
        : { type: "join", name: name.trim(), code },
    );
  }
  async function copy(value, message) {
    try {
      await navigator.clipboard.writeText(value);
      setToast(message);
    } catch {
      setCopyFallback(value);
    }
  }
  function invite() {
    const url = new URL(location.href);
    url.searchParams.set("room", room.code);
    copy(url.href, "Invite link copied. Send it to your squad!");
  }
  function changeTab(tab) {
    setFormTab(tab);
    clearError();
    setSubmitError("");
  }
  async function fullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (gameArea.current.requestFullscreen) {
      try {
        await gameArea.current.requestFullscreen();
        setExpanded(true);
      } catch {
        setExpanded((v) => !v);
      }
    } else setExpanded((v) => !v);
  }
  function leave() {
    send({ type: "leave" });
    setLeaveConfirm(false);
    setFocused(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (room) setLeaveConfirm(true);
            else window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          aria-label="FriendStack home"
        >
          <span className="brand-mark">
            <Layers3 size={24} strokeWidth={2.3} />
          </span>
          <span>
            friendstack<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="header-divider" />
        <span className="playground-label">
          THE PLAYGROUND <span>ALPHA</span>
        </span>
        <nav aria-label="Main navigation">
          <a className="help-button" href="/">
            <Layers3 size={16} />
            <span>Card game</span>
          </a>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={16} />
            <span>How to play</span>
          </button>
          <span
            className={`connection-pill ${status !== "connected" ? "offline" : ""}`}
          >
            <span className="status-dot" />
            {status === "connected"
              ? "Sandbox online"
              : status === "connecting"
                ? "Connecting"
                : "Reconnecting"}
          </span>
          <button
            className={`icon-button sound-toggle ${sound ? "selected" : ""}`}
            aria-label={sound ? "Mute match sounds" : "Enable match sounds"}
            onClick={toggleSound}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <div className="avatar" title="Guest session">
            {name ? name.slice(0, 2).toUpperCase() : "FS"}
          </div>
        </nav>
      </header>

      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> A LITTLE COMPETITION. A LOT OF CONNECTION.
            </div>
            <h1>
              Good friends. <span>Great games.</span>
            </h1>
            <p>
              Your own little corner of the internet. Get the squad together and
              play.
            </p>
          </div>
          <div className="experiment-badge">
            <span className="experiment-icon">
              <FlaskIcon />
            </span>
            <div>
              <span>EXPERIMENT 001</span>
              <strong>Football, for the fun of it.</strong>
            </div>
          </div>
        </section>

        {status === "reconnecting" && (
          <div className="reconnect-banner" role="status">
            <LoaderCircle className="spin" size={18} />
            <span>
              Connection interrupted. Reconnecting automatically — your seat is
              held for 30 seconds.
            </span>
          </div>
        )}

        <div className="play-layout">
          <section
            className={`game-card ${expanded ? "expanded" : ""} ${touchControls ? "touch-mode" : ""}`}
            ref={gameArea}
            aria-label="Football game"
          >
            <div className="game-header">
              <div className="game-heading">
                <span className="football-icon">
                  <BallIcon size={24} />
                </span>
                <div>
                  <h2>
                    Kickabout<span className="version">v0.1</span>
                  </h2>
                  <p>Small teams. Big moments.</p>
                </div>
              </div>
              <div className="game-header-right">
                <span className={`game-status ${active ? "live" : ""}`}>
                  <span />
                  {!room
                    ? "LIVE PREVIEW"
                    : room.phase === "lobby"
                      ? "IN THE LOBBY"
                      : room.phase === "countdown"
                        ? "KICKING OFF"
                        : room.phase === "finished"
                          ? "FULL TIME"
                          : "MATCH LIVE"}
                </span>
                <button
                  className="icon-button expand-button"
                  aria-label={expanded ? "Exit fullscreen" : "Enter fullscreen"}
                  onClick={fullscreen}
                >
                  {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
              </div>
            </div>
            <div className="scoreboard">
              <span className="team-label mint">
                <span className="team-swatch" />
                MINT<span className="attack-direction">→</span>
              </span>
              <div className="score-center">
                <div className="score">
                  <span>{room?.score.home || 0}</span>
                  <i>:</i>
                  <span>{room?.score.away || 0}</span>
                </div>
                <div className="match-time">
                  <Timer size={11} />
                  {clock(
                    room
                      ? room.phase === "lobby" || room.phase === "countdown"
                        ? room.duration * 60
                        : remaining
                      : duration * 60,
                  )}
                  <span>
                    {!room
                      ? "DEMO"
                      : room.phase === "lobby"
                        ? "FRIENDLY"
                        : room.phase === "finished"
                          ? "FT"
                          : "REMAINING"}
                  </span>
                </div>
              </div>
              <span className="team-label coral">
                <span className="attack-direction">←</span>CORAL
                <span className="team-swatch" />
              </span>
            </div>
            <div className={`pitch-wrap ${!room ? "is-preview" : ""}`}>
              <Pitch
                room={room}
                playerId={playerId}
                send={send}
                active={active && !help && !showSettings && !leaveConfirm}
                showTouch={touchControls}
                onFocus={() => setFocused(true)}
              />
              {!room && (
                <div className="preview-tag">
                  <span />
                  PRACTICE BOTS ON THE PITCH
                </div>
              )}
              {room?.phase === "lobby" && (
                <div className="pitch-overlay lobby-overlay">
                  <div className="overlay-icon">
                    <Flag size={25} />
                  </div>
                  <h3>The pitch is yours.</h3>
                  <p>Pick a side. Ready up. Make some memories.</p>
                  <span>
                    {room.players.filter((p) => p.connected).length} /{" "}
                    {room.teamSize * 2} players in the room
                  </span>
                </div>
              )}
              {room?.phase === "countdown" && (
                <div
                  className="pitch-overlay countdown-overlay"
                  aria-live="assertive"
                >
                  <span>BOOTS ON. GAME ON.</span>
                  <strong key={countdown}>{countdown}</strong>
                  <p>
                    You’re playing for{" "}
                    <b className={me?.team === "home" ? "mint" : "coral"}>
                      {friendlyTeam(me?.team)}
                    </b>
                  </p>
                </div>
              )}
              {room?.goal && (
                <div
                  className="pitch-overlay goal-overlay"
                  aria-live="assertive"
                >
                  <span
                    className={room.goal.team === "home" ? "mint" : "coral"}
                  >
                    TEAM {friendlyTeam(room.goal.team).toUpperCase()}
                  </span>
                  <h3>Goooal!</h3>
                  <p>{room.goal.scorer} brought the magic.</p>
                </div>
              )}
              {room?.phase === "finished" && (
                <div className="pitch-overlay finished-overlay">
                  <span className="eyebrow">THAT’S THE FINAL WHISTLE</span>
                  <h3>
                    {room.score.home === room.score.away
                      ? "Honours even."
                      : `${friendlyTeam(room.score.home > room.score.away ? "home" : "away")} takes the win!`}
                  </h3>
                  <p>
                    {room.score.home} — {room.score.away} · Good game, everyone.
                  </p>
                  {host ? (
                    <button
                      className="primary"
                      onClick={() => send({ type: "rematch" })}
                    >
                      <RotateCcw size={17} /> Run it back
                    </button>
                  ) : (
                    <span>Waiting for the host to open a rematch.</span>
                  )}
                </div>
              )}
              {active && !focused && (
                <button
                  className="focus-hint"
                  onClick={() => {
                    gameArea.current.querySelector("canvas")?.focus();
                    setFocused(true);
                  }}
                >
                  <Gamepad2 size={16} />
                  Click the pitch to get moving <ArrowRight size={15} />
                </button>
              )}
            </div>
            <div className="controls-bar">
              <div className="keyboard-controls">
                <span>
                  <span className="key-group">
                    <kbd>W</kbd>
                    <span>
                      <kbd>A</kbd>
                      <kbd>S</kbd>
                      <kbd>D</kbd>
                    </span>
                  </span>
                  <span>Move</span>
                </span>
                <i />
                <span>
                  <kbd className="wide-key">SPACE</kbd>
                  <span>Shoot</span>
                </span>
                <i />
                <span>
                  <kbd className="wide-key">SHIFT</kbd>
                  <span>Sprint</span>
                </span>
              </div>
              <span className="fair-play">
                <ShieldCheck size={15} />
                {room
                  ? `Up to ${room.teamSize}v${room.teamSize} · ${room.duration} min`
                  : "Just friendly competition"}
              </span>
            </div>
            <div className="game-footer">
              <span
                className={`network-indicator ${latency.rtt > 150 ? "warning" : ""}`}
              >
                <Signal size={14} />
                {latency.rtt === null
                  ? "Measuring connection…"
                  : `${latency.rtt} ms`}
                <span className="footer-separator">·</span>
                <span>
                  {status === "connected"
                    ? "Connected to local server"
                    : "Waiting for local server"}
                </span>
              </span>
              <button
                className="text-button"
                onClick={() => setShowSettings(true)}
              >
                <Activity size={13} />
                Session diagnostics
                <ArrowUpRight size={13} />
              </button>
            </div>
          </section>

          <aside
            className="room-card"
            aria-label={room ? "Game room" : "Create or join a room"}
          >
            {!room ? (
              <>
                <div className="room-intro">
                  <div className="room-icon">
                    <Users size={21} />
                  </div>
                  <span className="tiny-label">BETTER TOGETHER</span>
                  <h2>Bring your squad.</h2>
                  <p>
                    A private pitch. Your favourite people.
                    <br />
                    You know what to do.
                  </p>
                </div>
                <div className="tabs" role="tablist" aria-label="Room action">
                  <button
                    role="tab"
                    aria-selected={formTab === "create"}
                    aria-controls="room-form"
                    onClick={() => changeTab("create")}
                  >
                    Create a room
                  </button>
                  <button
                    role="tab"
                    aria-selected={formTab === "join"}
                    aria-controls="room-form"
                    onClick={() => changeTab("join")}
                  >
                    Join a room
                  </button>
                </div>
                <form id="room-form" onSubmit={submit} noValidate>
                  <div className="field">
                    <label htmlFor="player-name">
                      Your player name<span>That’s you on the pitch</span>
                    </label>
                    <div className="input-wrap">
                      <Users size={16} />
                      <input
                        ref={nameInput}
                        id="player-name"
                        name="playerName"
                        autoComplete="nickname"
                        maxLength={18}
                        placeholder="e.g. The Sunday Striker"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setSubmitError("");
                          clearError();
                        }}
                        aria-invalid={!!errorText}
                        aria-describedby={errorText ? "form-error" : undefined}
                      />
                    </div>
                  </div>
                  {formTab === "create" ? (
                    <>
                      <div className="field">
                        <label id="team-size-label">
                          Players per side<span>Your room, your rules</span>
                        </label>
                        <div
                          className="team-size-options"
                          role="group"
                          aria-labelledby="team-size-label"
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              aria-pressed={teamSize === n}
                              className={teamSize === n ? "chosen" : ""}
                              onClick={() => setTeamSize(n)}
                            >
                              {n}
                              <small>v</small>
                              {n}
                            </button>
                          ))}
                        </div>
                        <p className="field-hint">
                          <Users size={12} />
                          Up to {teamSize * 2} friends · Uneven teams welcome
                        </p>
                      </div>
                      <div className="field duration-field">
                        <label htmlFor="duration">
                          <Timer size={15} /> Match length
                        </label>
                        <div className="select-wrap">
                          <select
                            id="duration"
                            value={duration}
                            onChange={(e) =>
                              setDuration(Number(e.target.value))
                            }
                          >
                            <option value={1}>1 minute · Quick test</option>
                            <option value={3}>
                              3 minutes · A little kickabout
                            </option>
                            <option value={5}>
                              5 minutes · Settle the score
                            </option>
                          </select>
                          <ChevronDown size={14} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="field join-code-field">
                      <label htmlFor="room-code">
                        Room code<span>Ask your friend for it</span>
                      </label>
                      <input
                        id="room-code"
                        className="code-input"
                        maxLength={6}
                        placeholder="ABCDEF"
                        autoComplete="off"
                        spellCheck="false"
                        value={code}
                        onChange={(e) => {
                          setCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, ""),
                          );
                          setSubmitError("");
                          clearError();
                        }}
                      />
                      <p className="field-hint">
                        <LockKeyhole size={12} />
                        Six characters. One good time.
                      </p>
                    </div>
                  )}
                  {errorText && (
                    <div className="form-error" id="form-error" role="alert">
                      {errorText}
                    </div>
                  )}
                  <button
                    className="primary create-button"
                    type="submit"
                    disabled={status !== "connected" || busy}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={18} className="spin" />
                        Finding your pitch…
                      </>
                    ) : (
                      <>
                        {formTab === "create"
                          ? "Let’s kick it"
                          : "Join the squad"}
                        <ArrowRight size={19} />
                      </>
                    )}
                  </button>
                  <p className="privacy-note">
                    <LockKeyhole size={12} />
                    Private rooms. No sign-up. All friends.
                  </p>
                </form>
                <div className="solo-note">
                  <Bot size={20} />
                  <div>
                    <strong>Flying solo? You’re still in.</strong>
                    <p>Add practice bots once you’re in a room.</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="room-topline">
                  <span className="tiny-label">
                    <span className="status-dot" /> YOUR PRIVATE ROOM
                  </span>
                  <button
                    className="icon-button leave-button"
                    aria-label="Leave room"
                    onClick={() => setLeaveConfirm(true)}
                  >
                    <LogOut size={17} />
                  </button>
                </div>
                <div className="room-code-display">
                  <div>
                    <span>ROOM CODE</span>
                    <button
                      onClick={() => copy(room.code, "Room code copied")}
                      aria-label={`Copy room code ${room.code}`}
                    >
                      {room.code}
                      <Copy size={16} />
                    </button>
                  </div>
                  <span className="room-capacity">
                    <Users size={14} />
                    {room.players.length}/{room.teamSize * 2}
                  </span>
                </div>
                <button className="invite-button" onClick={invite}>
                  <Link size={15} />
                  Invite your friends
                  <ArrowUpRight size={15} />
                </button>
                <div
                  className="tabs room-tabs"
                  role="tablist"
                  aria-label="Room details"
                >
                  <button
                    role="tab"
                    aria-selected={roomTab === "teams"}
                    aria-controls="room-detail-panel"
                    onClick={() => setRoomTab("teams")}
                  >
                    The teams<span>{room.players.length}</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={roomTab === "session"}
                    aria-controls="room-detail-panel"
                    onClick={() => setRoomTab("session")}
                  >
                    Session log
                    <Activity size={13} />
                  </button>
                </div>
                <div id="room-detail-panel">
                  {roomTab === "teams" ? (
                    <div className="teams-list">
                      {["home", "away"].map((team) => {
                        const players = room.players.filter(
                          (p) => p.team === team,
                        );
                        return (
                          <div className={`team-section ${team}`} key={team}>
                            <div className="team-section-header">
                              <span
                                className={team === "home" ? "mint" : "coral"}
                              >
                                <span className="team-swatch" />
                                TEAM {friendlyTeam(team).toUpperCase()}
                              </span>
                              <span>
                                {players.length}/{room.teamSize}
                              </span>
                              {me?.team !== team && editable && (
                                <button
                                  disabled={players.length >= room.teamSize}
                                  onClick={() => send({ type: "team", team })}
                                >
                                  {players.length >= room.teamSize
                                    ? "Full"
                                    : "Join side"}
                                  {players.length < room.teamSize && (
                                    <ArrowRight size={12} />
                                  )}
                                </button>
                              )}
                              {me?.team === team && (
                                <span className="your-side">Your side</span>
                              )}
                            </div>
                            {players.map((p, i) => (
                              <div
                                className={`player-row ${p.id === playerId ? "is-you" : ""}`}
                                key={p.id}
                              >
                                <span className={`player-avatar ${team}`}>
                                  {p.bot ? (
                                    <Bot size={15} />
                                  ) : (
                                    p.name.slice(0, 2).toUpperCase()
                                  )}
                                </span>
                                <span className="player-name">
                                  {p.name}
                                  {p.id === playerId && <small>YOU</small>}
                                  {p.id === room.hostId && (
                                    <Crown size={12} aria-label="Host" />
                                  )}
                                  {p.bot && <small>BOT</small>}
                                </span>
                                {!p.connected ? (
                                  <WifiOff
                                    size={13}
                                    className="disconnected"
                                    aria-label="Disconnected"
                                  />
                                ) : p.ready ? (
                                  <span
                                    className="ready-check"
                                    title="Ready"
                                    role="img"
                                    aria-label="Ready"
                                  >
                                    <Check size={14} />
                                  </span>
                                ) : (
                                  <span className="not-ready">Not ready</span>
                                )}
                              </div>
                            ))}
                            {Array.from(
                              {
                                length: Math.max(
                                  0,
                                  room.teamSize - players.length,
                                ),
                              },
                              (_, i) => (
                                <button
                                  className="empty-slot"
                                  disabled={!editable || me?.team === team}
                                  key={`empty-${i}`}
                                  onClick={() => send({ type: "team", team })}
                                >
                                  <span>+</span>
                                  <span>Waiting for a friend…</span>
                                </button>
                              ),
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="session-log">
                      <div className="session-summary">
                        <span>
                          <Timer size={14} />
                          {room.duration} minute match
                        </span>
                        <span>
                          <Users size={14} />
                          Up to {room.teamSize}v{room.teamSize}
                        </span>
                      </div>
                      <p className="tiny-label">ROOM ACTIVITY</p>
                      {room.events.slice(0, 10).map((event, i) => (
                        <div className="log-entry" key={`${event.at}-${i}`}>
                          <span className="log-dot" />
                          <p>{event.text}</p>
                          <time>
                            {new Date(event.at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="room-actions">
                  {error && (
                    <div className="form-error" role="alert">
                      {error}
                      <button aria-label="Dismiss error" onClick={clearError}>
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {editable && (
                    <>
                      <button
                        className={`ready-button ${me?.ready ? "is-ready" : ""}`}
                        disabled={status !== "connected"}
                        onClick={() =>
                          send({ type: "ready", ready: !me?.ready })
                        }
                      >
                        {me?.ready ? (
                          <>
                            <Check size={17} />
                            You’re ready<span>Undo</span>
                          </>
                        ) : (
                          <>
                            <span className="ready-square" />
                            I’m ready to play
                            <Check size={17} />
                          </>
                        )}
                      </button>
                      {host && (
                        <div className="bot-actions">
                          <button
                            className="text-button"
                            onClick={() => send({ type: "bots" })}
                            disabled={room.players.length === room.teamSize * 2}
                          >
                            <Bot size={14} />
                            Fill empty spots with bots
                          </button>
                          {room.players.some((p) => p.bot) && (
                            <button
                              className="text-button"
                              aria-label="Remove all bots"
                              onClick={() =>
                                send({ type: "bots", remove: true })
                              }
                            >
                              <X size={13} />
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                      {host && room.phase === "lobby" && (
                        <>
                          <button
                            className="primary full"
                            disabled={!canStart}
                            onClick={() => {
                              send({ type: "start" });
                              gameArea.current.querySelector("canvas")?.focus();
                              setFocused(true);
                            }}
                          >
                            <Flag size={17} />
                            Kick off
                            <ArrowRight size={17} />
                          </button>
                          <p className="start-hint">
                            {!bothSides
                              ? "Add a friend or bots to the other side."
                              : !allReady
                                ? "Waiting for everyone to ready up."
                                : "Everyone’s in. Let’s make it a good one."}
                          </p>
                        </>
                      )}
                      {!host && room.phase === "lobby" && (
                        <p className="start-hint">
                          The host will kick off when everyone’s ready.
                        </p>
                      )}
                      {host && room.phase === "finished" && (
                        <button
                          className="primary full"
                          onClick={() => send({ type: "rematch" })}
                        >
                          <RotateCcw size={17} />
                          Set up a rematch
                        </button>
                      )}
                    </>
                  )}
                  {["countdown", "playing"].includes(room.phase) && (
                    <div className="match-in-progress">
                      <Radio size={19} />
                      <strong>
                        {room.phase === "countdown"
                          ? "Here we go…"
                          : "You’re in the game."}
                      </strong>
                      <p>
                        You’re {friendlyTeam(me?.team)}. Attack the{" "}
                        {me?.team === "home" ? "right" : "left"} goal.
                      </p>
                      <span>Click the pitch, then use your keys.</span>
                    </div>
                  )}
                  {room.phase === "finished" && !host && (
                    <p className="start-hint">
                      Good game! Waiting for the host’s rematch.
                    </p>
                  )}
                </div>
                <div className="room-bottom">
                  <LockKeyhole size={12} />
                  Just your squad. Just good games.
                </div>
              </>
            )}
          </aside>
        </div>

        <section className="details-row" aria-label="About the playground">
          <div className="detail">
            <span className="detail-icon">
              <Link size={19} />
            </span>
            <div>
              <h3>One link. Everyone in.</h3>
              <p>Make a room, drop the code, round up the crew.</p>
            </div>
          </div>
          <div className="detail">
            <span className="detail-icon">
              <Zap size={19} />
            </span>
            <div>
              <h3>Made for the moment.</h3>
              <p>Quick matches. Real-time play. Rematch, anyone?</p>
            </div>
          </div>
          <div className="detail">
            <span className="detail-icon">
              <Gamepad2 size={19} />
            </span>
            <div>
              <h3>Good things are warming up.</h3>
              <p>Football today. Your next card night, soon.</p>
            </div>
          </div>
        </section>

        <footer className="page-footer">
          <span>
            <span className="footer-brand">
              <Layers3 size={14} />
              friendstack.
            </span>
            <span className="footer-dot">/</span>Less scrolling. More playing.
          </span>
          <span>
            <span className="sandbox-tag">SANDBOX</span> A small start to many
            great game nights.
            <Sparkles size={13} />
          </span>
        </footer>
      </main>

      {help && <Help close={() => setHelp(false)} />}
      {showSettings && (
        <Modal title="Under the hood" onClose={() => setShowSettings(false)}>
          <p className="modal-intro">
            A little visibility into your session. These are live measurements
            from your connection to this sandbox.
          </p>
          <div className="diagnostic-grid">
            <div>
              <span>ROUND-TRIP TIME</span>
              <strong>
                {latency.rtt ?? "—"}
                <small> ms</small>
              </strong>
            </div>
            <div>
              <span>JITTER</span>
              <strong>
                {latency.jitter}
                <small> ms</small>
              </strong>
            </div>
            <div>
              <span>SERVER SIMULATION</span>
              <strong>
                60<small> Hz</small>
              </strong>
            </div>
            <div>
              <span>SNAPSHOTS RECEIVED</span>
              <strong>
                {room ? latency.snapshots : "—"}
                <small> /s</small>
              </strong>
            </div>
          </div>
          <div className="field">
            <label htmlFor="simulated-delay">
              Simulate extra round-trip latency
            </label>
            <div className="select-wrap">
              <select
                id="simulated-delay"
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              >
                <option value={0}>None · Normal connection</option>
                <option value={80}>+80 ms · A little distance</option>
                <option value={150}>+150 ms · Across continents</option>
                <option value={300}>+300 ms · Stress test</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <p className="field-hint">
              Delays outgoing inputs and incoming snapshots by half this value
              each. The measured round trip includes this delay.
            </p>
          </div>
          <button
            className="touch-toggle"
            aria-pressed={touchControls}
            onClick={() => setTouchControls((v) => !v)}
          >
            <Gamepad2 size={17} />
            <span>
              Show touch controls
              <small>Joystick and action buttons below the pitch</small>
            </span>
            <span className="toggle-track">
              <span />
            </span>
          </button>
          <div className="diagnostic-note">
            <ShieldCheck size={18} />
            <p>
              <strong>One shared source of truth.</strong> The server handles
              movement, scores, teams, and the match clock. Disconnected players
              have a 30-second window to rejoin.
            </p>
          </div>
          <p className="help-note">
            <Wifi size={15} />
            Local sandbox: rooms reset when the server restarts. Open this
            address in another tab to try a second player.
          </p>
          <button
            className="primary full"
            onClick={() => setShowSettings(false)}
          >
            Back to the pitch
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {leaveConfirm && (
        <Modal title="Calling it a day?" onClose={() => setLeaveConfirm(false)}>
          <p className="modal-intro">
            You’ll leave this room and free up your spot. You can rejoin with
            the room code between matches.
            {host && room.players.filter((p) => !p.bot).length > 1
              ? " Another friend will become the host."
              : ""}
          </p>
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setLeaveConfirm(false)}
            >
              Stay and play
            </button>
            <button className="danger-button" onClick={leave}>
              <LogOut size={16} />
              Leave room
            </button>
          </div>
        </Modal>
      )}
      {copyFallback && (
        <Modal
          title="Your squad’s invite"
          onClose={() => setCopyFallback(null)}
        >
          <p className="modal-intro">
            Your browser couldn’t copy automatically. Select and copy this to
            share with your friends.
          </p>
          <input
            className="fallback-link"
            aria-label="Invite to copy"
            readOnly
            value={copyFallback}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
          <button
            className="primary full"
            onClick={() => setCopyFallback(null)}
          >
            Done
          </button>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function FlaskIcon() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M9 3h6M10 3v6L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9V3M7.5 14h9" />
      <path d="m10 17 1 1m3-2 1 1" />
    </svg>
  );
}
