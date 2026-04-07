import { Routes, Route } from "react-router-dom";

function Home() {
  return <main className="p-8">AnyClaw template</main>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
