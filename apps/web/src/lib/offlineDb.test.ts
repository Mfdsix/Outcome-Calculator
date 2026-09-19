import { beforeEach, describe, expect, it } from "vitest";

import {
  civilDayKey,
  clearOutbox,
  countOutbox,
  enqueueOp,
  loadTodayCache,
  mutateOutbox,
  newTempId,
  readOutbox,
  saveTodayCache,
} from "./offlineDb";

const TOKEN = "tok-1";

beforeEach(async () => {
  await clearOutbox(TOKEN);
  await clearOutbox("tok-2");
});

describe("civilDayKey", () => {
  it("maps an instant to the Jakarta civil day (UTC+7 rollover)", () => {
    // 22:00 UTC = 05:00 next day in Jakarta.
    expect(civilDayKey("2026-09-18T22:00:00Z")).toBe("2026-09-19");
    // 16:59 UTC = 23:59 same day in Jakarta.
    expect(civilDayKey("2026-09-18T16:59:00Z")).toBe("2026-09-18");
    expect(civilDayKey(new Date("2026-01-01T17:00:00Z"))).toBe("2026-01-02");
  });
});

describe("today-cache", () => {
  it("round-trips a snapshot with cachedAt stamped", async () => {
    await saveTodayCache({
      expenses: [{ id: "a", amount: 1000, occurredAt: "2026-09-19T01:00:00+07:00" }],
      total: 1000,
      dayKey: "2026-09-19",
      from: "2026-09-19T00:00:00+07:00",
      to: "2026-09-20T00:00:00+07:00",
      occurredAt: "2026-09-19T01:00:00+07:00",
    });
    const cache = await loadTodayCache();
    expect(cache).not.toBeNull();
    expect(cache!.total).toBe(1000);
    expect(cache!.dayKey).toBe("2026-09-19");
    expect(cache!.expenses).toHaveLength(1);
    expect(typeof cache!.cachedAt).toBe("number");
  });

  it("returns null when nothing was cached", async () => {
    expect(await loadTodayCache()).toBeNull();
  });
});

describe("outbox", () => {
  it("starts empty and appends FIFO with generated ids", async () => {
    expect(await countOutbox(TOKEN)).toBe(0);

    const first = await enqueueOp(TOKEN, {
      type: "create",
      tempId: newTempId(),
      payload: { amount: 5000, occurredAt: "2026-09-19T01:00:00+07:00" },
    });
    const second = await enqueueOp(TOKEN, {
      type: "update",
      realId: "srv-1",
      payload: { amount: 7000 },
    });

    const ops = await readOutbox(TOKEN);
    expect(ops.map((op) => op.opId)).toEqual([first.opId, second.opId]);
    expect(first.retries).toBe(0);
    expect(first.occurredAt).toBeGreaterThan(0);
    expect(first.tempId).toMatch(/^temp-/);
  });

  it("keeps outboxes of different tokens isolated", async () => {
    await enqueueOp(TOKEN, { type: "create", tempId: "temp-a", payload: { amount: 1 } });
    expect(await countOutbox("tok-2")).toBe(0);
    await enqueueOp("tok-2", { type: "update", realId: "x", payload: { amount: 2 } });
    expect(await countOutbox(TOKEN)).toBe(1);
    expect(await countOutbox("tok-2")).toBe(1);
  });

  it("serializes concurrent read-modify-write cycles without losing ops", async () => {
    // Fire 10 enqueues "simultaneously"; all 10 must survive.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        enqueueOp(TOKEN, { type: "update", realId: `id-${i}`, payload: { amount: i } }),
      ),
    );
    expect(await countOutbox(TOKEN)).toBe(10);

    // mutateOutbox sees a consistent view per cycle.
    const result = await mutateOutbox(TOKEN, (ops) => {
      const next = ops.filter((op) => op.realId !== "id-0");
      return { ops: next, result: next.length };
    });
    expect(result).toBe(9);
    expect(await countOutbox(TOKEN)).toBe(9);
  });
});
