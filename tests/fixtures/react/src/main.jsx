import React from "react";
import { createRoot } from "react-dom/client";
import Button from './Button.jsx';
const App = () => (
  <main>
    <h1>React 页面</h1>
    <Button />
    <button id="react-target" style={{ color: "red", padding: 16 }}>
      React button
    </button>
    {[1, 2].map((index) => (
      <div key={index} className="repeated">
        重复元素 {index}
      </div>
    ))}
  </main>
);
createRoot(document.getElementById("root")).render(<App />);
