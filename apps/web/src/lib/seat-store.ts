import { openDB } from "idb";

const DATABASE_NAME = "cipher-party";
const DATABASE_VERSION = 1;
const SEAT_STORE = "seats";

export interface SeatCredentials {
  code: string;
  playerId: string;
  seatToken: string;
  hostToken?: string;
}

export interface SeatStore {
  get(code: string): Promise<SeatCredentials | undefined>;
  put(credentials: SeatCredentials): Promise<void>;
  delete(code: string): Promise<void>;
}

async function withSeatDatabase<T>(
  operation: (database: Awaited<ReturnType<typeof openDB>>) => Promise<T>,
): Promise<T> {
  const database = await openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(upgradeDatabase) {
      if (!upgradeDatabase.objectStoreNames.contains(SEAT_STORE)) {
        upgradeDatabase.createObjectStore(SEAT_STORE, { keyPath: "code" });
      }
    },
  });
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

function copyCredentials(credentials: SeatCredentials): SeatCredentials {
  return credentials.hostToken === undefined
    ? {
        code: credentials.code,
        playerId: credentials.playerId,
        seatToken: credentials.seatToken,
      }
    : {
        code: credentials.code,
        playerId: credentials.playerId,
        seatToken: credentials.seatToken,
        hostToken: credentials.hostToken,
      };
}

export class IndexedDbSeatStore implements SeatStore {
  async get(code: string): Promise<SeatCredentials | undefined> {
    const value = await withSeatDatabase((database) =>
      database.get(SEAT_STORE, code),
    );
    return value === undefined
      ? undefined
      : copyCredentials(value as SeatCredentials);
  }

  async put(credentials: SeatCredentials): Promise<void> {
    await withSeatDatabase(async (database) => {
      await database.put(SEAT_STORE, copyCredentials(credentials));
    });
  }

  async delete(code: string): Promise<void> {
    await withSeatDatabase(async (database) => {
      await database.delete(SEAT_STORE, code);
    });
  }
}

const defaultSeatStore: SeatStore = new IndexedDbSeatStore();

export function saveCredentials(credentials: SeatCredentials): Promise<void> {
  return defaultSeatStore.put(credentials);
}

export function loadCredentials(
  code: string,
): Promise<SeatCredentials | undefined> {
  return defaultSeatStore.get(code);
}

export function deleteCredentials(code: string): Promise<void> {
  return defaultSeatStore.delete(code);
}
