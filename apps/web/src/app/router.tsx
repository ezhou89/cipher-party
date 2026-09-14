import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { HomePage } from "../features/home/HomePage";
import { RoomPage } from "../features/lobby/RoomPage";
import type { RoomSocketClient } from "../features/lobby/useRoom";
import { IndexedDbSeatStore, type SeatStore } from "../lib/seat-store";

export interface AppRouteDependencies {
  seatStore?: SeatStore;
  createRoomSocket?: () => RoomSocketClient;
}

export function createAppRoutes(
  dependencies: AppRouteDependencies = {},
): RouteObject[] {
  const seatStore = dependencies.seatStore ?? new IndexedDbSeatStore();
  return [
    { path: "/", element: <HomePage seatStore={seatStore} /> },
    {
      path: "/room/:code",
      element: (
        <RoomPage
          seatStore={seatStore}
          {...(dependencies.createRoomSocket === undefined
            ? {}
            : { createRoomSocket: dependencies.createRoomSocket })}
        />
      ),
    },
  ];
}

export function createAppRouter() {
  return createBrowserRouter(createAppRoutes());
}
