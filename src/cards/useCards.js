import { useCallback, useEffect, useRef, useState } from "react";

export function useCards() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem("friendstack.cards.auth") || "";
    } catch {
      return "";
    }
  });
  const [data, setData] = useState(null),
    [room, setRoom] = useState(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("offline"),
    [rtt, setRtt] = useState(null);
  const socket = useRef(null),
    tokenRef = useRef(token),
    refreshSequence = useRef(0),
    roomRef = useRef(null),
    offset = useRef(0);
  tokenRef.current = token;
  roomRef.current = room;
  const api = useCallback(async (path, body) => {
    const requestToken = tokenRef.current;
    const response = await fetch(`/api/cards${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "The server is recovering. Please try again in a moment.",
      );
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && tokenRef.current === requestToken) {
        tokenRef.current = "";
        setToken("");
        setData(null);
        try {
          sessionStorage.removeItem("friendstack.cards.auth");
        } catch {}
      }
      throw new Error(result.error || "Something went wrong. Try again.");
    }
    return result;
  }, []);
  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    const expectedToken = tokenRef.current,
      sequence = ++refreshSequence.current;
    try {
      const result = await api("/me");
      if (
        expectedToken === tokenRef.current &&
        sequence === refreshSequence.current
      )
        setData(result);
    } catch (e) {
      setError(e.message);
    }
  }, [api]);
  const signIn = async (mode, values) => {
    const result = await api(`/auth/${mode}`, values);
    try {
      sessionStorage.setItem("friendstack.cards.auth", result.token);
    } catch {}
    tokenRef.current = result.token;
    setToken(result.token);
    setError("");
  };
  const logout = async () => {
    await api("/logout", {});
    try {
      sessionStorage.removeItem("friendstack.cards.auth");
    } catch {}
    tokenRef.current = "";
    setToken("");
    setData(null);
    setRoom(null);
  };
  const send = useCallback((message) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError("Your table connection is recovering. Try again shortly.");
      return false;
    }
    socket.current.send(
      JSON.stringify({
        ...message,
        ...(message.type === "act" && roomRef.current?.version !== undefined
          ? { version: roomRef.current.version }
          : {}),
        requestId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      }),
    );
    return true;
  }, []);
  useEffect(() => {
    if (!token) {
      setStatus("offline");
      return;
    }
    let active = true,
      retry,
      attempt = 0,
      stopped = false;
    refresh();
    function connect() {
      if (!active || stopped) return;
      setStatus("connecting");
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ws/cards`,
      );
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
      ws.onmessage = (event) => {
        if (!active || socket.current !== ws) return;
        const packet = JSON.parse(event.data);
        if (packet.type === "connected") {
          setStatus("connected");
          attempt = 0;
          offset.current = packet.serverTime - Date.now();
        } else if (packet.type === "state") {
          setRoom(packet.room);
          setError("");
        } else if (packet.type === "left") {
          setRoom(null);
          refresh();
        } else if (packet.type === "refresh") refresh();
        else if (packet.type === "error") setError(packet.message);
        else if (packet.type === "pong") {
          const value = Math.round(performance.now() - packet.at);
          setRtt(value);
          offset.current = packet.serverTime + value / 2 - Date.now();
        }
      };
      ws.onclose = (event) => {
        if (!active) return;
        if (event.code === 4001) {
          stopped = true;
          setStatus("elsewhere");
          setError(
            "This identity opened in another window. Refresh this page to use this window instead.",
          );
        } else if (event.code === 4003) {
          stopped = true;
          tokenRef.current = "";
          setToken("");
          setData(null);
          setRoom(null);
          try {
            sessionStorage.removeItem("friendstack.cards.auth");
          } catch {}
          setError(
            event.reason === "Signed out"
              ? ""
              : "Your session ended. Sign in again.",
          );
        } else {
          setStatus("reconnecting");
          retry = setTimeout(
            connect,
            Math.min(500 * 2 ** attempt++, 5000) + Math.random() * 500,
          );
        }
      };
      ws.onerror = () => {};
    }
    connect();
    const ping = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN)
        send({ type: "ping", at: performance.now() });
    }, 1500);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearTimeout(retry);
      clearInterval(ping);
      window.removeEventListener("focus", focus);
      socket.current?.close();
    };
  }, [token, refresh, send]);
  return {
    token,
    data,
    room,
    error,
    setError,
    status,
    rtt,
    offset,
    api,
    refresh,
    signIn,
    logout,
    send,
  };
}
