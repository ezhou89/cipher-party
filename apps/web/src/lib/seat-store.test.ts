import { beforeEach, describe, expect, it } from "vitest";
import {
  createSeatStore,
  type SeatCredentials,
  type SeatStore
} from "./seat-store";

describe("SeatStore IndexedDB Persistence", () => {
  let store: SeatStore;

  beforeEach(() => {
    store = createSeatStore();
  });

  it("saves credentials and retrieves them across store instances", async () => {
    const creds: SeatCredentials = {
      code: "ABC234",
      playerId: "player-1",
      seatToken: "seat-token-12345678901234567890123456789012",
      hostToken: "host-token-12345678901234567890123456789012"
    };

    await store.put(creds);

    const loaded = await store.get("ABC234");
    expect(loaded).toEqual(creds);

    // Create a new store instance to simulate browser restart/refresh
    const newStoreInstance = createSeatStore();
    const reloaded = await newStoreInstance.get("ABC234");
    expect(reloaded).toEqual(creds);
  });

  it("overwrites old tokens when replacing credentials for the same room code", async () => {
    const initial: SeatCredentials = {
      code: "ROOM01",
      playerId: "player-old",
      seatToken: "old-token"
    };
    await store.put(initial);

    const replacement: SeatCredentials = {
      code: "ROOM01",
      playerId: "player-new",
      seatToken: "new-token",
      hostToken: "new-host-token"
    };
    await store.put(replacement);

    const current = await store.get("ROOM01");
    expect(current).toEqual(replacement);
  });

  it("deleting one room does not delete another room", async () => {
    const room1: SeatCredentials = {
      code: "ROOM01",
      playerId: "p1",
      seatToken: "t1"
    };
    const room2: SeatCredentials = {
      code: "ROOM02",
      playerId: "p2",
      seatToken: "t2"
    };

    await store.put(room1);
    await store.put(room2);

    await store.delete("ROOM01");

    expect(await store.get("ROOM01")).toBeUndefined();
    expect(await store.get("ROOM02")).toEqual(room2);
  });

  it("never writes credentials to localStorage or exposes them in storage", async () => {
    const creds: SeatCredentials = {
      code: "SECRET",
      playerId: "p-secret",
      seatToken: "super-secret-token",
      hostToken: "super-secret-host"
    };

    await store.put(creds);

    // Assert nothing was touched in localStorage
    expect(localStorage.getItem("SECRET")).toBeNull();
    expect(localStorage.getItem("seatToken")).toBeNull();
    expect(localStorage.getItem("super-secret-token")).toBeNull();
  });
});
