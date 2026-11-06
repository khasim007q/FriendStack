export const FIELD = {
  width: 1000,
  height: 620,
  left: 55,
  right: 945,
  top: 45,
  bottom: 575,
  goalTop: 235,
  goalBottom: 385,
};
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function resetPositions(room) {
  for (const team of ["home", "away"]) {
    const players = [...room.players.values()].filter((p) => p.team === team);
    players.forEach((p, i) => {
      p.x = team === "home" ? 310 - (i % 2) * 100 : 690 + (i % 2) * 100;
      p.y = (FIELD.height * (i + 1)) / (players.length + 1);
      p.dx = team === "home" ? 1 : -1;
      p.dy = 0;
      p.stamina = 1;
      p.input = { x: 0, y: 0, sprint: false, kick: false };
      p.lastInputAt = 0;
    });
  }
  room.ball = { x: 500, y: 310, vx: 0, vy: 0, lastTouch: null };
}

export function botInput(player, room, now) {
  const ball = room.ball;
  const teammates = [...room.players.values()].filter(
    (p) => p.team === player.team && p.connected,
  );
  const closest = teammates.reduce(
    (best, p) =>
      Math.hypot(p.x - ball.x, p.y - ball.y) <
      Math.hypot(best.x - ball.x, best.y - ball.y)
        ? p
        : best,
    teammates[0] || player,
  );
  const direction = player.team === "home" ? 1 : -1;
  const i = teammates.indexOf(player);
  const targetX =
    closest.id === player.id
      ? ball.x
      : clamp(ball.x - direction * (140 + i * 38), 160, 840);
  const targetY =
    closest.id === player.id
      ? ball.y
      : clamp(165 + i * 110 + Math.sin(now / 1400 + i) * 45, 100, 520);
  const dist = Math.hypot(targetX - player.x, targetY - player.y);
  const near = Math.hypot(ball.x - player.x, ball.y - player.y) < 44;
  if (near) {
    return {
      x: direction,
      y: (310 - player.y) / 300,
      sprint: false,
      kick: Math.random() < 0.07,
    };
  }
  return {
    x: dist > 8 ? (targetX - player.x) / dist : 0,
    y: dist > 8 ? (targetY - player.y) / dist : 0,
    sprint: dist > 180,
    kick: false,
  };
}

export function tickRoom(room, dt, now) {
  if (room.phase === "countdown") {
    if (now >= room.startsAt) {
      room.phase = "playing";
      room.endsAt = now + room.duration * 60_000;
    }
    return;
  }
  if (room.phase !== "playing") return;
  if (now >= room.endsAt) {
    room.phase = "finished";
    room.goal = null;
    return;
  }
  if (room.goal && now < room.goal.until) return;
  if (room.goal) {
    room.goal = null;
    resetPositions(room);
  }
  const ball = room.ball;
  const players = [...room.players.values()].filter((p) => p.connected);
  for (const p of players) {
    if (p.bot) p.input = botInput(p, room, now);
    if (!p.bot && now - p.lastInputAt > 300)
      p.input = { x: 0, y: 0, sprint: false, kick: false };
    const input = p.input;
    const magnitude = Math.hypot(input.x, input.y);
    const x = magnitude > 1 ? input.x / magnitude : input.x;
    const y = magnitude > 1 ? input.y / magnitude : input.y;
    const sprinting = input.sprint && p.stamina > 0.05 && magnitude > 0;
    const speed = sprinting ? 230 : 165;
    p.stamina = clamp(p.stamina + dt * (sprinting ? -0.24 : 0.15), 0, 1);
    p.x = clamp(p.x + x * speed * dt, FIELD.left + 16, FIELD.right - 16);
    p.y = clamp(p.y + y * speed * dt, FIELD.top + 16, FIELD.bottom - 16);
    if (magnitude > 0.05) {
      p.dx = x;
      p.dy = y;
    }
    const distance = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (input.kick && distance < 49 && now - (p.lastKick || 0) > 300) {
      const aim = Math.hypot(p.dx, p.dy) || 1;
      ball.vx = (p.dx / aim) * 670;
      ball.vy = (p.dy / aim) * 670;
      ball.lastTouch = p.id;
      p.lastKick = now;
    } else if (distance < 26 && Math.hypot(ball.vx, ball.vy) < 420) {
      const nx = (ball.x - p.x) / (distance || 1);
      const ny = (ball.y - p.y) / (distance || 1);
      ball.x = p.x + nx * 27;
      ball.y = p.y + ny * 27;
      ball.vx = x * speed * 1.3 + nx * 30;
      ball.vy = y * speed * 1.3 + ny * 30;
      ball.lastTouch = p.id;
    }
    p.input.kick = false;
  }
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i],
        b = players[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 31 && d > 0.01) {
        const push = (31 - d) / 2;
        const nx = (b.x - a.x) / d,
          ny = (b.y - a.y) / d;
        a.x = clamp(a.x - nx * push, FIELD.left + 16, FIELD.right - 16);
        a.y = clamp(a.y - ny * push, FIELD.top + 16, FIELD.bottom - 16);
        b.x = clamp(b.x + nx * push, FIELD.left + 16, FIELD.right - 16);
        b.y = clamp(b.y + ny * push, FIELD.top + 16, FIELD.bottom - 16);
      }
    }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const friction = Math.pow(0.985, dt * 60);
  ball.vx *= friction;
  ball.vy *= friction;
  if (ball.y < FIELD.top + 7 || ball.y > FIELD.bottom - 7) {
    ball.y = clamp(ball.y, FIELD.top + 7, FIELD.bottom - 7);
    ball.vy *= -0.75;
  }
  const inGoal = ball.y > FIELD.goalTop + 7 && ball.y < FIELD.goalBottom - 7;
  if ((ball.x < FIELD.left || ball.x > FIELD.right) && inGoal) {
    const team = ball.x > FIELD.right ? "home" : "away";
    room.score[team]++;
    room.goal = {
      team,
      scorer: room.players.get(ball.lastTouch)?.name || "Team effort",
      until: now + 1800,
    };
    room.events.unshift({
      type: "goal",
      text: `${team === "home" ? "Mint" : "Coral"} scored`,
      at: now,
    });
    room.events.length = Math.min(room.events.length, 20);
    return;
  }
  if (ball.x < FIELD.left + 7 || ball.x > FIELD.right - 7) {
    ball.x = clamp(ball.x, FIELD.left + 7, FIELD.right - 7);
    ball.vx *= -0.75;
  }
}
