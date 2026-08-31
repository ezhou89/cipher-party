import { RouterProvider, type DataRouter } from "react-router-dom";

interface AppProps {
  router: DataRouter;
}

export function App({ router }: AppProps) {
  return <RouterProvider router={router} />;
}
