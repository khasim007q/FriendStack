import { useEffect, useRef } from "react";
import { FIELD, tickRoom, resetPositions } from "../server/engine.mjs";

const COLORS = { home: "#bff77b", away: "#ff9788" };

function makeDemo() {
  const room = {
    players: new Map(),
    phase: "playing",
    endsAt: Date.now() + 86400000,
    ball: null,
    score: { home: 0, away: 0 },
    events: [],
    goal: null,
  };
  for (const team of ["home", "away"])
    for (let i = 0; i < 3; i++) {
      const id = `${team}${i}`;
      room.players.set(id, {
        id,
        team,
        name: ["Alex", "Jamie", "Sam", "Riley", "Kai", "Taylor"][
          i + (team === "away" ? 3 : 0)
        ],
        bot: true,
        connected: true,
        stamina: 1,
        lastInputAt: 0,
      });
    }
  resetPositions(room);
  return room;
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawPitch(ctx, room, playerId, time, showNames = true) {
  ctx.clearRect(0, 0, 1000, 620);
  const { left, right, top, bottom, goalTop, goalBottom } = FIELD;
  rounded(ctx, 4, 1, 992, 618, 22);
  ctx.fillStyle = "#17231f";
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#1d362a";
  ctx.fillRect(left, top, right - left, bottom - top);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#203b2e" : "#1b3429";
    ctx.fillRect(left + i * 89, top, 89, bottom - top);
  }
  // Fine turf lines give the field depth without external assets.
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#97b99d";
  ctx.lineWidth = 0.5;
  for (let y = top; y < bottom; y += 5) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#76977a";
  ctx.lineWidth = 1.7;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.beginPath();
  ctx.moveTo(500, top);
  ctx.lineTo(500, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(500, 310, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(500, 310, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "#9fb3a0";
  ctx.fill();
  ctx.strokeRect(left, 169, 135, 282);
  ctx.strokeRect(right - 135, 169, 135, 282);
  ctx.strokeRect(left, 239, 53, 142);
  ctx.strokeRect(right - 53, 239, 53, 142);
  ctx.beginPath();
  ctx.arc(150, 310, 3, 0, Math.PI * 2);
  ctx.arc(850, 310, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(150, 310, 76, -0.98, 0.98);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(850, 310, 76, Math.PI - 0.98, Math.PI + 0.98);
  ctx.stroke();
  for (const [x, y, a] of [
    [left, top, 0],
    [right, top, Math.PI / 2],
    [right, bottom, Math.PI],
    [left, bottom, -Math.PI / 2],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 13, a, a + Math.PI / 2);
    ctx.stroke();
  }
  // Goal netting, tinted to match each side.
  for (const [x, team] of [
    [24, "home"],
    [right, "away"],
  ]) {
    ctx.fillStyle = "#101e19";
    ctx.fillRect(x, goalTop, 31, goalBottom - goalTop);
    ctx.strokeStyle = team === "home" ? "#99bc82" : "#c58f83";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, goalTop, 31, goalBottom - goalTop);
    ctx.globalAlpha = 0.4;
    for (let y = goalTop + 8; y < goalBottom; y += 9) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 31, y);
      ctx.stroke();
    }
    for (let n = 8; n < 31; n += 8) {
      ctx.beginPath();
      ctx.moveTo(x + n, goalTop);
      ctx.lineTo(x + n, goalBottom);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(team === "home" ? left : right, goalTop);
    ctx.lineTo(team === "home" ? left : right, goalBottom);
    ctx.stroke();
  }
  // Touchline signage.
  ctx.font = '700 10px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "#7d8e80";
  ctx.fillText("F R I E N D S T A C K", 500, 24);
  ctx.fillStyle = "#677e6c";
  ctx.font = '500 9px "Segoe UI", sans-serif';
  ctx.fillText(
    "G O O D   G A M E S .   B E T T E R   C O M P A N Y .",
    500,
    602,
  );
  for (const x of [90, 260, 740, 910]) {
    ctx.fillStyle = "#c4e3ae";
    rounded(ctx, x - 20, 11, 40, 3, 2);
    ctx.fill();
    ctx.fillStyle = "#89ad7a";
    rounded(ctx, x - 20, 607, 40, 3, 2);
    ctx.fill();
  }
  ctx.restore();
  const players =
    room?.players instanceof Map
      ? [...room.players.values()]
      : room?.players || [];
  players.forEach((p, i) => {
    ctx.save();
    if (!p.connected) ctx.globalAlpha = 0.35;
    const color = COLORS[p.team];
    if (p.id === playerId) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + Math.sin(time / 250) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 35);
      ctx.lineTo(p.x + 5, p.y - 35);
      ctx.lineTo(p.x, p.y - 29);
      ctx.fill();
    }
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#101d17";
    ctx.beginPath();
    ctx.arc(p.x, p.y + 2, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "#ffffff38";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
    ctx.fillStyle = "#173223";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '800 12px "Segoe UI", sans-serif';
    ctx.fillText(String(i + 1).padStart(2, "0"), p.x, p.y + 0.5);
    if (showNames) {
      ctx.font = '600 11px "Segoe UI", sans-serif';
      const label = p.id === playerId ? `${p.name} · YOU` : p.name;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = "#101916d9";
      rounded(ctx, p.x - w / 2, p.y + 24, w, 20, 5);
      ctx.fill();
      ctx.fillStyle = p.id === playerId ? color : "#d4e0d5";
      ctx.fillText(label, p.x, p.y + 34);
    }
    if (p.id === playerId && p.stamina < 0.98) {
      ctx.fillStyle = "#101916";
      ctx.fillRect(p.x - 16, p.y + 47, 32, 3);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - 16, p.y + 47, 32 * p.stamina, 3);
    }
    ctx.restore();
  });
  if (room?.ball) {
    const ball = room.ball;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.fillStyle = "#0006";
    ctx.beginPath();
    ctx.ellipse(1, 4, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "#ffffff33";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#f1f2dd";
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.rotate((ball.x + ball.y) / 18);
    ctx.fillStyle = "#344139";
    ctx.beginPath();
    for (let n = 0; n < 5; n++) {
      const angle = (n * Math.PI * 2) / 5;
      ctx.lineTo(Math.cos(angle) * 3.6, Math.sin(angle) * 3.6);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export default function Pitch({
  room,
  playerId,
  send,
  active,
  showTouch,
  onFocus,
}) {
  const canvas = useRef(null);
  const roomRef = useRef(room);
  const demo = useRef(null);
  const keys = useRef(new Set());
  const touch = useRef({ x: 0, y: 0, sprint: false, kick: false });
  const latest = useRef(null);
  const previous = useRef(null);
  const receivedAt = useRef(performance.now());
  const activeRef = useRef(active);
  activeRef.current = active;
  roomRef.current = room;
  if (!demo.current) demo.current = makeDemo();

  useEffect(() => {
    previous.current = latest.current;
    latest.current = room;
    receivedAt.current = performance.now();
  }, [room]);

  useEffect(() => {
    let frame;
    let last = performance.now();
    const el = canvas.current;
    const ctx = el.getContext("2d");
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * ratio);
      el.height = Math.round(el.clientHeight * ratio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    function render(now) {
      const dt = Math.min((now - last) / 1000, 0.04);
      last = now;
      let current = roomRef.current;
      if (!current) {
        tickRoom(demo.current, dt, Date.now());
        current = demo.current;
      } else if (
        previous.current &&
        latest.current &&
        current.phase === "playing" &&
        !current.goal
      ) {
        const t = Math.min(1, (now - receivedAt.current) / 50);
        const prev = previous.current;
        current = {
          ...current,
          players: current.players.map((p) => {
            const old = prev.players.find((o) => o.id === p.id);
            return old
              ? {
                  ...p,
                  x: old.x + (p.x - old.x) * t,
                  y: old.y + (p.y - old.y) * t,
                }
              : p;
          }),
          ball: prev.ball
            ? {
                ...current.ball,
                x: prev.ball.x + (current.ball.x - prev.ball.x) * t,
                y: prev.ball.y + (current.ball.y - prev.ball.y) * t,
              }
            : current.ball,
        };
      }
      ctx.setTransform(el.width / 1000, 0, 0, el.height / 620, 0, 0);
      drawPitch(ctx, current, playerId, now, !!roomRef.current);
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [playerId]);

  useEffect(() => {
    const isTyping = (target) =>
      target instanceof HTMLElement &&
      (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) ||
        target.isContentEditable);
    const controls = [
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      " ",
      "shift",
    ];
    function down(e) {
      if (!activeRef.current || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (!controls.includes(key)) return;
      e.preventDefault();
      keys.current.add(key);
      if (key === " " && !e.repeat) touch.current.kick = true;
    }
    function up(e) {
      keys.current.delete(e.key.toLowerCase());
    }
    function blur() {
      keys.current.clear();
      touch.current = { x: 0, y: 0, sprint: false, kick: false };
      if (activeRef.current)
        send({ type: "input", x: 0, y: 0, sprint: false, kick: false });
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", blur);
    const timer = setInterval(() => {
      if (!activeRef.current || document.hidden) return;
      const k = keys.current;
      const x =
        Number(k.has("d") || k.has("arrowright")) -
        Number(k.has("a") || k.has("arrowleft")) +
        touch.current.x;
      const y =
        Number(k.has("s") || k.has("arrowdown")) -
        Number(k.has("w") || k.has("arrowup")) +
        touch.current.y;
      send({
        type: "input",
        x,
        y,
        sprint: k.has("shift") || touch.current.sprint,
        kick: touch.current.kick,
      });
      touch.current.kick = false;
    }, 1000 / 30);
    return () => {
      clearInterval(timer);
      keys.current.clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", blur);
    };
  }, [send]);

  function joystick(e) {
    const box = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - box.left - box.width / 2) / (box.width * 0.32);
    let y = (e.clientY - box.top - box.height / 2) / (box.height * 0.32);
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    touch.current.x = x;
    touch.current.y = y;
    e.currentTarget.style.setProperty("--stick-x", `${x * 21}px`);
    e.currentTarget.style.setProperty("--stick-y", `${y * 21}px`);
  }
  function releaseStick(e) {
    touch.current.x = 0;
    touch.current.y = 0;
    e.currentTarget.style.setProperty("--stick-x", "0px");
    e.currentTarget.style.setProperty("--stick-y", "0px");
  }
  return (
    <>
      <canvas
        ref={canvas}
        className="pitch-canvas"
        tabIndex={room ? 0 : -1}
        aria-label={
          room
            ? "Football pitch. Use WASD or arrow keys to move, Space to shoot, Shift to sprint."
            : "Live preview of a three versus three football match with practice bots"
        }
        onFocus={onFocus}
        onClick={(e) => e.currentTarget.focus()}
      />
      {active && showTouch && (
        <div className="touch-controls">
          <div
            className="joystick"
            role="group"
            aria-label="Touch movement control"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              joystick(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) joystick(e);
            }}
            onPointerUp={releaseStick}
            onPointerCancel={releaseStick}
          >
            <span />
          </div>
          <div className="touch-actions">
            <button
              className="touch-sprint"
              aria-label="Hold to sprint"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                touch.current.sprint = true;
              }}
              onPointerUp={() => (touch.current.sprint = false)}
              onPointerCancel={() => (touch.current.sprint = false)}
            >
              Sprint
            </button>
            <button
              className="touch-kick"
              onPointerDown={() => (touch.current.kick = true)}
            >
              Shoot
            </button>
          </div>
        </div>
      )}
    </>
  );
}
