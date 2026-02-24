import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { socket } from "./socket";
import type { ServerGameStatePayload } from "./types";
import type { Tile, PlayerId } from "@okey/shared";

type JoinAck =
  | { ok: true; playerId: string; roomId: string; token: string }
  | { ok: false; error: string };

type SimpleAck = { ok: true } | { ok: false; error: string };

function fmtTile(t: Tile): string {
  if (t.kind === "fakeJoker") return `🃏 Fake Joker`;
  return `${t.color} ${t.value}`;
}

function topOfPile(pile: Tile[] | undefined): Tile | null {
  if (!pile || pile.length === 0) return null;
  return pile[pile.length - 1] ?? null;
}

function tokenKey(roomId: string) {
  return `okey101_token:${roomId}`;
}

export default function App() {
  const [connected, setConnected] = useState(false);

  const [roomId, setRoomId] = useState("room1");
  const [name, setName] = useState("Alice");
  const [joined, setJoined] = useState(false);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerGameStatePayload | null>(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setJoined(false);
      setPlayerId(null);
      setServerState(null);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on("game:state", (payload: unknown) => {
      // MVP: trust payload
      console.log("got game:state", payload);
      setServerState(payload as ServerGameStatePayload);
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("game:state");
    };
  }, []);

  const isMyTurn = useMemo(() => {
    const s = serverState?.state;
    if (!s || s.phase !== "turn") return false;
    return s.currentPlayerId === playerId;
  }, [serverState, playerId]);

  function join() {
    // IMPORTANT: sessionStorage so multiple tabs can create multiple players
    const token = sessionStorage.getItem(tokenKey(roomId)) ?? undefined;

    socket.emit("room:join", { roomId, name, token }, (ack: JoinAck) => {
      if (!ack.ok) return alert(`join failed: ${ack.error}`);

      setJoined(true);
      setPlayerId(ack.playerId);
      sessionStorage.setItem(tokenKey(roomId), ack.token);
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

  function draw(source: "deck" | "prevDiscard") {
    socket.emit("move:draw", { source }, (ack: SimpleAck) => {
      if (!ack.ok) alert(`draw failed: ${ack.error}`);
    });
  }

  function discard(tileId: string) {
    socket.emit("move:discard", { tileId }, (ack: SimpleAck) => {
      if (!ack.ok) alert(`discard failed: ${ack.error}`);
    });
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <h2>Okey 101 (MVP)</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div>Socket: {connected ? "✅" : "❌"}</div>
        <div>Phase: {serverState?.state.phase ?? "-"}</div>
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

      {!serverState ? <div>Join a room to see state.</div> : null}

      {serverState ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <h3>Players</h3>
            <ul>
              {serverState.state.players.map((p) => (
                <li key={p.playerId}>
                  {p.name} {p.playerId === playerId ? "(you)" : ""} — {p.ready ? "ready" : "not ready"}
                  {serverState.state.phase === "turn" && (serverState.state as any).currentPlayerId === p.playerId
                    ? " ⭐"
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
                <button
                  onClick={() => draw("deck")}
                  disabled={!isMyTurn || serverState.state.turnStep !== "mustDraw"}
                >
                  Draw (closed)
                </button>

                <button
                  onClick={() => draw("prevDiscard")}
                  disabled={!isMyTurn || serverState.state.turnStep !== "mustDraw"}
                >
                  Take previous discard
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <h3>Game</h3>

            {serverState.state.phase === "lobby" ? (
              <div>Waiting in lobby…</div>
            ) : (
              <TurnPanel state={serverState.state} youPlayerId={playerId} isMyTurn={isMyTurn} onDiscard={discard} />
            )}
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <h3>Debug</h3>
            <pre style={{ background: "#111", padding: 12, borderRadius: 8, overflow: "auto" }}>
              {JSON.stringify(serverState, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TurnPanel(props: {
  state: Extract<ServerGameStatePayload["state"], { phase: "turn" }>;
  youPlayerId: string | null;
  isMyTurn: boolean;
  onDiscard: (tileId: string) => void;
}) {
  const { state, youPlayerId, isMyTurn, onDiscard } = props;

  const order = state.players.map((p) => p.playerId);
  const curIdx = order.indexOf(state.currentPlayerId);
  const prevPlayerId: PlayerId | null =
    curIdx >= 0 ? (order[(curIdx - 1 + order.length) % order.length] as PlayerId) : null;

  const prevTop = prevPlayerId ? topOfPile(state.discardPiles?.[prevPlayerId]) : null;
  const canTakePrev = !!prevTop;

  return (
    <div>
      <div>
        <b>Indicator:</b> {fmtTile(state.indicator)}{" "}
        <span style={{ opacity: 0.8 }}>({state.indicator.id})</span>
      </div>
      <div>
        <b>Okey:</b> {state.okey.color} {state.okey.value}
      </div>

      <div style={{ marginTop: 8 }}>Current player: {state.currentPlayerId}</div>
      <div>Turn step: {state.turnStep}</div>
      <div>Deck count: {state.deckCount}</div>

      <div style={{ marginTop: 8 }}>
        <b>Previous player discard top:</b>{" "}
        {prevPlayerId ? (
          prevTop ? (
            <>
              {fmtTile(prevTop)} <span style={{ opacity: 0.8 }}>({prevTop.id})</span>
            </>
          ) : (
            "empty"
          )
        ) : (
          "-"
        )}
        {isMyTurn && state.turnStep === "mustDraw" ? (
          <span style={{ marginLeft: 8, opacity: 0.85 }}>
            (you can take it: {canTakePrev ? "yes" : "no"})
          </span>
        ) : null}
      </div>

      <h4 style={{ marginTop: 12 }}>Discard piles (top tiles)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {state.players.map((p) => {
          const top = topOfPile(state.discardPiles?.[p.playerId]);
          return (
            <div key={p.playerId} style={{ border: "1px solid #333", padding: 8, borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>
                {p.name} {p.playerId === youPlayerId ? "(you)" : ""}
              </div>
              <div style={{ opacity: 0.9 }}>
                Top: {top ? `${fmtTile(top)} (${top.id})` : "empty"}
              </div>
            </div>
          );
        })}
      </div>

      <h4 style={{ marginTop: 12 }}>Your hand (click to discard)</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {state.yourHand.map((t) => (
          <button
            key={t.id}
            onClick={() => onDiscard(t.id)}
            disabled={!isMyTurn || state.turnStep !== "mustDiscard"}
            title={t.id}
          >
            {fmtTile(t)}
          </button>
        ))}
      </div>
    </div>
  );
}