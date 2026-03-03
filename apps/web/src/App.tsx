import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./App.css";
import { socket } from "./socket.ts";
import type { ServerGameStatePayload } from "./types.ts";
import type { Tile, TableMeldTile, GameOptions } from "@okey/shared";
import { findBestTileGrouping, validateMeldFromHand, validateLayoff, canExtendAnyMeld, C2S_EVENT, C2S_EXTRA_EVENT, S2C_EVENT } from "@okey/shared";

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

function buildScoreTable(
  players: { playerId: string; name: string; teamId?: "A" | "B" }[],
  history: { penalties: { playerId: string; points: number }[] }[],
  teamMode: boolean
) {
  if (history.length === 0) return null;
  if (!teamMode) {
    const roundScores = history.map((res) => {
      const totals = new Map<string, number>();
      for (const p of players) totals.set(p.playerId, 0);
      for (const pen of res.penalties) {
        totals.set(pen.playerId, (totals.get(pen.playerId) ?? 0) + pen.points);
      }
      return totals;
    });
    const totalsByPlayer = new Map<string, number>();
    for (const p of players) totalsByPlayer.set(p.playerId, 0);
    for (const round of roundScores) {
      for (const p of players) {
        totalsByPlayer.set(p.playerId, (totalsByPlayer.get(p.playerId) ?? 0) + (round.get(p.playerId) ?? 0));
      }
    }
    return {
      headers: players.map((p) => p.name),
      rows: roundScores.map((round) => players.map((p) => round.get(p.playerId) ?? 0)),
      totals: players.map((p) => totalsByPlayer.get(p.playerId) ?? 0),
      teamMode: false
    };
  }

  const teamByPlayer = new Map<string, "A" | "B">();
  players.forEach((p, idx) => {
    teamByPlayer.set(p.playerId, p.teamId ?? (idx % 2 === 0 ? "A" : "B"));
  });
  const teamIds: ("A" | "B")[] = ["A", "B"];
  const teamLabel = (id: "A" | "B") => {
    const names = players
      .filter((p, idx) => (p.teamId ?? (idx % 2 === 0 ? "A" : "B")) === id)
      .map((p) => p.name)
      .join(" & ");
    return names ? `Team ${id} (${names})` : `Team ${id}`;
  };
  const roundScores = history.map((res) => {
    const totals = new Map<"A" | "B", number>([
      ["A", 0],
      ["B", 0],
    ]);
    for (const pen of res.penalties) {
      const team = teamByPlayer.get(pen.playerId);
      if (!team) continue;
      totals.set(team, (totals.get(team) ?? 0) + pen.points);
    }
    return totals;
  });
  const totalsByTeam = new Map<"A" | "B", number>([
    ["A", 0],
    ["B", 0],
  ]);
  for (const round of roundScores) {
    for (const t of teamIds) {
      totalsByTeam.set(t, (totalsByTeam.get(t) ?? 0) + (round.get(t) ?? 0));
    }
  }
  return {
    headers: teamIds.map((t) => teamLabel(t)),
    rows: roundScores.map((round) => teamIds.map((t) => round.get(t) ?? 0)),
    totals: teamIds.map((t) => totalsByTeam.get(t) ?? 0),
    teamMode: true,
    teamLabel
  };
}

function topOfPile(pile: Tile[] | undefined): Tile | null {
  if (!pile || pile.length === 0) return null;
  return pile[pile.length - 1] ?? null;
}

function tokenKey(roomId: string) {
  return `okey101_token:${roomId}`;
}

/* ── Position helpers ─────────────────────────────────── */

/** Given the full player order and who "you" are, return [bottom, right, top, left] player ids */
function seatOrder(players: { playerId: string }[], youId: string | null): string[] {
  const ids = players
    .slice()
    .sort((a: any, b: any) => (a.seatIndex ?? 99) - (b.seatIndex ?? 99))
    .map((p) => p.playerId);
  const myIdx = ids.indexOf(youId ?? "");
  if (myIdx === -1) return ids; // fallback
  return [0, 1, 2, 3].map((offset) => ids[(myIdx + offset) % ids.length]!);
}

/* ── TileChip component ──────────────────────────────── */

function TileChip({
  tile,
  selected,
  disabled,
  hint,
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
  hint?: boolean;
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
    hint ? "hint" : "",
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<GameOptions | null>(null);

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
    socket.on(S2C_EVENT.gameState, (p: unknown) => {
      setServerState(p as ServerGameStatePayload);
    });
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(S2C_EVENT.gameState);
    };
  }, []);

  const isMyTurn = useMemo(() => {
    const s = serverState?.state;
    if (!s || s.phase !== "turn") return false;
    return s.currentPlayerId === playerId;
  }, [serverState, playerId]);

  const gs = serverState?.state;
  const defaultOptions: GameOptions = {
    teamMode: false,
    increasingMeldLimit: false,
    penaltyDiscardJoker: 101,
    penaltyDiscardExtendable: 101,
    penaltyFailedOpening: 101,
    penaltyNoOpen: 202,
    pairsMultiplier: 2
  };

  useEffect(() => {
    if (!settingsOpen) return;
    if (gs?.options) setSettingsDraft(gs.options);
  }, [settingsOpen, gs?.options]);

  useEffect(() => {
    if (!gs?.hostId) return;
    if (gs.hostId === playerId) return;
    setSettingsOpen(false);
  }, [gs?.hostId, playerId]);

  /* ── socket emitters ── */
  function join(seatIndex?: number) {
    const token = sessionStorage.getItem(tokenKey(roomId)) ?? undefined;
    if (!token && seatIndex === undefined) {
      alert("Pick a seat to join.");
      return;
    }
    socket.emit(C2S_EVENT.roomJoin, { roomId, name, token, seatIndex }, (ack: JoinAck) => {
      if (!ack.ok) return alert(`Join failed: ${ack.error}`);
      setJoined(true);
      setPlayerId(ack.playerId);
      sessionStorage.setItem(tokenKey(roomId), ack.token);
    });
  }
  function setReady(r: boolean) {
    socket.emit(C2S_EVENT.roomReady, { ready: r }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function setOptions(opts: GameOptions) {
    socket.emit(C2S_EVENT.roomSetOptions, opts, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function startGame() {
    socket.emit(C2S_EVENT.gameStart, {}, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function addBot() {
    socket.emit(C2S_EVENT.roomAddBot, {}, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function draw(source: "deck" | "prevDiscard") {
    socket.emit(C2S_EVENT.moveDraw, { source }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function discard(tileId: string) {
    socket.emit(C2S_EVENT.moveDiscard, { tileId }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function returnDiscard() {
    socket.emit(C2S_EVENT.moveReturnDiscard, {}, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function openMeld(melds: string[][]) {
    socket.emit(C2S_EXTRA_EVENT.moveOpen, { melds }, (a: SimpleAck) => {
      if (!a.ok) alert(`Open failed: ${a.error}`);
    });
  }
  function layoff(tableMeldId: string, tileIds: string[]) {
    socket.emit(C2S_EXTRA_EVENT.moveLayoff, { tableMeldId, tileIds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function takeAndMeld(fromPlayerId: string, melds: string[][]) {
    socket.emit(C2S_EXTRA_EVENT.moveTakeAndMeld, { fromPlayerId, melds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }
  function reorderHand(tileIds: string[]) {
    socket.emit(C2S_EXTRA_EVENT.moveReorder, { tileIds }, (a: SimpleAck) => {
      if (!a.ok) alert(a.error);
    });
  }

  const options = gs?.options ?? defaultOptions;

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
          />
          <div className="join-seats">
            {Array.from({ length: 4 }).map((_, idx) => (
              <button
                key={`join-seat-${idx}`}
                onClick={() => join(idx)}
                disabled={!connected || !name.trim()}
              >
                Seat {idx + 1}
              </button>
            ))}
          </div>
          <div className="join-hint">
            {connected ? "Pick a seat to join." : "Connecting…"}
          </div>
        </div>
      </div>
    );
  }

  /* ── Lobby ── */
  if (!gs || gs.phase === "lobby") {
    const teamMode = options.teamMode;
    const isHost = gs?.hostId === playerId;
    const draft = settingsDraft ?? options;
    const updateDraft = (partial: Partial<GameOptions>) =>
      setSettingsDraft((prev) => ({ ...(prev ?? options), ...partial }));
    const seats = Array.from({ length: 4 }).map((_, idx) => {
      const player = gs?.players?.find((p) => p.seatIndex === idx) ?? null;
      return { idx, player };
    });
    return (
      <div className="join-screen">
        <div className="lobby-card">
          <h2>Lobby — {roomId}</h2>
          {teamMode ? (
            <div className="lobby-teams">
              <div className="team-column">
                <div className="team-title">Team A</div>
                {[0, 2].map((idx) => {
                  const seat = seats[idx]!;
                  const p = seat.player;
                  return (
                    <div
                      key={`seat-${idx}`}
                      className={`lobby-seat ${p ? "filled" : "empty"} ${p?.ready ? "ready" : ""} ${p?.playerId === playerId ? "you" : ""}`}
                    >
                      <div className="avatar-placeholder" />
                      {p ? (
                        <>
                          <span>
                            {p.name}
                            {p.isBot ? " (bot)" : ""}
                            {p.playerId === playerId ? " (you)" : ""}
                          </span>
                          <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                            {p.ready ? "✓" : "…"}
                          </span>
                        </>
                      ) : (
                        <span>Empty Seat</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="team-column">
                <div className="team-title">Team B</div>
                {[1, 3].map((idx) => {
                  const seat = seats[idx]!;
                  const p = seat.player;
                  return (
                    <div
                      key={`seat-${idx}`}
                      className={`lobby-seat ${p ? "filled" : "empty"} ${p?.ready ? "ready" : ""} ${p?.playerId === playerId ? "you" : ""}`}
                    >
                      <div className="avatar-placeholder" />
                      {p ? (
                        <>
                          <span>
                            {p.name}
                            {p.isBot ? " (bot)" : ""}
                            {p.playerId === playerId ? " (you)" : ""}
                          </span>
                          <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                            {p.ready ? "✓" : "…"}
                          </span>
                        </>
                      ) : (
                        <span>Empty Seat</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="lobby-seats">
              {seats.map(({ idx, player: p }) => (
                <div
                  key={`seat-${idx}`}
                  className={`lobby-seat ${p ? "filled" : "empty"} ${p?.ready ? "ready" : ""} ${p?.playerId === playerId ? "you" : ""}`}
                >
                  <div className="avatar-placeholder" />
                  {p ? (
                    <>
                      <span>
                        {p.name}
                        {p.isBot ? " (bot)" : ""}
                        {p.playerId === playerId ? " (you)" : ""}
                      </span>
                      <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                        {p.ready ? "✓" : "…"}
                      </span>
                    </>
                  ) : (
                    <span>Empty Seat</span>
                  )}
                </div>
              ))}
            </div>
          )}
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
            <button onClick={() => setSettingsOpen(true)} className="secondary">
              Settings
            </button>
            <button onClick={startGame} className="primary">
              Start Game
            </button>
            {gs?.hostId === playerId && (gs?.players.length ?? 0) < 4 && (
              <button onClick={addBot} className="secondary">
                Add Bot
              </button>
            )}
          </div>
          {settingsOpen && (
            <div className="scores-overlay" onClick={() => setSettingsOpen(false)}>
              <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
                <div className="scores-header">
                  <h3>Lobby Settings</h3>
                  <button className="secondary" onClick={() => setSettingsOpen(false)}>Close</button>
                </div>
                <div className="settings-grid">
                  <label className="settings-row">
                    <span>Team mode (2v2)</span>
                    <input
                      type="checkbox"
                      checked={draft.teamMode}
                      disabled={!isHost}
                      onChange={(e) => updateDraft({ teamMode: e.target.checked })}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Increasing meld limit</span>
                    <input
                      type="checkbox"
                      checked={draft.increasingMeldLimit}
                      disabled={!isHost}
                      onChange={(e) => updateDraft({ increasingMeldLimit: e.target.checked })}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Penalty: discard joker</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.penaltyDiscardJoker}
                      disabled={!isHost}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateDraft({ penaltyDiscardJoker: v });
                      }}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Penalty: discard extendable</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.penaltyDiscardExtendable}
                      disabled={!isHost}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateDraft({ penaltyDiscardExtendable: v });
                      }}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Penalty: failed opening</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.penaltyFailedOpening}
                      disabled={!isHost}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateDraft({ penaltyFailedOpening: v });
                      }}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Penalty: no open</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.penaltyNoOpen}
                      disabled={!isHost}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateDraft({ penaltyNoOpen: v });
                      }}
                    />
                  </label>
                  <label className="settings-row">
                    <span>Pairs multiplier</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draft.pairsMultiplier}
                      disabled={!isHost}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateDraft({ pairsMultiplier: v });
                      }}
                    />
                  </label>
                </div>
                <div className="settings-actions">
                  <button
                    className="primary"
                    disabled={!isHost}
                    onClick={() => {
                      setOptions(draft);
                      setSettingsOpen(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gs.phase === "handEnd") {
    const teamMode = gs.options?.teamMode ?? false;
    const winner = gs.result.winnerId
      ? gs.players.find((p) => p.playerId === gs.result.winnerId)?.name ?? gs.result.winnerId
      : null;
    const roundNumber = gs.roundNumber ?? gs.handHistory.length;
    const maxRounds = gs.maxRounds ?? 11;
    const matchOver = gs.matchOver ?? roundNumber >= maxRounds;

    const scoreTable = buildScoreTable(gs.players, gs.handHistory, teamMode);
    const totalsByPlayer = new Map<string, number>();
    const totalsByTeam = new Map<"A" | "B", number>([
      ["A", 0],
      ["B", 0],
    ]);
    if (scoreTable && !scoreTable.teamMode) {
      gs.players.forEach((p, idx) => totalsByPlayer.set(p.playerId, scoreTable.totals[idx] ?? 0));
    }
    if (scoreTable && scoreTable.teamMode) {
      totalsByTeam.set("A", scoreTable.totals[0] ?? 0);
      totalsByTeam.set("B", scoreTable.totals[1] ?? 0);
    }
    let winners: string[] = [];
    if (matchOver) {
      if (!teamMode) {
        const min = Math.min(...gs.players.map((p) => totalsByPlayer.get(p.playerId) ?? 0));
        winners = gs.players.filter((p) => (totalsByPlayer.get(p.playerId) ?? 0) === min).map((p) => p.name);
      } else {
        const min = Math.min(...(["A", "B"] as const).map((t) => totalsByTeam.get(t) ?? 0));
        winners = (["A", "B"] as const)
          .filter((t) => (totalsByTeam.get(t) ?? 0) === min)
          .map((t) => scoreTable?.teamLabel?.(t) ?? `Team ${t}`);
      }
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

          <div className={`round-scores ${scoreTable?.teamMode ? "team-mode" : ""}`}>
            <div className="score-row score-header">
              <div>Round</div>
              {(scoreTable?.headers ?? []).map((h, idx) => (
                <div key={`hdr-${idx}`}>{h}</div>
              ))}
            </div>
            {(scoreTable?.rows ?? []).map((row, i) => (
              <div key={`round-${i}`} className="score-row">
                <div>#{i + 1}</div>
                {row.map((val, idx) => (
                  <div key={`r-${i}-${idx}`}>{val}</div>
                ))}
              </div>
            ))}
            <div className="score-row score-total">
              <div>Total</div>
              {(scoreTable?.totals ?? []).map((val, idx) => (
                <div key={`tot-${idx}`}>{val}</div>
              ))}
            </div>
          </div>

          <div className="lobby-players">
            {gs.players.map((p, idx) => {
              const teamId = teamMode ? (p.teamId ?? (idx % 2 === 0 ? "A" : "B")) : null;
              return (
              <div
                key={p.playerId}
                className={`lobby-player ${p.ready ? "ready" : ""} ${p.playerId === playerId ? "you" : ""}`}
              >
                <div className="avatar-placeholder" />
                <span>
                  {p.name}
                  {p.isBot ? " (bot)" : ""}
                  {p.playerId === playerId ? " (you)" : ""}
                  {teamId ? ` — Team ${teamId}` : ""}
                </span>
                <span className={`ready-badge ${p.ready ? "on" : ""}`}>
                  {p.ready ? "✓" : "…"}
                </span>
              </div>
              );
            })}
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
  const [showScores, setShowScores] = useState(false);
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
  const teamMode = state.options?.teamMode ?? false;
  const teamByPlayer = useMemo(() => {
    const map = new Map<string, "A" | "B">();
    state.players.forEach((p, idx) => {
      map.set(p.playerId, p.teamId ?? (idx % 2 === 0 ? "A" : "B"));
    });
    return map;
  }, [state.players]);

  const order = state.players.map((p) => p.playerId);
  const curIdx = order.indexOf(state.currentPlayerId);
  const prevPlayerId = order[(curIdx - 1 + order.length) % order.length]!;

  const tableMelds = state.tableMelds ?? [];
  const penalties = state.penalties ?? [];
  const openedMode = playerId ? (state.openedBy[playerId] ?? "none") : "none";
  const takenDiscard = state.takenDiscard;
  const takenTile = takenDiscard?.tile;
  const mustMeldDiscard = state.turnStep === "mustMeldDiscard";
  const currentOpenLimit = state.options.increasingMeldLimit ? state.openingLimit + 1 : 101;
  const noticeKey = state.notice
    ? `${state.notice.kind}:${state.notice.playerId}:${state.notice.required}:${state.notice.total}`
    : "";
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!state.notice) return;
    if (state.notice.kind === "OPENING_LIMIT") {
      const name = playerMap[state.notice.playerId]?.name ?? state.notice.playerId;
      setNoticeMessage(`${name} opening total ${state.notice.total} is below ${state.notice.required}`);
    }
    const t = setTimeout(() => setNoticeMessage(null), 4000);
    return () => clearTimeout(t);
  }, [noticeKey, playerMap, state.notice]);
  const groupedIds = useMemo(() => new Set(meldGroups.flat()), [meldGroups]);
  const visibleHand = state.yourHand.filter((t) => !groupedIds.has(t.id));
  const isPairsGrouping = meldGroups.length > 0 && meldGroups.every((g) => g.length === 2);
  const pairsCount = meldGroups.length;
  const remainingSum =
    openedMode === "pairs"
      ? state.yourHand.reduce((sum, t) => sum + tileValueForSum(t, state.okey), 0)
      : 0;

  const selectedTilesForLayoff = useMemo(() => {
    return selectedIds
      .map((id) => state.yourHand.find((t) => t.id === id))
      .filter((t): t is Tile => !!t);
  }, [selectedIds, state.yourHand]);

  const extendableIds = useMemo(() => {
    if (!isMyTurn) return new Set<string>();
    if (state.turnStep !== "mustDiscard") return new Set<string>();
    if (openedMode === "none") return new Set<string>();
    if (tableMelds.length === 0) return new Set<string>();
    const melds = tableMelds.map((m) => m.tiles as unknown as Tile[]);
    const ids = new Set<string>();
    for (const tile of state.yourHand) {
      if (canExtendAnyMeld(melds, tile, state.okey)) ids.add(tile.id);
    }
    return ids;
  }, [isMyTurn, openedMode, state.okey, state.turnStep, state.yourHand, tableMelds]);

  useEffect(() => {
    if (!handRef.current) return;
    const el = handRef.current;
    const ro = new ResizeObserver(() => {
      setHandSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scoreTable = useMemo(
    () => buildScoreTable(state.players, state.handHistory ?? [], state.options.teamMode),
    [state.handHistory, state.options.teamMode, state.players]
  );

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
  function removeMeldGroup(idx: number) {
    setMeldGroups((prev) => prev.filter((_, i) => i !== idx));
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

  function applyGrouping(groupIds: string[][], orderIds: string[]) {
    setSelectedIds([]);
    setLayoffTargetId(null);
    setMeldGroups(groupIds);
    setTilePositions((prev) => ({ ...prev, ...layoutOrder(orderIds) }));
    onReorder(orderIds);
  }

  function sortNormal() {
    const grouped = findBestTileGrouping(state.yourHand, state.okey);
    const groupIds = grouped.groups.map((group) => group.tileIds);
    const unused = grouped.unusedTileIds.slice();
    const groupedOrdered = grouped.groups.flatMap((group) => group.tileIds);
    applyGrouping(groupIds, [...unused, ...groupedOrdered]);
  }

  function sortPairs() {
    const indexed = state.yourHand.map((tile, index) => ({ tile, index }));
    const pairCandidates: { mask: number; score: number; ids: string[] }[] = [];
    for (let i = 0; i < indexed.length; i++) {
      for (let j = i + 1; j < indexed.length; j++) {
        const a = indexed[i]!.tile;
        const b = indexed[j]!.tile;
        const vr = validateMeldFromHand([a, b], state.okey);
        if (!vr.valid || vr.type !== "pair") continue;
        pairCandidates.push({
          mask: (1 << i) | (1 << j),
          score: tileValueForSum(a, state.okey) + tileValueForSum(b, state.okey),
          ids: [a.id, b.id]
        });
      }
    }

    const fullMask = (1 << indexed.length) - 1;
    const memo = new Map<number, { pairCount: number; score: number; masks: number[] }>();
    const byMask = new Map(pairCandidates.map((candidate) => [candidate.mask, candidate]));

    function betterPairState(
      a: { pairCount: number; score: number; masks: number[] },
      b: { pairCount: number; score: number; masks: number[] }
    ) {
      if (a.pairCount !== b.pairCount) return a.pairCount - b.pairCount;
      if (a.score !== b.score) return a.score - b.score;
      return b.masks.length - a.masks.length;
    }

    function solvePairs(mask: number): { pairCount: number; score: number; masks: number[] } {
      const cached = memo.get(mask);
      if (cached) return cached;
      let first = -1;
      for (let i = 0; i < indexed.length; i++) {
        if ((mask & (1 << i)) !== 0) {
          first = i;
          break;
        }
      }
      if (first === -1) {
        const base = { pairCount: 0, score: 0, masks: [] };
        memo.set(mask, base);
        return base;
      }

      let best = solvePairs(mask & ~(1 << first));
      for (const candidate of pairCandidates) {
        if ((candidate.mask & (1 << first)) === 0) continue;
        if ((candidate.mask & mask) !== candidate.mask) continue;
        const tail = solvePairs(mask & ~candidate.mask);
        const next = {
          pairCount: tail.pairCount + 1,
          score: tail.score + candidate.score,
          masks: [candidate.mask, ...tail.masks]
        };
        if (betterPairState(next, best) > 0) best = next;
      }

      memo.set(mask, best);
      return best;
    }

    const pairSolve = solvePairs(fullMask);
    const pairMasks = pairSolve.masks;
    const usedMask = pairMasks.reduce((acc, mask) => acc | mask, 0);
    const groupIds = pairMasks.map((mask) => byMask.get(mask)!.ids);
    const unused = indexed.filter((_, index) => (usedMask & (1 << index)) === 0).map(({ tile }) => tile.id);
    const groupedOrdered = groupIds.flat();
    applyGrouping(groupIds, [...unused, ...groupedOrdered]);
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
    const teamId = teamMode ? teamByPlayer.get(pId) : null;
    return (
      <div className={`seat-panel seat-${position} ${isActive ? "active" : ""}`}>
        <div className="seat-avatar">
          <div className="avatar-img">{p.name.charAt(0).toUpperCase()}</div>
          {isActive && <div className="turn-indicator" />}
        </div>
        <div className="seat-name">{p.name}</div>
        {teamId && <div className="seat-team">Team {teamId}</div>}
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
      <button className="scores-button" onClick={() => setShowScores(true)}>
        Scores
      </button>
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
          {state.options.increasingMeldLimit && (
            <div className="open-limit">
              <span className="label">Opening limit</span>
              <span className="limit-value">{currentOpenLimit}</span>
            </div>
          )}
        </div>

        {/* Table melds */}
        {tableMelds.length > 0 && (
          <div className="table-melds">
            {tableMelds.map((m) => {
              const canLayoffHere =
                isMyTurn &&
                state.turnStep === "mustDiscard" &&
                openedMode !== "none" &&
                selectedTilesForLayoff.length > 0 &&
                validateLayoff(m.tiles as unknown as Tile[], selectedTilesForLayoff, state.okey).ok;
              return (
                <div
                  key={m.meldId}
                  className={`meld-group ${canLayoffHere ? "legal" : ""} ${layoffTargetId === m.meldId ? "selected" : ""}`}
                  onClick={() =>
                    isMyTurn
                      ? setLayoffTargetId(
                          layoffTargetId === m.meldId ? null : m.meldId
                        )
                      : undefined
                  }
                  title={`by ${playerMap[m.playerId]?.name ?? m.playerId}`}
                >
                  <div className="meld-owner">{playerMap[m.playerId]?.name ?? m.playerId}</div>
                  <div className="meld-tiles">
                    {m.tiles.map((t) => (
                      <TileChip key={t.id} tile={t} disabled okey={state.okey} />
                    ))}
                  </div>
                </div>
              );
            })}
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
              <div
                key={i}
                className="meld-preview-group"
                onClick={() => removeMeldGroup(i)}
                title="Click to remove this group"
              >
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
                  hint={extendableIds.has(tile.id)}
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
            const teamMode = state.options?.teamMode ?? false;
            if (!teamMode) {
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
            }

            const teamByPlayer = new Map<string, "A" | "B">();
            state.players.forEach((p, idx) => {
              teamByPlayer.set(p.playerId, p.teamId ?? (idx % 2 === 0 ? "A" : "B"));
            });
            const totals = new Map<"A" | "B", number>([
              ["A", 0],
              ["B", 0],
            ]);
            for (const pen of penalties) {
              const team = teamByPlayer.get(pen.playerId);
              if (!team) continue;
              totals.set(team, (totals.get(team) ?? 0) + pen.points);
            }
            const teamLabel = (id: "A" | "B") => {
              const names = state.players
                .filter((p, idx) => (p.teamId ?? (idx % 2 === 0 ? "A" : "B")) === id)
                .map((p) => p.name)
                .join(" & ");
              return names ? `Team ${id} (${names})` : `Team ${id}`;
            };
            return (["A", "B"] as const).map((t) => (
              <div key={t} className="penalty-item">
                {teamLabel(t)}: {totals.get(t) ?? 0} pts
              </div>
            ));
          })()}
        </div>
      )}
      {noticeMessage && (
        <div className="notice-toast">
          {noticeMessage}
        </div>
      )}
      {showScores && (
        <div className="scores-overlay" onClick={() => setShowScores(false)}>
          <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scores-header">
              <h3>Scores</h3>
              <button className="secondary" onClick={() => setShowScores(false)}>Close</button>
            </div>
            {scoreTable ? (
              <div className={`round-scores ${scoreTable.teamMode ? "team-mode" : ""}`}>
                <div className="score-row score-header">
                  <div>Round</div>
                  {scoreTable.headers.map((h, idx) => (
                    <div key={`hdr-${idx}`}>{h}</div>
                  ))}
                </div>
                {scoreTable.rows.map((row, i) => (
                  <div key={`round-${i}`} className="score-row">
                    <div>#{i + 1}</div>
                    {row.map((val, idx) => (
                      <div key={`r-${i}-${idx}`}>{val}</div>
                    ))}
                  </div>
                ))}
                <div className="score-row score-total">
                  <div>Total</div>
                  {scoreTable.totals.map((val, idx) => (
                    <div key={`tot-${idx}`}>{val}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="scores-empty">No completed rounds yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
