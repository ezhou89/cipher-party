import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface SeatCredentials {
  code: string;
  playerId: string;
  seatToken: string;
  hostToken?: string | undefined;
}

export interface SeatStore {
  get(code: string): Promise<SeatCredentials | undefined>;
  put(credentials: SeatCredentials): Promise<void>;
  delete(code: string): Promise<void>;
}

interface CipherPartyDB extends DBSchema {
  seats: {
    key: string;
    value: SeatCredentials;
  };
}

const DB_NAME = "cipher-party";
const DB_VERSION = 1;
const STORE_NAME = "seats";

function getDB(): Promise<IDBPDatabase<CipherPartyDB>> {
  return openDB<CipherPartyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "code" });
      }
    }
  });
}

export function createSeatStore(): SeatStore {
  return {
    async get(code: string): Promise<SeatCredentials | undefined> {
      const db = await getDB();
      return db.get(STORE_NAME, code);
    },
    async put(credentials: SeatCredentials): Promise<void> {
      const db = await getDB();
      await db.put(STORE_NAME, credentials);
    },
    async delete(code: string): Promise<void> {
      const db = await getDB();
      await db.delete(STORE_NAME, code);
    }
  };
}
