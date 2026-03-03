export type RoomId = string;
export type PlayerId = string;

export type LobbyPlayer = {
    playerId: PlayerId;
    name: string;
    socketId: string;
    ready: boolean;
    isBot?: boolean;
    teamId?: "A" | "B";
};

export type RoomState = {
    roomId: RoomId;
    players: LobbyPlayer[];
};
