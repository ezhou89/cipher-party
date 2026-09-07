import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "../features/home/HomePage";
import { RoomPage } from "../features/lobby/RoomPage";

export const routes = [
  {
    path: "/",
    element: <HomePage />
  },
  {
    path: "/room/:code",
    element: <RoomPage />
  }
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

export const router = createAppRouter();
