export interface BudgetScopeLimits {
  gameTokens: number;
  modelTokens: number;
  seatTokens: number;
}

export interface BudgetReservationRequest {
  gameId: string;
  modelId: string;
  seatId: string;
  tokens: number;
  limits: BudgetScopeLimits;
}

export interface BudgetReservation {
  id: string;
  gameId: string;
  modelId: string;
  seatId: string;
  reservedTokens: number;
}

export interface BudgetUsage {
  settledTokens: number;
  reservedTokens: number;
}

export type BudgetScope = "game" | "model" | "seat";

export class BudgetExhaustedError extends Error {
  readonly scope: BudgetScope;

  constructor(scope: BudgetScope) {
    super(`${scope} token budget is exhausted`);
    this.name = "BudgetExhaustedError";
    this.scope = scope;
  }
}

interface MutableUsage extends BudgetUsage {}

interface ActiveReservation extends BudgetReservation {
  gameKey: string;
  modelKey: string;
  seatKey: string;
}

export class BudgetLedger {
  private readonly usage = new Map<string, MutableUsage>();
  private readonly reservations = new Map<string, ActiveReservation>();
  private nextReservationId = 1;

  reserve(request: BudgetReservationRequest): BudgetReservation {
    validateRequest(request);
    const keys = scopeKeys(request);
    const checks: Array<{
      scope: BudgetScope;
      key: string;
      limit: number;
    }> = [
      { scope: "game", key: keys.gameKey, limit: request.limits.gameTokens },
      { scope: "model", key: keys.modelKey, limit: request.limits.modelTokens },
      { scope: "seat", key: keys.seatKey, limit: request.limits.seatTokens }
    ];

    for (const check of checks) {
      const usage = this.getUsage(check.key);
      if (
        usage.settledTokens
        + usage.reservedTokens
        + request.tokens
        > check.limit
      ) {
        throw new BudgetExhaustedError(check.scope);
      }
    }

    for (const check of checks) {
      this.getUsage(check.key).reservedTokens += request.tokens;
    }

    const reservation: ActiveReservation = {
      id: `budget-${this.nextReservationId}`,
      gameId: request.gameId,
      modelId: request.modelId,
      seatId: request.seatId,
      reservedTokens: request.tokens,
      ...keys
    };
    this.nextReservationId += 1;
    this.reservations.set(reservation.id, reservation);
    return publicReservation(reservation);
  }

  settle(reservationId: string, actualTokens: number): void {
    const reservation = this.requireReservation(reservationId);
    validateTokens(actualTokens, "actualTokens", true);
    if (actualTokens > reservation.reservedTokens) {
      throw new Error("actual tokens cannot exceed reserved tokens");
    }

    for (const key of reservationKeys(reservation)) {
      const usage = this.getUsage(key);
      usage.reservedTokens -= reservation.reservedTokens;
      usage.settledTokens += actualTokens;
    }
    this.reservations.delete(reservationId);
  }

  release(reservationId: string): void {
    const reservation = this.requireReservation(reservationId);
    for (const key of reservationKeys(reservation)) {
      this.getUsage(key).reservedTokens -= reservation.reservedTokens;
    }
    this.reservations.delete(reservationId);
  }

  getGameUsage(gameId: string): BudgetUsage {
    return copyUsage(this.getUsage(`game:${gameId}`));
  }

  getModelUsage(gameId: string, modelId: string): BudgetUsage {
    return copyUsage(this.getUsage(`model:${gameId}:${modelId}`));
  }

  getSeatUsage(gameId: string, seatId: string): BudgetUsage {
    return copyUsage(this.getUsage(`seat:${gameId}:${seatId}`));
  }

  private getUsage(key: string): MutableUsage {
    let usage = this.usage.get(key);
    if (!usage) {
      usage = { settledTokens: 0, reservedTokens: 0 };
      this.usage.set(key, usage);
    }
    return usage;
  }

  private requireReservation(reservationId: string): ActiveReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`budget reservation is not active: ${reservationId}`);
    }
    return reservation;
  }
}

function scopeKeys(request: {
  gameId: string;
  modelId: string;
  seatId: string;
}): Pick<ActiveReservation, "gameKey" | "modelKey" | "seatKey"> {
  return {
    gameKey: `game:${request.gameId}`,
    modelKey: `model:${request.gameId}:${request.modelId}`,
    seatKey: `seat:${request.gameId}:${request.seatId}`
  };
}

function reservationKeys(reservation: ActiveReservation): string[] {
  return [reservation.gameKey, reservation.modelKey, reservation.seatKey];
}

function publicReservation(
  reservation: ActiveReservation
): BudgetReservation {
  return {
    id: reservation.id,
    gameId: reservation.gameId,
    modelId: reservation.modelId,
    seatId: reservation.seatId,
    reservedTokens: reservation.reservedTokens
  };
}

function copyUsage(usage: BudgetUsage): BudgetUsage {
  return { ...usage };
}

function validateRequest(request: BudgetReservationRequest): void {
  if (!request.gameId.trim() || !request.modelId.trim() || !request.seatId.trim()) {
    throw new Error("budget scope identifiers must not be empty");
  }
  validateTokens(request.tokens, "tokens");
  validateTokens(request.limits.gameTokens, "gameTokens");
  validateTokens(request.limits.modelTokens, "modelTokens");
  validateTokens(request.limits.seatTokens, "seatTokens");
}

function validateTokens(
  value: number,
  name: string,
  allowZero = false
): void {
  if (
    !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    throw new Error(`${name} must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
}
