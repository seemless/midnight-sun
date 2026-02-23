import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import FillPreview from "./pages/FillPreview";
import ProfilePage from "./pages/Profile";
import ResumesPage from "./pages/Resumes";
import DebugLog from "./pages/DebugLog";

type Tab = "dashboard" | "fill" | "profile" | "resumes" | "debug";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Jobs", icon: "📋" },
  { id: "fill", label: "Fill", icon: "⚡" },
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "resumes", label: "Resumes", icon: "📄" },
  { id: "debug", label: "Debug", icon: "🔍" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("fill");

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      {/* Header */}
      <header className="px-4 py-3 bg-surface-1 border-b border-white/5">
        <h1 className="text-lg font-bold aurora-text">The Midnight Sun</h1>
      </header>

      {/* Tab bar — top */}
      <nav className="flex bg-surface-1 border-b border-white/5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-center text-[10px] font-medium transition-colors ${
              tab === t.id
                ? "text-aurora-teal border-b-2 border-aurora-teal"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <span className="block text-sm mb-0.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content — all pages stay mounted, hidden via CSS to preserve state */}
      <div className={`flex-1 overflow-y-auto ${tab === "dashboard" ? "" : "hidden"}`}><Dashboard /></div>
      <div className={`flex-1 overflow-y-auto ${tab === "fill" ? "" : "hidden"}`}><FillPreview /></div>
      <div className={`flex-1 overflow-y-auto ${tab === "profile" ? "" : "hidden"}`}><ProfilePage /></div>
      <div className={`flex-1 overflow-y-auto ${tab === "resumes" ? "" : "hidden"}`}><ResumesPage /></div>
      <div className={`flex-1 overflow-y-auto ${tab === "debug" ? "" : "hidden"}`}><DebugLog /></div>
    </div>
  );
}
