import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import { socket } from "./socket.ts";
import type { ServerGameStatePayload } from "./types.ts";
import type { Tile } from "@okey/shared";

type JoinAck =
  | { ok: true; playerId: string; roomId: string; token: string }
  | { ok: false; error: string };

type SimpleAck = { ok: true } | { ok: false; error: string };

/* ── Tile helpers ─────────────────────────────────────── */

function tileColorClass(t: Tile): string {
  if (t.kind === "fakeJoker") return "fake-joker";
  return `color-${t.color}`;
}

function tileLabel(t: Tile): string {
  if (t.kind === "fakeJoker") return "⭐";
  return String(t.value);
}

function isOkeyTile(t: Tile, okey: { color: string; value: number }): boolean {
  return t.kind === "normal" && t.color === okey.color && t.value === okey.value;
}

function topOfPile(pile: Tile[] | undefined): Tile | null {
  if (!pile || pile.length === 0) return null;
  return pile[pile.length - 1] ?? null;
}

function tokenKey(roomId: string) {
  return `okey101_token:${roomId}`;
}

/* ── Position helpers ─────────────────────────────────── */

/** Given the full player order and who "you" are, return [bottom, left, top, right] player ids */
function seatOrder(players: { playerId: string }[], youId: string | null): string[] {
  const ids = players.map((p) => p.playerId);
  const myIdx = ids.indexOf(youId ?? "");
  if (myIdx === -1) return ids; // fallback
  return [0, 1, 2, 3].map((offset) => ids[(myIdx + offset) % ids.length]!);
}

/* ── TileChip component ──────────────────────────────── */

function TileChip({
  tile,
  selected,
  disabled,
  onClick,
  onDoubleClick,
  faceDown,
  okey,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  tile?: Tile;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  faceDown?: boolean;
  okey?: { color: string; value: number };
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  if (faceDown || !tile) {
    return <div className="tile face-down" />;
  }

  const isOkey = okey && isOkeyTile(tile, okey);

  const cls = [
    "tile",
    tileColorClass(tile),
    selected ? "selected" : "",
    disabled ? "disabled" : "",
    isOkey ? "okey-tile" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      onClick={disabled ? undefined : onClick}
      onDoubleClick={disabled ? undefined : onDoubleClick}
      title={tile.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="tile-value">{tileLabel(tile)}</span>
      <span className="tile-dot" />
      {isOkey && <span className="okey-star">⭐</span>}
    </div>
  );
}

/* ── App ─────────────────────────────────────────────── */

export default function App() {
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState("room1");
  const [name, setName] = useState("");
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
    socket.on("game:state", (p: unknown) => {
      setServerState(p as ServerGameStatePayload);
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

  /* ── socket emitters ── */
  function join() {
    const token = sessionStorage.getItem(tokenKey(roomId)) ?? undefined;
    socket.emit("room:join", { roomId, name, token }, (ack: JoinAck) => {
      if (!ack.ok) return alert(`Join failed: ${ack.error}`);
      setJoined(true);
      setPlayerId(ack.playerId);
      sessionStorage.setItem(tokenKey(roomId), ack.token);
    });
  }
  function setReady(r: boolean) {
    socket.emit("room:ready", { ready: r }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function startGame() {
    socket.emit("game:start", {}, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function draw(source: "deck" | "prevDiscard") {
    socket.emit("move:draw", { source }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function discard(tileId: string) {
    socket.emit("move:discard", { tileId }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function openMeld(melds: string[][]) {
    socket.emit("move:open", { melds }, (a: SimpleAck) => {
      if (!a.ok) alert(`Open failed: ${a.error}`);
    });
  }
  function layoff(tableMeldId: string, tileIds: string[]) {
    socket.emit("move:layoff", { tableMeldId, tileIds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function takeAndMeld(fromPlayerId: string, melds: string[][]) {
    socket.emit("move:takeAndMeld", { fromPlayerId, melds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function reorderHand(tileIds: string[]) {
    socket.emit("move:reorder", { tileIds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }

  const gs = serverState?.state;

  /* ── Join screen ── */
  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h1>🎴 Okey 101</h1>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Room ID"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button onClick={join} disabled={!connected || !name.trim()}>
            {connected ? "Join Room" : "Connecting…"}
          </button>
        </div>
      </div>
    );
  }

  /* ── Lobby ── */
  if (!gs || gs.phase === "lobby") {
    return (
      <div className="join-screen">
        <div className="lobby-card">
          <h2>Lobby — {roomId}</h2>
          <div className="lobby-players">
            {(gs?.players ?? []).map((p) => (
              <div
                key={p.playerId}
                className={`lobby-player ${p.ready ? "ready" : ""} ${p.playerId === playerId ? "you" : ""}`}
              >
                <div className="avatar-placeholder" />
                <span>{p.name}{p.playerId === playerId ? " (you)" : ""}</span>
                <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                  {p.ready ? "✓" : "…"}
                </span>
              </div>
            ))}
            {Array.from({ length: 4 - (gs?.players.length ?? 0) }).map((_, i) => (
              <div key={`empty-${i}`} className="lobby-player empty">
                <div className="avatar-placeholder" />
                <span>Waiting…</span>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <button onClick={() => setReady(true)}>Ready</button>
            <button onClick={() => setReady(false)} className="secondary">
              Not Ready
            </button>
            <button onClick={startGame} className="primary">
              Start Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Game board ── */
  return (
    <GameBoard
      state={gs}
      playerId={playerId}
      isMyTurn={isMyTurn}
      onDraw={draw}
      onDiscard={discard}
      onOpenMeld={openMeld}
      onLayoff={layoff}
      onTakeAndMeld={takeAndMeld}
      onReorder={reorderHand}
    />
  );
}

/* ── Game Board ──────────────────────────────────────── */

type TurnState = Extract<ServerGameStatePayload["state"], { phase: "turn" }>;

function GameBoard({
  state,
  playerId,
  isMyTurn,
  onDraw,
  onDiscard,
  onOpenMeld,
  onLayoff,
  onTakeAndMeld,
  onReorder,
}: {
  state: TurnState;
  playerId: string | null;
  isMyTurn: boolean;
  onDraw: (source: "deck" | "prevDiscard") => void;
  onDiscard: (tileId: string) => void;
  onOpenMeld: (melds: string[][]) => void;
  onLayoff: (tableMeldId: string, tileIds: string[]) => void;
  onTakeAndMeld: (fromPlayerId: string, melds: string[][]) => void;
  onReorder: (tileIds: string[]) => void;
}) {
  const GRID_SLOTS = 30;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [meldGroups, setMeldGroups] = useState<string[][]>([]);
  const [layoffTargetId, setLayoffTargetId] = useState<string | null>(null);
  const dragTileId = useRef<string | null>(null);

  const seats = seatOrder(state.players, playerId);
  const [, leftId, topId, rightId] = seats;
  const playerMap = Object.fromEntries(state.players.map((p) => [p.playerId, p]));

  const order = state.players.map((p) => p.playerId);
  const curIdx = order.indexOf(state.currentPlayerId);
  const prevPlayerId = order[(curIdx - 1 + order.length) % order.length]!;
  const prevTop = topOfPile(state.discardPiles?.[prevPlayerId]);

  const tableMelds = state.tableMelds ?? [];
  const penalties = state.penalties ?? [];

  // Local slot map: slotIndex → tileId (supports gaps / free placement)
  const [slots, setSlots] = useState<(string | null)[]>(() =>
    Array(GRID_SLOTS).fill(null) as (string | null)[]
  );

  // Reconcile slots whenever the server hand changes
  useEffect(() => {
    setSlots((prev) => {
      const handIds = new Set(state.yourHand.map((t) => t.id));
      const usedIds = new Set<string>();

      // Keep tiles that still exist in their current slot
      const next = prev.map((id) => {
        if (id && handIds.has(id)) {
          usedIds.add(id);
          return id;
        }
        return null; // tile removed from hand
      });

      // Place new tiles into first available empty slots
      for (const t of state.yourHand) {
        if (!usedIds.has(t.id)) {
          const emptyIdx = next.indexOf(null);
          if (emptyIdx !== -1) {
            next[emptyIdx] = t.id;
          }
        }
      }
      return next;
    });
  }, [state.yourHand]);

  // Tile lookup by id
  const tileById = useMemo(() => {
    const map = new Map<string, Tile>();
    state.yourHand.forEach((t) => map.set(t.id, t));
    return map;
  }, [state.yourHand]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function addCurrentAsMeld() {
    if (selectedIds.length < 2) return;
    setMeldGroups((prev) => [...prev, selectedIds]);
    setSelectedIds([]);
  }
  function clearBuilder() {
    setMeldGroups([]);
    setSelectedIds([]);
  }
  function submitOpenMeld() {
    const allMelds =
      meldGroups.length > 0
        ? [...meldGroups, ...(selectedIds.length >= 3 ? [selectedIds] : [])]
        : selectedIds.length >= 3
        ? [selectedIds]
        : [];
    if (allMelds.length === 0) return alert("Build at least one meld first");
    onOpenMeld(allMelds);
    clearBuilder();
  }
  function handleDiscard() {
    if (selectedIds.length !== 1) return;
    onDiscard(selectedIds[0]!);
    setSelectedIds([]);
  }

  /* ── Grid drag-to-reorder ── */
  const handleSlotDragStart = useCallback(
    (tileId: string) => (e: React.DragEvent) => {
      dragTileId.current = tileId;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tileId);
    },
    []
  );

  const handleSlotDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleSlotDrop = useCallback(
    (targetSlotIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromId = dragTileId.current;
      if (!fromId) return;

      setSlots((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(fromId);
        if (fromIdx === -1) return prev;

        const targetId = next[targetSlotIdx];
        if (targetId && targetId !== fromId) {
          // Swap tiles
          next[fromIdx] = targetId;
          next[targetSlotIdx] = fromId;
        } else if (!targetId) {
          // Move to empty slot (leaves a gap)
          next[fromIdx] = null;
          next[targetSlotIdx] = fromId;
        }

        // Sync compacted order to server
        const ordered = next.filter((id): id is string => id !== null);
        onReorder(ordered);

        return next;
      });

      dragTileId.current = null;
    },
    [onReorder]
  );

  /* ── Seat panel for non-local players ── */
  function SeatPanel({
    pId,
    position,
  }: {
    pId: string | undefined;
    position: "left" | "top" | "right";
  }) {
    if (!pId) return null;
    const p = playerMap[pId];
    if (!p) return null;
    const count = state.otherHandCounts[pId] ?? 0;
    const isActive = state.currentPlayerId === pId;
    const discardTop = topOfPile(state.discardPiles?.[pId]);

    return (
      <div className={`seat-panel seat-${position} ${isActive ? "active" : ""}`}>
        <div className="seat-avatar">
          <div className="avatar-img">{p.name.charAt(0).toUpperCase()}</div>
          {isActive && <div className="turn-indicator" />}
        </div>
        <div className="seat-name">{p.name}</div>
        <div className="seat-count">{count}</div>
        <div className="seat-tiles">
          {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
            <div key={i} className="tile face-down mini" />
          ))}
          {count > 8 && <span className="more-tiles">+{count - 8}</span>}
        </div>
        {discardTop && (
          <div className="seat-discard">
            <TileChip tile={discardTop} disabled okey={state.okey} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="game-table">
      {/* Top player */}
      <SeatPanel pId={topId} position="top" />

      {/* Left player */}
      <SeatPanel pId={leftId} position="left" />

      {/* Right player */}
      <SeatPanel pId={rightId} position="right" />

      {/* Center table area */}
      <div className="center-area">
        <div className="center-badge">101</div>

        {/* Indicator + deck info */}
        <div className="center-info">
          <div className="indicator-area">
            <span className="label">Indicator</span>
            <TileChip tile={state.indicator} disabled okey={state.okey} />
          </div>
          <div className="deck-area">
            <div className="deck-stack">
              <div className="tile face-down" />
            </div>
            <span className="deck-count">{state.deckCount}</span>
          </div>
        </div>

        {/* Table melds */}
        {tableMelds.length > 0 && (
          <div className="table-melds">
            {tableMelds.map((m) => (
              <div
                key={m.meldId}
                className={`meld-group ${layoffTargetId === m.meldId ? "selected" : ""}`}
                onClick={() =>
                  isMyTurn
                    ? setLayoffTargetId(
                        layoffTargetId === m.meldId ? null : m.meldId
                      )
                    : undefined
                }
                title={`by ${playerMap[m.playerId]?.name ?? m.playerId}`}
              >
                {m.tiles.map((t) => (
                  <TileChip key={t.id} tile={t} disabled okey={state.okey} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom: local player area */}
      <div className="local-player">
        {/* Action bar */}
        <div className="action-bar">
          <span className="turn-label">
            {isMyTurn
              ? state.turnStep === "mustDraw"
                ? "Draw a tile"
                : "Discard a tile"
              : `${playerMap[state.currentPlayerId]?.name ?? "?"}'s turn`}
          </span>

          <div className="action-buttons">
            <button
              onClick={() => onDraw("deck")}
              disabled={!isMyTurn || state.turnStep !== "mustDraw"}
            >
              Draw
            </button>
            <button
              onClick={() => onDraw("prevDiscard")}
              disabled={!isMyTurn || state.turnStep !== "mustDraw" || !prevTop}
            >
              Take Discard
            </button>
            {isMyTurn &&
              state.turnStep === "mustDiscard" &&
              selectedIds.length === 1 && (
                <button onClick={handleDiscard} className="discard-btn">
                  Discard
                </button>
              )}
            {isMyTurn &&
              state.turnStep === "mustDraw" &&
              prevTop &&
              (selectedIds.length >= 3 || meldGroups.length > 0) && (
                <button
                  onClick={() => {
                    const ids =
                      selectedIds.length >= 3 ? [selectedIds] : meldGroups;
                    if (ids.length === 0) return;
                    onTakeAndMeld(prevPlayerId, ids);
                    clearBuilder();
                  }}
                >
                  Take &amp; Meld
                </button>
              )}
            {isMyTurn &&
              (selectedIds.length >= 3 || meldGroups.length > 0) && (
                <button onClick={submitOpenMeld} className="primary">
                  Open Meld
                </button>
              )}
            {isMyTurn && layoffTargetId && selectedIds.length > 0 && (
              <button
                onClick={() => {
                  onLayoff(layoffTargetId, selectedIds);
                  setSelectedIds([]);
                  setLayoffTargetId(null);
                }}
              >
                Layoff
              </button>
            )}
            {selectedIds.length > 0 && (
              <button onClick={addCurrentAsMeld} className="secondary">
                Group ({selectedIds.length})
              </button>
            )}
            {(selectedIds.length > 0 || meldGroups.length > 0) && (
              <button onClick={clearBuilder} className="danger">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Meld builder preview */}
        {meldGroups.length > 0 && (
          <div className="meld-preview">
            {meldGroups.map((group, i) => (
              <div key={i} className="meld-preview-group">
                <span className="meld-label">Meld {i + 1}</span>
                {group.map((id) => {
                  const t = state.yourHand.find((h) => h.id === id);
                  return t ? (
                    <TileChip key={id} tile={t} disabled okey={state.okey} />
                  ) : null;
                })}
              </div>
            ))}
          </div>
        )}

        {/* Discard pile (yours) */}
        <div className="your-discard">
          {(() => {
            const top = topOfPile(state.discardPiles?.[playerId ?? ""]);
            return top ? (
              <div className="your-discard-tile">
                <TileChip tile={top} disabled okey={state.okey} />
              </div>
            ) : null;
          })()}
        </div>

        {/* Tile rack — fixed grid */}
        <div className="tile-rack">
          <div className="rack-grid">
            {slots.map((tileId, slotIdx) => {
              const tile = tileId ? tileById.get(tileId) ?? null : null;
              return (
                <div
                  key={slotIdx}
                  className={`rack-slot ${tile ? "" : "empty"}`}
                  onDragOver={handleSlotDragOver}
                  onDrop={handleSlotDrop(slotIdx)}
                >
                  {tile && (
                    <TileChip
                      tile={tile}
                      selected={selectedIds.includes(tile.id)}
                      disabled={false}
                      onClick={() => toggle(tile.id)}
                      onDoubleClick={() => {
                        if (isMyTurn && state.turnStep === "mustDiscard")
                          onDiscard(tile.id);
                      }}
                      okey={state.okey}
                      draggable
                      onDragStart={handleSlotDragStart(tile.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Penalties overlay */}
      {penalties.length > 0 && (
        <div className="penalty-toast">
          {penalties.slice(-3).map((p, i) => (
            <div key={i} className="penalty-item">
              {playerMap[p.playerId]?.name ?? p.playerId}: +{p.points} ({p.reason ?? ""})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}