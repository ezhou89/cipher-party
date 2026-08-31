import { afterEach, describe, expect, it } from "vitest";

import {
  deleteCredentials,
  IndexedDbSeatStore,
  loadCredentials,
  saveCredentials,
} from "./seat-store";

const DATABASE_NAME = "cipher-party";

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("credential database deletion was blocked")),
    );
  });
}

afterEach(async () => {
  localStorage.clear();
  await deleteDatabase();
});

describe("IndexedDbSeatStore", () => {
  it("loads credentials, including optional host authority, from a new store instance", async () => {
    const credentials = {
      code: "ABC123",
      playerId: "player-1",
      seatToken: "seat-secret",
      hostToken: "host-secret",
    };

    await new IndexedDbSeatStore().put(credentials);

    await expect(new IndexedDbSeatStore().get("ABC123")).resolves.toEqual(
      credentials,
    );
  });

  it("atomically replaces the recovered seat and removes a stale host token", async () => {
    const store = new IndexedDbSeatStore();
    await store.put({
      code: "ABC123",
      playerId: "old-player",
      seatToken: "old-seat",
      hostToken: "old-host",
    });

    await store.put({
      code: "ABC123",
      playerId: "new-player",
      seatToken: "new-seat",
    });

    await expect(store.get("ABC123")).resolves.toEqual({
      code: "ABC123",
      playerId: "new-player",
      seatToken: "new-seat",
    });
  });

  it("deletes one room without affecting another", async () => {
    const store = new IndexedDbSeatStore();
    await store.put({ code: "ABC123", playerId: "one", seatToken: "first" });
    await store.put({ code: "DEF456", playerId: "two", seatToken: "second" });

    await store.delete("ABC123");

    await expect(store.get("ABC123")).resolves.toBeUndefined();
    await expect(store.get("DEF456")).resolves.toEqual({
      code: "DEF456",
      playerId: "two",
      seatToken: "second",
    });
  });

  it("exposes helpers over the same IndexedDB store without URL or localStorage leakage", async () => {
    const credentials = {
      code: "ABC123",
      playerId: "player-1",
      seatToken: "durable-seat-token",
      hostToken: "durable-host-token",
    };

    await saveCredentials(credentials);

    await expect(loadCredentials("ABC123")).resolves.toEqual(credentials);
    expect(localStorage.length).toBe(0);
    expect(window.location.href).not.toContain(credentials.seatToken);
    expect(window.location.href).not.toContain(credentials.hostToken);
    await deleteCredentials("ABC123");
    await expect(loadCredentials("ABC123")).resolves.toBeUndefined();
  });
});
