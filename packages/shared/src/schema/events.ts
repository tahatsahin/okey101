import { z } from "zod";

// ---- client -> server ----
export const C2S = {
  roomJoin: z.object({
    roomId: z.string().min(3).max(32),
    name: z.string().min(1).max(24),
    token: z.string().min(10).optional()
  }),

  roomReady: z.object({
    ready: z.boolean()
  }),

  gameStart: z.object({}),

  moveDraw: z.object({
    source: z.enum(["deck", "prevDiscard"])
  }),

  moveDiscard: z.object({
    tileId: z.string().min(1)
  })
} as const;

// ---- server -> client ----
export const S2C = {
  gameState: z.object({
    version: z.number().int().nonnegative(),
    state: z.unknown(), // MVP: validate later with full schema
    youPlayerId: z.string().optional()
  }),

  error: z.object({
    code: z.string(),
    message: z.string().optional()
  })
} as const;

export type C2SJoin = z.infer<(typeof C2S)["roomJoin"]>;
export type C2SReady = z.infer<(typeof C2S)["roomReady"]>;
export type C2SDiscard = z.infer<(typeof C2S)["moveDiscard"]>;