import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { socket } from "./socket";
import type { ServerGameStatePayload } from "./types";

type JoinAck =
  | { ok: true; playerId: string; roomId: string }
  | { ok: false; error: string };

type SimpleAck = { ok: true } | { ok: false; error: string };

export default function App() {
  const [connected, setConnected] = useState(false);

  const [roomId, setRoomId] = useState("room1");
  const [name, setName] = useState("Alice");
  const [joined, setJoined] = useState(false);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerGameStatePayload | null>(null);
  const phase = serverState?.state.phase;

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
      setJoined(false);
      setPlayerId(null);
      setServerState(null);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("game:state", (payload: unknown) => {
      // MVP: trust server payload; later we’ll validate with Zod
      setServerState(payload as ServerGameStatePayload);
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("game:state");
    };
  }, []);

  const isMyTurn = useMemo(() => {
    if (!serverState) return false;
    const s = serverState.state;
    if (s.phase !== "turn") return false;
    return s.currentPlayerId === playerId;
  }, [serverState, playerId]);

  function join() {
    socket.emit("room:join", { roomId, name }, (ack: JoinAck) => {
      if (!ack.ok) {
        alert(`join failed: ${ack.error}`);
        return;
      }
      setJoined(true);
      setPlayerId(ack.playerId);
    });
  }

  function ready(ready: boolean) {
    socket.emit("room:ready", { ready }, (ack: SimpleAck) => {
      if (!ack.ok) alert(`ready failed: ${ack.error}`);
    });
  }

  function start() {
    socket.emit("game:start", {}, (ack: SimpleAck) => {
      if (!ack.ok) alert(`start failed: ${ack.error}`);
    });
  }

  function draw() {
    socket.emit("move:draw", {}, (ack: SimpleAck) => {
      if (!ack.ok) alert(`draw failed: ${ack.error}`);
    });
  }

  function discard(tile: number) {
    socket.emit("move:discard", { tile }, (ack: SimpleAck) => {
      if (!ack.ok) alert(`discard failed: ${ack.error}`);
    });
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <h2>Okey 101 (MVP)</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div>Socket: {connected ? "✅ connected" : "❌ disconnected"}</div>
        <div>Phase: {phase ?? "-"}</div>
        <div>Version: {serverState?.version ?? "-"}</div>
      </div>

      {!joined ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="roomId" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
          <button onClick={join} disabled={!connected}>
            Join
          </button>
        </div>
      ) : null}

      {serverState ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <h3>Players</h3>
            <ul>
              {serverState.state.players.map((p) => (
                <li key={p.playerId}>
                  {p.name} {p.playerId === playerId ? "(you)" : ""} — {p.ready ? "ready" : "not ready"}{" "}
                  {serverState.state.phase === "turn" && serverState.state.currentPlayerId === p.playerId
                    ? " ⭐ current"
                    : ""}
                </li>
              ))}
            </ul>

            {serverState.state.phase === "lobby" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => ready(true)}>Ready on</button>
                <button onClick={() => ready(false)}>Ready off</button>
                <button onClick={start}>Start (host)</button>
              </div>
            ) : null}

            {serverState.state.phase === "turn" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={draw} disabled={!isMyTurn || serverState.state.turnStep !== "mustDraw"}>
                  Draw
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <h3>Game</h3>

            {serverState.state.phase === "lobby" ? (
              <div>Waiting in lobby…</div>
            ) : (
              <TurnPanel
                state={serverState.state}
                isMyTurn={isMyTurn}
                onDiscard={discard}
              />
            )}
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <h3>Debug state</h3>
            <pre style={{ background: "#111", padding: 12, borderRadius: 8, overflow: "auto" }}>
              {JSON.stringify(serverState, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <div>Join a room to see state.</div>
      )}
    </div>
  );
}

function TurnPanel(props: {
  state: Extract<ServerGameStatePayload["state"], { phase: "turn" }>;
  isMyTurn: boolean;
  onDiscard: (tile: number) => void;
}) {
  const { state, isMyTurn, onDiscard } = props;

  return (
    <div>
      <div>Current player: {state.currentPlayerId}</div>
      <div>Turn step: {state.turnStep}</div>
      <div>Deck count: {state.deckCount}</div>
      <div>Discard pile (top): {state.discardPile[state.discardPile.length - 1] ?? "-"}</div>

      <h4>Your hand</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {state.yourHand.map((t, idx) => (
          <button
            key={`${t}-${idx}`}
            onClick={() => onDiscard(t)}
            disabled={!isMyTurn || state.turnStep !== "mustDiscard"}
            title="Click to discard"
          >
            {t}
          </button>
        ))}
      </div>

      <h4>Other hands</h4>
      <ul>
        {state.players
          .filter((p) => p.playerId !== state.players.find((x) => x.playerId)?.playerId)
          .map((p) => (
            <li key={p.playerId}>
              {p.name}: {state.otherHandCounts[p.playerId] ?? 0} tiles
            </li>
          ))}
      </ul>
    </div>
  );
}
