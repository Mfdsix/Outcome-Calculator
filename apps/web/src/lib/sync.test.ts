import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, UnauthorizedError } from "./api";
import {
  clearOutbox,
  enqueueOp,
  readOutbox,
  replaceOps,
  type OutboxOp,
} from "./offlineDb";
import { coalesceOps, drainOutbox, queueOfflineCreate } from "./sync";

const TOKEN = "tok-sync";

function op(partial: Partial<OutboxOp> & { type: OutboxOp["type"] }): OutboxOp {
  return {
    opId: Math.random().toString(36).slice(2),
    payload: { amount: 0 },
    occurredAt: Date.now(),
    retries: 0,
    ...partial,
  };
}

beforeEach(async () => {
  await clearOutbox(TOKEN);
});

describe("coalesceOps", () => {
  it("create+update → single create with the final amount", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10 } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 25 } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("create");
    expect(result[0]!.payload.amount).toBe(25);
  });

  it("update+update on a create chain → last amount wins", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10 } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 20 } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 30 } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.amount).toBe(30);
  });

  it("create+delete → both dropped", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10 } }),
      op({ type: "delete", realId: "temp-1", payload: { amount: 0 } }),
    ];
    expect(coalesceOps(ops)).toHaveLength(0);
  });

  it("create+update with allocationType → final allocationType wins (last wins)", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10, allocationType: "NONE" } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 25, allocationType: "WEEKLY" } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.amount).toBe(25);
    expect(result[0]!.payload.allocationType).toBe("WEEKLY");
  });

  it("create+update without allocationType → inherits create's allocationType", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10, allocationType: "MONTHLY" } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 25 } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.allocationType).toBe("MONTHLY");
  });

  it("create+update chain: allocationType overridden by later update", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10, allocationType: "NONE" } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 15, allocationType: "WEEKLY" } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 20, allocationType: "MONTHLY" } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.allocationType).toBe("MONTHLY");
    expect(result[0]!.payload.amount).toBe(20);
  });

  it("create with WEEKLY + update with only allocationType NONE → final is NONE", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 50000, allocationType: "WEEKLY" } }),
      op({ type: "update", realId: "temp-1", payload: { amount: 50000, allocationType: "NONE" } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.allocationType).toBe("NONE");
  });

  it("create+delete with WEEKLY → both dropped (allocationType irrelevant)", () => {
    const ops = [
      op({ type: "create", tempId: "temp-1", payload: { amount: 10, allocationType: "WEEKLY" } }),
      op({ type: "delete", realId: "temp-1", payload: { amount: 0 } }),
    ];
    expect(coalesceOps(ops)).toHaveLength(0);
  });

  it("standalone update preserves its own allocationType (no create chain)", () => {
    const ops = [
      op({ type: "update", realId: "srv-real", payload: { amount: 99, allocationType: "WEEKLY" } }),
    ];
    const result = coalesceOps(ops);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.allocationType).toBe("WEEKLY");
  });

  it("keeps independent ops around a create chain in FIFO order", () => {
    const ops = [
      op({ type: "update", realId: "srv-9", payload: { amount: 1 } }),
      op({ type: "create", tempId: "temp-2", payload: { amount: 5 } }),
      op({ type: "update", realId: "temp-2", payload: { amount: 6 } }),
      op({ type: "delete", realId: "srv-8", payload: { amount: 0 } }),
    ];
    const result = coalesceOps(ops);
    expect(result.map((o) => [o.type, o.realId ?? o.tempId])).toEqual([
      ["update", "srv-9"],
      ["create", "temp-2"],
      ["delete", "srv-8"],
    ]);
    expect(result[1]!.payload.amount).toBe(6);
  });
});

describe("drainOutbox", () => {
  it("replays FIFO with independent ops and empties the outbox", async () => {
    await enqueueOp(TOKEN, { type: "update", realId: "srv-5", payload: { amount: 42 } });
    await enqueueOp(TOKEN, { type: "delete", realId: "srv-7", payload: { amount: 0 } });

    const calls: string[] = [];
    const api = {
      create: vi.fn(async (payload: { amount: number }) => {
        calls.push(`create:${payload.amount}`);
        return { id: "real-1", amount: payload.amount, occurredAt: "" };
      }),
      update: vi.fn(async (id: string, payload: { amount: number }) => {
        calls.push(`update:${id}:${payload.amount}`);
        return { id, amount: payload.amount, occurredAt: "" };
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`remove:${id}`);
      }),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(result.dropped).toBe(0);
    expect(calls).toEqual(["update:srv-5:42", "remove:srv-7"]);
    expect(await readOutbox(TOKEN)).toHaveLength(0);
  });

  it("coalesces create+update at drain time: one POST with the final amount", async () => {
    await enqueueOp(TOKEN, {
      type: "create",
      tempId: "temp-a",
      payload: { amount: 100, occurredAt: "2026-09-19T01:00:00+07:00" },
    });
    await enqueueOp(TOKEN, { type: "update", realId: "temp-a", payload: { amount: 150 } });

    const calls: string[] = [];
    const api = {
      create: vi.fn(async (payload: { amount: number }) => {
        calls.push(`create:${payload.amount}`);
        return { id: "real-1", amount: payload.amount, occurredAt: "" };
      }),
      update: vi.fn(async (id: string, payload: { amount: number }) => {
        calls.push(`update:${id}:${payload.amount}`);
        return { id, amount: payload.amount, occurredAt: "" };
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`remove:${id}`);
      }),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(result.dropped).toBe(0);
    expect(calls).toEqual(["create:150"]);
    expect(await readOutbox(TOKEN)).toHaveLength(0);
  });

  it("drain passes allocationType through create and update payloads", async () => {
    await enqueueOp(TOKEN, {
      type: "create",
      tempId: "temp-a",
      payload: { amount: 100, occurredAt: "2026-09-19T01:00:00+07:00", allocationType: "WEEKLY" },
    });

    const createPayload: { amount: number; allocationType?: string } = {};
    const updatePayload: { amount: number; allocationType?: string } = {};
    const api = {
      create: vi.fn(async (payload: { amount: number; allocationType?: string }) => {
        Object.assign(createPayload, payload);
        return { id: "real-alloc", amount: payload.amount, occurredAt: "", allocationType: payload.allocationType };
      }),
      update: vi.fn(async (_id: string, payload: { amount: number; allocationType?: string }) => {
        Object.assign(updatePayload, payload);
        return { id: "srv-alloc", amount: payload.amount, occurredAt: "", allocationType: payload.allocationType };
      }),
      remove: vi.fn(),
    };

    await drainOutbox(TOKEN, api);
    expect(createPayload.allocationType).toBe("WEEKLY");
  });

  it("drain passes allocationType through update payloads (real id update)", async () => {
    await enqueueOp(TOKEN, {
      type: "update",
      realId: "srv-real",
      payload: { amount: 50000, allocationType: "MONTHLY" },
    });

    const receivedPayload: { amount: number; allocationType?: string } = {};
    const api = {
      create: vi.fn(),
      update: vi.fn(async (_id: string, payload: { amount: number; allocationType?: string }) => {
        Object.assign(receivedPayload, payload);
        return { id: "srv-real", amount: payload.amount, occurredAt: "", allocationType: payload.allocationType };
      }),
      remove: vi.fn(),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(receivedPayload.allocationType).toBe("MONTHLY");
    expect(receivedPayload.amount).toBe(50000);
  });

  it("drain: coalesced create+update sends only the final allocationType", async () => {
    await enqueueOp(TOKEN, {
      type: "create",
      tempId: "temp-coalesce",
      payload: { amount: 100, allocationType: "NONE" },
    });
    await enqueueOp(TOKEN, {
      type: "update",
      realId: "temp-coalesce",
      payload: { amount: 200, allocationType: "WEEKLY" },
    });

    let receivedCreatePayload: { amount: number; allocationType?: string } = {};
    const api = {
      create: vi.fn(async (payload: { amount: number; allocationType?: string }) => {
        receivedCreatePayload = payload;
        return { id: "real-coalesced", amount: payload.amount, occurredAt: "", allocationType: payload.allocationType };
      }),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(receivedCreatePayload.allocationType).toBe("WEEKLY");
    expect(receivedCreatePayload.amount).toBe(200);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("network failure (status 0) stops the drain with the head intact", async () => {
    await enqueueOp(TOKEN, { type: "create", tempId: "temp-x", payload: { amount: 10 } });
    await enqueueOp(TOKEN, { type: "delete", realId: "srv-1", payload: { amount: 0 } });

    const api = {
      create: vi.fn(async () => {
        throw new ApiError(0, "offline");
      }),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(2);
    expect(api.remove).not.toHaveBeenCalled();
    const ops = await readOutbox(TOKEN);
    expect(ops[0]!.tempId).toBe("temp-x");
  });

  it("update 404 → op dropped (delete on another device wins)", async () => {
    await enqueueOp(TOKEN, { type: "update", realId: "gone", payload: { amount: 5 } });
    await enqueueOp(TOKEN, { type: "delete", realId: "srv-2", payload: { amount: 0 } });

    const api = {
      create: vi.fn(),
      update: vi.fn(async () => {
        throw new ApiError(404, "Expense not found.");
      }),
      remove: vi.fn(async () => undefined),
    };

    const result = await drainOutbox(TOKEN, api);
    expect(result.dropped).toBe(1);
    expect(result.remaining).toBe(0);
    expect(api.remove).toHaveBeenCalledWith("srv-2");
  });

  it("delete 404 → treated as success", async () => {
    await enqueueOp(TOKEN, { type: "delete", realId: "already-gone", payload: { amount: 0 } });
    const api = {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => {
        throw new ApiError(404, "Expense not found.");
      }),
    };
    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(result.dropped).toBe(1);
    expect(await readOutbox(TOKEN)).toHaveLength(0);
  });

  it("4xx validation → op dropped and message surfaced", async () => {
    await enqueueOp(TOKEN, { type: "create", tempId: "temp-b", payload: { amount: -5 } });
    const api = {
      create: vi.fn(async () => {
        throw new ApiError(400, "Invalid amount.");
      }),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const result = await drainOutbox(TOKEN, api);
    expect(result.dropped).toBe(1);
    expect(result.validationErrors).toContain("Invalid amount.");
    expect(await readOutbox(TOKEN)).toHaveLength(0);
  });

  it("401 → authFailed, outbox preserved for retry after re-login", async () => {
    await enqueueOp(TOKEN, { type: "create", tempId: "temp-c", payload: { amount: 10 } });
    const api = {
      create: vi.fn(async () => {
        throw new UnauthorizedError("Unauthorized.");
      }),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const result = await drainOutbox(TOKEN, api);
    expect(result.authFailed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(await readOutbox(TOKEN)).toHaveLength(1);
  });

  it("coalesces at drain time: create+delete in the queue never hits the API", async () => {
    await queueOfflineCreate(TOKEN, { amount: 99, occurredAt: new Date().toISOString() }, "temp-z");
    await replaceOps(TOKEN, [
      ...(await readOutbox(TOKEN)),
      op({ type: "delete", realId: "temp-z", payload: { amount: 0 } }),
    ]);

    const api = {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const result = await drainOutbox(TOKEN, api);
    expect(result.remaining).toBe(0);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(await readOutbox(TOKEN)).toHaveLength(0);
  });
});
