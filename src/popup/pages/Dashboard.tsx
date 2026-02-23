import { useState, useEffect } from "react";
import type { Application, ApplicationStatus } from "../../shared/types";
import { APPLICATION_STATUSES } from "../../shared/types";
import {
  getApplications,
  addApplication,
  updateApplication,
  deleteApplication,
} from "../../shared/storage";

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  saved: "bg-white/10 text-white/50",
  applied: "bg-midnight-600/30 text-midnight-300",
  interviewing: "bg-aurora-teal/20 text-aurora-teal",
  offered: "bg-aurora-green/20 text-aurora-green",
  accepted: "bg-aurora-green/30 text-aurora-green",
  rejected: "bg-aurora-pink/20 text-aurora-pink",
  ghosted: "bg-white/5 text-white/30",
};

const STATUS_EMOJI: Record<ApplicationStatus, string> = {
  saved: "📌",
  applied: "📨",
  interviewing: "💬",
  offered: "🎉",
  accepted: "✅",
  rejected: "❌",
  ghosted: "👻",
};

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newApp, setNewApp] = useState({ company: "", role: "", url: "" });

  useEffect(() => {
    loadApps();
  }, []);

  async function loadApps() {
    setApps(await getApplications());
  }

  async function handleAdd() {
    if (!newApp.company) return;
    const app: Application = {
      id: crypto.randomUUID(),
      company: newApp.company,
      role: newApp.role,
      url: newApp.url,
      status: "saved",
      dateAdded: new Date().toISOString(),
      dateApplied: "",
      notes: "",
      salary: "",
      location: "",
    };
    await addApplication(app);
    setNewApp({ company: "", role: "", url: "" });
    setShowAdd(false);
    await loadApps();
  }

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const updates: Partial<Application> = { status };
    if (status === "applied") {
      updates.dateApplied = new Date().toISOString();
    }
    await updateApplication(id, updates);
    await loadApps();
  }

  async function handleDelete(id: string) {
    await deleteApplication(id);
    await loadApps();
  }

  // Summary counts
  const counts = APPLICATION_STATUSES.reduce(
    (acc, s) => {
      acc[s] = apps.filter((a) => a.status === s).length;
      return acc;
    },
    {} as Record<ApplicationStatus, number>
  );

  return (
    <div className="p-4 space-y-3">
      {/* Summary bar */}
      <div className="flex gap-1 flex-wrap">
        {APPLICATION_STATUSES.filter((s) => counts[s] > 0).map((s) => (
          <span
            key={s}
            className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLORS[s]}`}
          >
            {STATUS_EMOJI[s]} {counts[s]}
          </span>
        ))}
        {apps.length === 0 && (
          <span className="text-xs text-white/30">
            No applications yet. Add one below!
          </span>
        )}
      </div>

      {/* Add button */}
      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-2 border border-dashed border-white/10 hover:border-aurora-teal/30 rounded-lg text-xs text-white/40 hover:text-aurora-teal transition-colors"
        >
          + Add Application
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-surface-2 rounded-lg p-3 space-y-2">
          <input
            placeholder="Company"
            value={newApp.company}
            onChange={(e) => setNewApp({ ...newApp, company: e.target.value })}
            className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none"
            autoFocus
          />
          <input
            placeholder="Role (optional)"
            value={newApp.role}
            onChange={(e) => setNewApp({ ...newApp, role: e.target.value })}
            className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none"
          />
          <input
            placeholder="URL (optional)"
            value={newApp.url}
            onChange={(e) => setNewApp({ ...newApp, url: e.target.value })}
            className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newApp.company}
              className="flex-1 py-1.5 bg-midnight-600 hover:bg-midnight-500 disabled:opacity-30 rounded text-xs font-medium"
            >
              Save
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Application list */}
      <div className="space-y-2 max-h-[340px] overflow-y-auto">
        {apps
          .sort(
            (a, b) =>
              new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
          )
          .map((app) => (
            <div
              key={app.id}
              className="bg-surface-2 rounded-lg px-3 py-2 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/80 truncate">
                    {app.company}
                  </p>
                  {app.role && (
                    <p className="text-[10px] text-white/40 truncate">
                      {app.role}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(app.id)}
                  className="text-[10px] text-white/10 group-hover:text-white/30 hover:!text-aurora-pink ml-2"
                >
                  ✕
                </button>
              </div>

              {/* Status selector */}
              <div className="flex gap-1 mt-2 flex-wrap">
                {APPLICATION_STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(app.id, s)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full transition-all ${
                      app.status === s
                        ? STATUS_COLORS[s] + " ring-1 ring-current"
                        : "text-white/15 hover:text-white/30"
                    }`}
                  >
                    {STATUS_EMOJI[s]} {s}
                  </button>
                ))}
              </div>

              {/* Date */}
              <p className="text-[9px] text-white/20 mt-1.5">
                {new Date(app.dateAdded).toLocaleDateString()}
                {app.url && (
                  <>
                    {" · "}
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener"
                      className="text-midnight-400 hover:text-midnight-300"
                    >
                      link
                    </a>
                  </>
                )}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
