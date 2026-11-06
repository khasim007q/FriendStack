import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "friendstack.session";
function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function useSession() {
  const [status, setStatus] = useState("connecting");
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [latency, setLatency] = useState({
    rtt: null,
    jitter: 0,
    snapshots: 0,
  });
  const [delay, setDelay] = useState(0);
  const socket = useRef(null);
  const session = useRef(readSession());
  const resuming = useRef(false);
  const delayRef = useRef(0);
  const roomRef = useRef(null);
  const clockOffset = useRef(0);
  const telemetry = useRef({
    rtts: [],
    snapshots: 0,
    since: performance.now(),
  });
  const pending = useRef(new Set());
  delayRef.current = delay;

  const schedule = useCallback((fn, ms) => {
    if (!ms) {
      fn();
      return;
    }
    const timer = setTimeout(() => {
      pending.current.delete(timer);
      fn();
    }, ms);
    pending.current.add(timer);
  }, []);

  const send = useCallback(
    (message) => {
      const ws = socket.current;
      if (ws?.readyState !== WebSocket.OPEN) {
        if (message.type !== "input" && message.type !== "ping")
          setError("The connection is recovering. Try again in a moment.");
        return false;
      }
      const currentRoom = roomRef.current?.code;
      const simulated = ["input", "ping"].includes(message.type)
        ? delayRef.current / 2
        : 0;
      schedule(() => {
        if (socket.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (message.type === "input" && currentRoom !== roomRef.current?.code)
          return;
        ws.send(JSON.stringify(message));
      }, simulated);
      if (["create", "join", "resume"].includes(message.type)) setBusy(true);
      return true;
    },
    [schedule],
  );

  useEffect(() => {
    let active = true;
    let retry;
    let attempt = 0;
    function connect() {
      if (!active) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (!active) return;
        attempt = 0;
        setStatus("connected");
        if (session.current) {
          resuming.current = true;
          send({ type: "resume", ...session.current });
        }
      };
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        schedule(
          () => {
            if (!active || socket.current !== ws) return;
            if (data.type === "welcome")
              clockOffset.current = data.serverTime - Date.now();
            if (data.type === "joined") {
              resuming.current = false;
              session.current = {
                code: data.code,
                playerId: data.playerId,
                token: data.token,
              };
              sessionStorage.setItem(
                SESSION_KEY,
                JSON.stringify(session.current),
              );
              setPlayerId(data.playerId);
              setError("");
              setBusy(false);
              const url = new URL(location.href);
              url.searchParams.set("room", data.code);
              history.replaceState(null, "", url);
            } else if (data.type === "state") {
              if (!session.current) return;
              roomRef.current = data.room;
              setRoom(data.room);
              telemetry.current.snapshots++;
            } else if (data.type === "error") {
              setError(data.message);
              setBusy(false);
              if (resuming.current || (!roomRef.current && session.current)) {
                resuming.current = false;
                roomRef.current = null;
                session.current = null;
                sessionStorage.removeItem(SESSION_KEY);
                setRoom(null);
                setPlayerId(null);
              }
            } else if (data.type === "left") {
              roomRef.current = null;
              session.current = null;
              sessionStorage.removeItem(SESSION_KEY);
              setRoom(null);
              setPlayerId(null);
              setError("");
              setBusy(false);
              history.replaceState(null, "", location.pathname);
            } else if (data.type === "pong") {
              const rtt = Math.round(performance.now() - data.at);
              const stats = telemetry.current;
              stats.rtts.push(rtt);
              if (stats.rtts.length > 12) stats.rtts.shift();
              const diffs = stats.rtts
                .slice(1)
                .map((n, i) => Math.abs(n - stats.rtts[i]));
              const elapsed = (performance.now() - stats.since) / 1000;
              setLatency({
                rtt,
                jitter: diffs.length
                  ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
                  : 0,
                snapshots: Math.round(stats.snapshots / elapsed),
              });
              stats.snapshots = 0;
              stats.since = performance.now();
              clockOffset.current = data.serverTime + rtt / 2 - Date.now();
            }
          },
          ["pong", "state"].includes(data.type) ? delayRef.current / 2 : 0,
        );
      };
      ws.onclose = () => {
        if (!active) return;
        setStatus("reconnecting");
        setBusy(false);
        retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 5000));
      };
      ws.onerror = () => {};
    }
    connect();
    const heartbeat = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN)
        send({ type: "ping", at: performance.now() });
    }, 1000);
    return () => {
      active = false;
      clearTimeout(retry);
      clearInterval(heartbeat);
      for (const timer of pending.current) clearTimeout(timer);
      pending.current.clear();
      socket.current?.close();
    };
  }, [schedule, send]);

  return {
    status,
    room,
    playerId,
    error,
    clearError: () => setError(""),
    busy,
    latency,
    delay,
    setDelay,
    send,
    clockOffset,
    roomRef,
  };
}
