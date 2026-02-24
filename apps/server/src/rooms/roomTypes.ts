export type RoomId = string;
export type PlayerId = string;

export type LobbyPlayer = {
    playerId: PlayerId;
    name: string;
    socketId: string;
    ready: boolean;
};

export type RoomState = {
    roomId: RoomId;
    players: LobbyPlayer[];
};