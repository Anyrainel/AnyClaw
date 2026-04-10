import { Routes, Route } from "react-router-dom";
import { Welcome } from "./pages/Welcome.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
    </Routes>
  );
}
