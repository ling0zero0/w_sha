import { describe, expect, it } from "vitest";
import {
  BudgetExhaustedError,
  BudgetLedger
} from "./budget-ledger.js";

const limits = {
  gameTokens: 1_000,
  modelTokens: 700,
  seatTokens: 500
};

describe("AI budget ledger", () => {
  it("atomically reserves against game, model and seat budgets", () => {
    const ledger = new BudgetLedger();
    const first = ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 400,
      limits
    });

    expect(first).toMatchObject({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      reservedTokens: 400
    });
    expect(ledger.getGameUsage("game-1")).toEqual({
      settledTokens: 0,
      reservedTokens: 400
    });

    expect(() => ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 101,
      limits
    })).toThrow(BudgetExhaustedError);
    expect(ledger.getGameUsage("game-1").reservedTokens).toBe(400);
    expect(ledger.getModelUsage("game-1", "model-1").reservedTokens).toBe(400);
    expect(ledger.getSeatUsage("game-1", "seat-1").reservedTokens).toBe(400);
  });

  it("settles actual usage and releases unused reservations", () => {
    const ledger = new BudgetLedger();
    const settled = ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 400,
      limits
    });
    const released = ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-2",
      tokens: 200,
      limits
    });

    ledger.settle(settled.id, 275);
    ledger.release(released.id);

    expect(ledger.getGameUsage("game-1")).toEqual({
      settledTokens: 275,
      reservedTokens: 0
    });
    expect(ledger.getModelUsage("game-1", "model-1")).toEqual({
      settledTokens: 275,
      reservedTokens: 0
    });
    expect(ledger.getSeatUsage("game-1", "seat-1")).toEqual({
      settledTokens: 275,
      reservedTokens: 0
    });
  });

  it("rejects exhausted independent scopes without partial mutation", () => {
    const ledger = new BudgetLedger();
    ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 450,
      limits
    });

    expect(() => ledger.reserve({
      gameId: "game-1",
      modelId: "model-2",
      seatId: "seat-1",
      tokens: 51,
      limits
    })).toThrowError(expect.objectContaining({ scope: "seat" }));
    expect(ledger.getModelUsage("game-1", "model-2")).toEqual({
      settledTokens: 0,
      reservedTokens: 0
    });

    ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-2",
      tokens: 250,
      limits
    });
    expect(() => ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-3",
      tokens: 1,
      limits
    })).toThrowError(expect.objectContaining({ scope: "model" }));
  });

  it("rejects duplicate completion and over-settlement", () => {
    const ledger = new BudgetLedger();
    const reservation = ledger.reserve({
      gameId: "game-1",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 100,
      limits
    });

    expect(() => ledger.settle(reservation.id, 101)).toThrow(
      "actual tokens cannot exceed reserved tokens"
    );
    expect(ledger.getGameUsage("game-1").reservedTokens).toBe(100);
    ledger.settle(reservation.id, 100);
    expect(() => ledger.release(reservation.id)).toThrow(
      "budget reservation is not active"
    );
  });

  it("clears all scopes and reservations for a completed game", () => {
    const ledger = new BudgetLedger();
    const reservation = ledger.reserve({
      gameId: "game-old",
      modelId: "model-1",
      seatId: "seat-1",
      tokens: 100,
      limits
    });
    ledger.clearGame("game-old");

    expect(ledger.getGameUsage("game-old")).toEqual({ settledTokens: 0, reservedTokens: 0 });
    expect(() => ledger.settle(reservation.id, 1)).toThrow("budget reservation is not active");
  });
});
