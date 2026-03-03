import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import { socket } from "./socket.ts";
import type { ServerGameStatePayload } from "./types.ts";
import type { Tile, TableMeldTile } from "@okey/shared";

type JoinAck =
  | { ok: true; playerId: string; roomId: string; token: string }
  | { ok: false; error: string };

type SimpleAck = { ok: true } | { ok: false; error: string };

/* ── Tile helpers ─────────────────────────────────────── */

function tileColorClass(t: Tile | TableMeldTile): string {
  const assigned = (t as TableMeldTile).assigned;
  if (assigned) return `color-${assigned.color}`;
  if (t.kind === "fakeJoker") return "fake-joker";
  return `color-${t.color}`;
}

function tileLabel(t: Tile | TableMeldTile): string {
  const assigned = (t as TableMeldTile).assigned;
  if (assigned) return String(assigned.value);
  if (t.kind === "fakeJoker") return "⭐";
  return String(t.value);
}

function isOkeyTile(t: Tile, okey: { color: string; value: number }): boolean {
  return t.kind === "normal" && t.color === okey.color && t.value === okey.value;
}

function tileValueForSum(t: Tile, okey: { color: string; value: number }): number {
  if (t.kind === "fakeJoker") return okey.value;
  return t.value;
}

function topOfPile(pile: Tile[] | undefined): Tile | null {
  if (!pile || pile.length === 0) return null;
  return pile[pile.length - 1] ?? null;
}

function tokenKey(roomId: string) {
  return `okey101_token:${roomId}`;
}

const COLOR_ORDER = ["red", "black", "blue", "yellow"] as const;

function sortKeyForTile(t: Tile, okey: { color: string; value: number }) {
  const resolved =
    t.kind === "fakeJoker"
      ? { color: okey.color, value: okey.value }
      : { color: t.color, value: t.value };
  return {
    colorIndex: COLOR_ORDER.indexOf(resolved.color as (typeof COLOR_ORDER)[number]),
    value: resolved.value
  };
}

/* ── Position helpers ─────────────────────────────────── */

/** Given the full player order and who "you" are, return [bottom, right, top, left] player ids */
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
  tile?: Tile | TableMeldTile;
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
  const [showSortButtons, setShowSortButtons] = useState<boolean>(() => {
    const v = localStorage.getItem("okey101:showSortButtons");
    return v !== "false";
  });

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
  function addBot() {
    socket.emit("room:addBot", {}, (a: SimpleAck) => {
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
  function returnDiscard() {
    socket.emit("move:returnDiscard", {}, (a: SimpleAck) => {
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
                <span>
                  {p.name}
                  {p.isBot ? " (bot)" : ""}
                  {p.playerId === playerId ? " (you)" : ""}
                </span>
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
          <label className="lobby-toggle">
            <input
              type="checkbox"
              checked={showSortButtons}
              onChange={(e) => {
                const v = e.target.checked;
                setShowSortButtons(v);
                localStorage.setItem("okey101:showSortButtons", String(v));
              }}
            />
            Show sort buttons
          </label>
          <div className="lobby-actions">
            <button onClick={() => setReady(true)}>Ready</button>
            <button onClick={() => setReady(false)} className="secondary">
              Not Ready
            </button>
            <button onClick={startGame} className="primary">
              Start Game
            </button>
            {gs?.players?.[0]?.playerId === playerId && (gs?.players.length ?? 0) < 4 && (
              <button onClick={addBot} className="secondary">
                Add Bot
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (gs.phase === "handEnd") {
    const winner = gs.result.winnerId
      ? gs.players.find((p) => p.playerId === gs.result.winnerId)?.name ?? gs.result.winnerId
      : null;
    const roundNumber = gs.roundNumber ?? gs.handHistory.length;
    const maxRounds = gs.maxRounds ?? 11;
    const matchOver = gs.matchOver ?? roundNumber >= maxRounds;

    const roundScores = gs.handHistory.map((res) => {
      const totals = new Map<string, number>();
      for (const p of gs.players) totals.set(p.playerId, 0);
      for (const pen of res.penalties) {
        totals.set(pen.playerId, (totals.get(pen.playerId) ?? 0) + pen.points);
      }
      return totals;
    });
    const totalsByPlayer = new Map<string, number>();
    for (const p of gs.players) totalsByPlayer.set(p.playerId, 0);
    for (const round of roundScores) {
      for (const p of gs.players) {
        totalsByPlayer.set(p.playerId, (totalsByPlayer.get(p.playerId) ?? 0) + (round.get(p.playerId) ?? 0));
      }
    }
    let winners: string[] = [];
    if (matchOver) {
      const min = Math.min(...gs.players.map((p) => totalsByPlayer.get(p.playerId) ?? 0));
      winners = gs.players.filter((p) => (totalsByPlayer.get(p.playerId) ?? 0) === min).map((p) => p.name);
    }
    return (
      <div className="join-screen">
        <div className="lobby-card">
          <h2>{matchOver ? "Match Complete" : "Hand Ended"}</h2>
          <div className="hand-end-summary">
            <div>Round: {roundNumber} / {maxRounds}</div>
            <div>Reason: {gs.result.reason}</div>
            {winner && <div>Winner: {winner}</div>}
            <div>Dealer: {gs.players[gs.dealerIndex]?.name ?? gs.dealerIndex}</div>
            {matchOver && winners.length > 0 && (
              <div>Overall Winner: {winners.join(", ")}</div>
            )}
          </div>

          <div className="round-scores">
            <div className="score-row score-header">
              <div>Round</div>
              {gs.players.map((p) => (
                <div key={p.playerId}>{p.name}</div>
              ))}
            </div>
            {roundScores.map((round, i) => (
              <div key={`round-${i}`} className="score-row">
                <div>#{i + 1}</div>
                {gs.players.map((p) => (
                  <div key={p.playerId}>{round.get(p.playerId) ?? 0}</div>
                ))}
              </div>
            ))}
            <div className="score-row score-total">
              <div>Total</div>
              {gs.players.map((p) => (
                <div key={p.playerId}>{totalsByPlayer.get(p.playerId) ?? 0}</div>
              ))}
            </div>
          </div>

          <div className="lobby-players">
            {gs.players.map((p) => (
              <div
                key={p.playerId}
                className={`lobby-player ${p.ready ? "ready" : ""} ${p.playerId === playerId ? "you" : ""}`}
              >
                <div className="avatar-placeholder" />
                <span>
                  {p.name}
                  {p.isBot ? " (bot)" : ""}
                  {p.playerId === playerId ? " (you)" : ""}
                </span>
                <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                  {p.ready ? "✓" : "…"}
                </span>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <button onClick={() => setReady(true)}>Ready</button>
            <button onClick={() => setReady(false)} className="secondary">
              Not Ready
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
      showSortButtons={showSortButtons}
      onDraw={draw}
      onDiscard={discard}
      onReturnDiscard={returnDiscard}
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
  showSortButtons,
  onDraw,
  onDiscard,
  onReturnDiscard,
  onOpenMeld,
  onLayoff,
  onTakeAndMeld,
  onReorder,
}: {
  state: TurnState;
  playerId: string | null;
  isMyTurn: boolean;
  showSortButtons: boolean;
  onDraw: (source: "deck" | "prevDiscard") => void;
  onDiscard: (tileId: string) => void;
  onReturnDiscard: () => void;
  onOpenMeld: (melds: string[][]) => void;
  onLayoff: (tableMeldId: string, tileIds: string[]) => void;
  onTakeAndMeld: (fromPlayerId: string, melds: string[][]) => void;
  onReorder: (tileIds: string[]) => void;
}) {
  const TILE_W = 42;
  const TILE_H = 58;
  const TILE_GAP = 6;
  const ROW_GAP = 12;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [meldGroups, setMeldGroups] = useState<string[][]>([]);
  const [layoffTargetId, setLayoffTargetId] = useState<string | null>(null);
  const dragState = useRef<{
    type: "hand" | "deck" | "discard";
    tileId?: string;
    fromPlayerId?: string;
    offsetX?: number;
    offsetY?: number;
  } | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
  const [handSize, setHandSize] = useState({ w: 900, h: 200 });
  const [tilePositions, setTilePositions] = useState<Record<string, { x: number; y: number }>>({});
  const pendingDropPos = useRef<{ x: number; y: number } | null>(null);
  const prevHandIdsRef = useRef<Set<string>>(new Set());

  const seats = seatOrder(state.players, playerId);
  const [bottomId, rightId, topId, leftId] = seats;
  const playerMap = Object.fromEntries(state.players.map((p) => [p.playerId, p]));

  const order = state.players.map((p) => p.playerId);
  const curIdx = order.indexOf(state.currentPlayerId);
  const prevPlayerId = order[(curIdx - 1 + order.length) % order.length]!;

  const tableMelds = state.tableMelds ?? [];
  const penalties = state.penalties ?? [];
  const openedMode = playerId ? (state.openedBy[playerId] ?? "none") : "none";
  const takenDiscard = state.takenDiscard;
  const takenTile = takenDiscard?.tile;
  const mustMeldDiscard = state.turnStep === "mustMeldDiscard";
  const groupedIds = useMemo(() => new Set(meldGroups.flat()), [meldGroups]);
  const visibleHand = state.yourHand.filter((t) => !groupedIds.has(t.id));
  const isPairsGrouping = meldGroups.length > 0 && meldGroups.every((g) => g.length === 2);
  const pairsCount = meldGroups.length;
  const remainingSum =
    openedMode === "pairs"
      ? state.yourHand.reduce((sum, t) => sum + tileValueForSum(t, state.okey), 0)
      : 0;

  useEffect(() => {
    if (!handRef.current) return;
    const el = handRef.current;
    const ro = new ResizeObserver(() => {
      setHandSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function rectsOverlap(a: { x: number; y: number }, b: { x: number; y: number }) {
    return (
      a.x < b.x + TILE_W &&
      a.x + TILE_W > b.x &&
      a.y < b.y + TILE_H &&
      a.y + TILE_H > b.y
    );
  }

  function findFreeSpot(existing: Record<string, { x: number; y: number }>, excludeIds?: Set<string>) {
    const maxX = Math.max(0, handSize.w - TILE_W);
    const rows = [0, TILE_H + ROW_GAP];
    for (const y of rows) {
      for (let x = 0; x <= maxX; x += TILE_W + TILE_GAP) {
        const pos = { x, y };
        const overlap = Object.entries(existing).some(([id, p]) => {
          if (excludeIds?.has(id)) return false;
          return rectsOverlap(pos, p);
        });
        if (!overlap) return pos;
      }
    }
    return { x: 0, y: 0 };
  }

  // Reconcile positions whenever the server hand changes
  useEffect(() => {
    setTilePositions((prev) => {
      const handIds = new Set(state.yourHand.map((t) => t.id));
      const next: Record<string, { x: number; y: number }> = {};
      for (const id of Object.keys(prev)) {
        if (handIds.has(id)) next[id] = prev[id]!;
      }
      const prevIds = prevHandIdsRef.current;
      const newIds = state.yourHand.filter((t) => !prevIds.has(t.id)).map((t) => t.id);
      for (const t of state.yourHand) {
        if (next[t.id]) continue;
        if (newIds.length === 1 && pendingDropPos.current && t.id === newIds[0]) {
          const pos = pendingDropPos.current;
          pendingDropPos.current = null;
          const overlap = Object.entries(next).some(([id, p]) => {
            if (groupedIds.has(id)) return false;
            return rectsOverlap(pos, p);
          });
          next[t.id] = overlap ? findFreeSpot(next, groupedIds) : pos;
        } else {
          next[t.id] = findFreeSpot(next, groupedIds);
        }
      }
      prevHandIdsRef.current = new Set(state.yourHand.map((t) => t.id));
      return next;
    });
  }, [state.yourHand, handSize.w, handSize.h, groupedIds]);

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter(
        (id) =>
          state.yourHand.some((t) => t.id === id) || (takenTile && takenTile.id === id)
      )
    );
  }, [state.yourHand, takenTile]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function tileById(id: string): Tile | undefined {
    if (takenTile?.id === id) return takenTile;
    return state.yourHand.find((h) => h.id === id);
  }
  function groupTotal(ids: string[]): number {
    return ids.reduce((sum, id) => {
      const t = tileById(id);
      return t ? sum + tileValueForSum(t, state.okey) : sum;
    }, 0);
  }
  const groupsTotal = meldGroups.reduce((sum, group) => sum + groupTotal(group), 0);
  function addCurrentAsMeld() {
    if (selectedIds.length < 2) return;
    setMeldGroups((prev) => [...prev, selectedIds]);
    setSelectedIds([]);
  }
  function clearBuilder() {
    const returningIds = meldGroups.flat();
    setMeldGroups([]);
    setSelectedIds([]);
    if (returningIds.length > 0) {
      setTilePositions((prev) => {
        const next = { ...prev };
        for (const id of returningIds) {
          const pos = next[id];
          if (!pos) continue;
          const overlap = Object.entries(next).some(([otherId, p]) => {
            if (otherId === id) return false;
            return rectsOverlap(pos, p);
          });
          if (overlap) {
            next[id] = findFreeSpot(next);
          }
        }
        return next;
      });
    }
  }
  function handleReturnDiscard() {
    onReturnDiscard();
    clearBuilder();
  }

  function resolvedKey(t: Tile) {
    if (t.kind === "fakeJoker") return { color: state.okey.color, value: state.okey.value };
    return { color: t.color, value: t.value };
  }

  function layoutOrder(orderIds: string[]) {
    const perRow = Math.max(1, Math.floor((handSize.w + TILE_GAP) / (TILE_W + TILE_GAP)));
    const next: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < orderIds.length; i++) {
      const id = orderIds[i]!;
      const row = Math.min(1, Math.floor(i / perRow));
      const col = i % perRow;
      const x = col * (TILE_W + TILE_GAP);
      const y = row === 0 ? 0 : TILE_H + ROW_GAP;
      next[id] = { x, y };
    }
    return next;
  }

  function applyOrder(orderIds: string[]) {
    clearBuilder();
    setTilePositions((prev) => ({ ...prev, ...layoutOrder(orderIds) }));
    onReorder(orderIds);
  }

  function sortNormal() {
    const ordered = [...state.yourHand]
      .sort((a, b) => {
        const ka = sortKeyForTile(a, state.okey);
        const kb = sortKeyForTile(b, state.okey);
        if (ka.colorIndex !== kb.colorIndex) return ka.colorIndex - kb.colorIndex;
        if (ka.value !== kb.value) return ka.value - kb.value;
        if (a.kind !== b.kind) return a.kind === "fakeJoker" ? 1 : -1;
        return a.id.localeCompare(b.id);
      })
      .map((t) => t.id);
    applyOrder(ordered);
  }

  function sortPairs() {
    const groups = new Map<string, Tile[]>();
    for (const t of state.yourHand) {
      const r = resolvedKey(t);
      const key = `${r.color}-${r.value}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    const orderedGroups = [...groups.entries()].sort(([ka, va], [kb, vb]) => {
      const countDiff = vb.length - va.length;
      if (countDiff !== 0) return countDiff;
      const [ca, vaStr] = ka.split("-");
      const [cb, vbStr] = kb.split("-");
      const aColor = COLOR_ORDER.indexOf(ca as (typeof COLOR_ORDER)[number]);
      const bColor = COLOR_ORDER.indexOf(cb as (typeof COLOR_ORDER)[number]);
      if (aColor !== bColor) return aColor - bColor;
      return Number(vaStr) - Number(vbStr);
    });
    const ordered = orderedGroups.flatMap(([, tiles]) =>
      tiles.sort((a, b) => a.id.localeCompare(b.id)).map((t) => t.id)
    );
    applyOrder(ordered);
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
    clearBuilder();
  }

  /* ── Drag & Drop ── */
  const handleHandTileDragStart = useCallback(
    (tileId: string) => (e: React.DragEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragState.current = {
        type: "hand",
        tileId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
      };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tileId);
    },
    []
  );

  const handleDeckDragStart = useCallback((e: React.DragEvent) => {
    dragState.current = { type: "deck" };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", "deck");
  }, []);

  const handleDiscardDragStart = useCallback(
    (tileId: string, fromPlayerId: string) => (e: React.DragEvent) => {
      dragState.current = { type: "discard", tileId, fromPlayerId };
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", tileId);
    },
    []
  );

  const handleHandDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const ds = dragState.current;
    e.dataTransfer.dropEffect = ds?.type === "deck" || ds?.type === "discard" ? "copy" : "move";
  }, []);

  const handleHandDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const ds = dragState.current;
      if (!ds) return;

      if (ds.type === "deck") {
        if (isMyTurn && state.turnStep === "mustDraw" && handRef.current) {
          const rect = handRef.current.getBoundingClientRect();
          const rawX = e.clientX - rect.left - TILE_W / 2;
          const rawY = e.clientY - rect.top - TILE_H / 2;
          const x = Math.min(Math.max(0, rawX), Math.max(0, handSize.w - TILE_W));
          const rowTop = 0;
          const rowBottom = TILE_H + ROW_GAP;
          const distTop = Math.abs(rawY - rowTop);
          const distBottom = Math.abs(rawY - rowBottom);
          const y = distTop <= distBottom ? rowTop : rowBottom;
          pendingDropPos.current = { x, y };
          onDraw("deck");
        }
        dragState.current = null;
        return;
      }

      if (ds.type === "discard") {
        if (!isMyTurn || state.turnStep !== "mustDraw" || !ds.tileId || !ds.fromPlayerId) return;
        onDraw("prevDiscard");
        dragState.current = null;
        return;
      }

      if (ds.type === "hand" && ds.tileId && handRef.current) {
        const rect = handRef.current.getBoundingClientRect();
        const rawX = e.clientX - rect.left - (ds.offsetX ?? TILE_W / 2);
        const rawY = e.clientY - rect.top - (ds.offsetY ?? TILE_H / 2);
        const x = Math.min(Math.max(0, rawX), Math.max(0, handSize.w - TILE_W));
        const rowTop = 0;
        const rowBottom = TILE_H + ROW_GAP;
        const distTop = Math.abs(rawY - rowTop);
        const distBottom = Math.abs(rawY - rowBottom);
        const y = distTop <= distBottom ? rowTop : rowBottom;
        setTilePositions((prev) => {
          const next = { ...prev, [ds.tileId!]: { x, y } };
          const overlap = Object.entries(next).some(([id, pos]) => {
            if (id === ds.tileId) return false;
            if (groupedIds.has(id)) return false;
            return rectsOverlap(next[ds.tileId!], pos);
          });
          if (overlap) return prev;
          return next;
        });
        const ordered = state.yourHand
          .map((t) => t.id)
          .sort((a, b) => {
            const pa = a === ds.tileId ? { x, y } : tilePositions[a] ?? { x: 0, y: 0 };
            const pb = b === ds.tileId ? { x, y } : tilePositions[b] ?? { x: 0, y: 0 };
            if (pa.y === pb.y) return pa.x - pb.x;
            return pa.y - pb.y;
          });
        onReorder(ordered);
      }
      dragState.current = null;
    },
    [groupedIds, handSize.h, handSize.w, isMyTurn, onDraw, onReorder, rectsOverlap, state.turnStep, state.yourHand, tilePositions]
  );

  const handleDiscardDrop = useCallback(
    (targetOwnerId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const ds = dragState.current;
      if (!ds || ds.type !== "hand" || !ds.tileId) return;
      if (!isMyTurn || state.turnStep !== "mustDiscard") return;
      if (targetOwnerId !== playerId) return;
      onDiscard(ds.tileId);
      setSelectedIds((prev) => prev.filter((id) => id !== ds.tileId));
      dragState.current = null;
    },
    [isMyTurn, onDiscard, playerId, state.turnStep]
  );

  const handleDiscardDragOver = useCallback(
    (allow: boolean) => (e: React.DragEvent) => {
      if (!allow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const seatIds = {
    bottom: bottomId,
    right: rightId,
    top: topId,
    left: leftId,
  };

  const discardZones = [
    { id: "bottom-right", ownerId: seatIds.bottom },
    { id: "top-right", ownerId: seatIds.right },
    { id: "top-left", ownerId: seatIds.top },
    { id: "bottom-left", ownerId: seatIds.left },
  ];

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
            <div
              className="deck-stack"
              draggable={isMyTurn && state.turnStep === "mustDraw"}
              onDragStart={handleDeckDragStart}
            >
              <div
                className="tile face-down"
                draggable={isMyTurn && state.turnStep === "mustDraw"}
                onDragStart={handleDeckDragStart}
              />
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

      {/* Discard piles between seats */}
      <div className="discard-ring">
        {discardZones.map((z) => {
          const top = topOfPile(state.discardPiles?.[z.ownerId ?? ""]);
          const isPrev = z.ownerId === prevPlayerId;
          const showReturn =
            isMyTurn &&
            mustMeldDiscard &&
            takenDiscard?.fromPlayerId === z.ownerId;
          const canTake =
            !!top && isMyTurn && state.turnStep === "mustDraw" && isPrev;
          const canDiscardHere = isMyTurn && state.turnStep === "mustDiscard" && z.ownerId === playerId;
          return (
            <div
              key={z.id}
              className={`discard-pile discard-${z.id} ${canDiscardHere ? "active-drop" : ""}`}
              onDragOver={handleDiscardDragOver(canDiscardHere)}
              onDrop={handleDiscardDrop(z.ownerId ?? "")}
            >
              {showReturn ? (
                <button className="return-tile-btn" onClick={handleReturnDiscard}>
                  Return tile
                </button>
              ) : top ? (
                <TileChip
                  tile={top}
                  disabled={!canTake}
                  okey={state.okey}
                  draggable={canTake}
                  onDragStart={canTake ? handleDiscardDragStart(top.id, z.ownerId ?? "") : undefined}
                />
              ) : (
                <div className="discard-empty">Discard</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom: local player area */}
      <div className="local-player">
        {/* Action bar */}
        <div className="action-bar">
          <span className="turn-label">
            {isMyTurn
              ? state.turnStep === "mustDraw"
                ? "Draw a tile"
                : state.turnStep === "mustMeldDiscard"
                ? "Meld with taken discard or return it"
                : "Discard a tile"
              : `${playerMap[state.currentPlayerId]?.name ?? "?"}'s turn`}
          </span>
          <span className="open-status">
            Open: {openedMode === "none" ? "Not opened" : openedMode === "pairs" ? "Pairs" : "Runs/Sets"}
          </span>
          {openedMode === "pairs" && (
            <span className="open-status">Remaining: {remainingSum}</span>
          )}
          <span className="open-status">
            Dealer: {state.players[state.dealerIndex]?.name ?? state.dealerIndex}
          </span>

          <div className="action-buttons">
            <button
              onClick={() => onDraw("deck")}
              disabled={!isMyTurn || state.turnStep !== "mustDraw"}
            >
              Draw
            </button>
            {showSortButtons && (
              <>
                <button onClick={sortNormal} className="secondary">
                  Sort
                </button>
                <button onClick={sortPairs} className="secondary">
                  Sort Pairs
                </button>
              </>
            )}
            {isMyTurn &&
              state.turnStep === "mustDiscard" &&
              selectedIds.length === 1 && (
                <button onClick={handleDiscard} className="discard-btn">
                  Discard
                </button>
              )}
            {isMyTurn &&
              state.turnStep === "mustMeldDiscard" &&
              takenDiscard &&
              (selectedIds.length >= 3 || meldGroups.length > 0) && (
                <button
                  onClick={() => {
                    const ids =
                      meldGroups.length > 0
                        ? meldGroups
                        : selectedIds.length >= 3
                        ? [selectedIds]
                        : [];
                    if (ids.length === 0) return;
                    const includesTaken = ids.some((m) => m.includes(takenDiscard.tile.id));
                    if (!includesTaken) return alert("Include the taken tile in your meld.");
                    onTakeAndMeld(takenDiscard.fromPlayerId, ids);
                    clearBuilder();
                  }}
                >
                  Meld Taken
                </button>
              )}
            {isMyTurn &&
              state.turnStep === "mustDiscard" &&
              (selectedIds.length >= 3 || meldGroups.length > 0) && (
                <button onClick={submitOpenMeld} className="primary">
                  Open Meld
                </button>
              )}
            {isMyTurn &&
              state.turnStep === "mustDiscard" &&
              layoffTargetId &&
              selectedIds.length > 0 && (
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

        {takenTile && isMyTurn && state.turnStep === "mustMeldDiscard" && (
          <div className="taken-tile-panel">
            <span className="taken-label">Taken tile</span>
            <TileChip
              tile={takenTile}
              selected={selectedIds.includes(takenTile.id)}
              disabled={false}
              onClick={() => toggle(takenTile.id)}
              okey={state.okey}
            />
          </div>
        )}

        {/* Meld builder preview */}
        {meldGroups.length > 0 && (
          <div className="meld-preview">
            <div className="meld-total">
              {isPairsGrouping ? `${pairsCount} Pairs, 5 needed` : `Total: ${groupsTotal}`}
            </div>
            {meldGroups.map((group, i) => (
              <div key={i} className="meld-preview-group">
                <span className="meld-label">
                  {isPairsGrouping ? `Pair ${i + 1}` : `Meld ${i + 1} · ${groupTotal(group)}`}
                </span>
                {group.map((id) => {
                  const t = tileById(id);
                  return t ? (
                    <TileChip key={id} tile={t} disabled okey={state.okey} />
                  ) : null;
                })}
              </div>
            ))}
          </div>
        )}

        {/* Free-form hand area */}
        <div
          className="hand-area"
          ref={handRef}
          onDragOver={handleHandDragOver}
          onDrop={handleHandDrop}
        >
          {visibleHand.map((tile) => {
            const pos = tilePositions[tile.id] ?? { x: 0, y: 0 };
            return (
              <div
                key={tile.id}
                className="hand-tile"
                style={{ left: pos.x, top: pos.y }}
              >
                <TileChip
                  tile={tile}
                  selected={selectedIds.includes(tile.id)}
                  disabled={false}
                  onClick={() => toggle(tile.id)}
                  onDoubleClick={() => {
                    if (isMyTurn && state.turnStep === "mustDiscard") {
                      onDiscard(tile.id);
                      clearBuilder();
                    }
                  }}
                  okey={state.okey}
                  draggable
                  onDragStart={handleHandTileDragStart(tile.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Penalties overlay */}
      {penalties.length > 0 && (
        <div className="penalty-toast">
          {(() => {
            const totals = new Map<string, number>();
            for (const p of state.players) totals.set(p.playerId, 0);
            for (const pen of penalties) {
              totals.set(pen.playerId, (totals.get(pen.playerId) ?? 0) + pen.points);
            }
            return state.players.map((p) => (
              <div key={p.playerId} className="penalty-item">
                {p.name}: {totals.get(p.playerId) ?? 0} pts
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
