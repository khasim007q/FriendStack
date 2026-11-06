import { createRoot } from "react-dom/client";
if (location.pathname.startsWith("/football"))
  document.title = "Kickabout — FriendStack Playground";
const { default: App } = await import(
  location.pathname.startsWith("/football")
    ? "./App.jsx"
    : "./cards/CardApp.jsx"
);
createRoot(document.getElementById("root")).render(<App />);
