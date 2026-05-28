import { useState, useEffect, useCallback } from "react";

// Types are plain JS objects — no TS interfaces needed in JSX

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BRIDGE_URL = "http://localhost:7331";

// ─── API HELPERS ─────────────────────────────────────────────────────────────
async function api(path, opts) {
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = {
  Bridge: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
      <line x1="20" y1="22" x2="20" y2="15"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <polyline points="20,6 9,17 4,12"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Key: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3"/>
    </svg>
  ),
  Server: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
      <circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/>
    </svg>
  ),
  Globe: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  Zap: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
    </svg>
  ),
  Cpu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/>
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
  ),
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function Badge({ source }) {
  const styles = {
    convention: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    llm: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
    manual: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  };
  const labels = {
    convention: "⚡ Convention",
    llm: "✦ LLM",
    manual: "✎ Manual",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

function StatusDot({ status }) {
  const styles = {
    active: "bg-emerald-400",
    pending_approval: "bg-amber-400 animate-pulse",
    rejected: "bg-red-400",
    drifted: "bg-orange-400",
    deprecated: "bg-zinc-500",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${styles[status]}`} />;
}

function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "#34d399" : pct >= 60 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

function MethodTag({ method }) {
  const colors = {
    GET: "text-sky-300 bg-sky-500/10 border-sky-500/20",
    POST: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
    PUT: "text-amber-300 bg-amber-500/10 border-amber-500/20",
    PATCH: "text-orange-300 bg-orange-500/10 border-orange-500/20",
    DELETE: "text-red-300 bg-red-500/10 border-red-500/20",
  };
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${colors[method] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"}`}>
      {method}
    </span>
  );
}

// ─── CONTRACTS TAB ────────────────────────────────────────────────────────────

function ContractsTab() {
  const [contracts, setContracts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api("/admin/contracts");
      setContracts(data);
    } catch { /* bridge might not be running */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    await api(`/admin/contracts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", approvedBy: "dashboard-user" }),
    });
    await load();
    setSelected(null);
  };

  const reject = async (id) => {
    await api(`/admin/contracts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected" }),
    });
    await load();
    setSelected(null);
  };

  const filtered = filter === "all" ? contracts : contracts.filter(c => c.status === filter);
  const pending = contracts.filter(c => c.status === "pending_approval").length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "active", "pending_approval", "rejected", "deprecated"]).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === s
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            {s === "all" ? "All" : s.replace("_", " ")}
            {s === "pending_approval" && pending > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded-full text-xs">
                {pending}
              </span>
            )}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors">
          <Icon.Refresh />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-500">Loading contracts…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <div className="text-4xl mb-3">⛓</div>
          <div className="text-sm">No contracts yet.</div>
          <div className="text-xs mt-1 text-zinc-700">Register a frontend and backend to get started.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(contract => (
            <div
              key={contract.id}
              onClick={() => setSelected(selected?.id === contract.id ? null : contract)}
              className={`rounded-xl border transition-all cursor-pointer ${
                selected?.id === contract.id
                  ? "border-white/20 bg-white/5"
                  : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
              }`}
            >
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <StatusDot status={contract.status} />
                <MethodTag method={contract.httpMethod} />
                <code className="text-sm text-zinc-200 font-mono flex-1 min-w-0 truncate">
                  {contract.generatedEndpoint}
                </code>
                <Badge source={contract.source} />
                <ConfidenceBar value={contract.confidence} />
                <span className="text-xs text-zinc-600">{contract.usageCount} calls</span>
              </div>

              {selected?.id === contract.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-zinc-500 mb-1">Intent ID</div>
                      <code className="text-zinc-300 font-mono">{contract.intentId}</code>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-1">Capability ID</div>
                      <code className="text-zinc-300 font-mono">{contract.capabilityId}</code>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-1">App</div>
                      <code className="text-zinc-300 font-mono">{contract.appId}</code>
                    </div>
                    <div>
                      <div className="text-zinc-500 mb-1">Service</div>
                      <code className="text-zinc-300 font-mono">{contract.serviceId}</code>
                    </div>
                  </div>

                  {contract.reasoning && (
                    <div>
                      <div className="text-xs text-zinc-500 mb-1">Reasoning</div>
                      <div className="text-xs text-zinc-300 bg-white/5 rounded-lg px-3 py-2">
                        {contract.reasoning}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Created</div>
                    <div className="text-xs text-zinc-400">
                      {new Date(contract.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {contract.status === "pending_approval" && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); approve(contract.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-sm hover:bg-emerald-500/30 transition-colors"
                      >
                        <Icon.Check /> Approve
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); reject(contract.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-sm hover:bg-red-500/30 transition-colors"
                      >
                        <Icon.X /> Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SERVICES TAB ─────────────────────────────────────────────────────────────

function ServicesTab() {
  const [backends, setBackends] = useState([]);
  const [frontends, setFrontends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api("/admin/backends").catch(() => []),
      api("/admin/frontends").catch(() => []),
    ]).then(([b, f]) => {
      setBackends(b);
      setFrontends(f);
      setLoading(false);
    });
  }, []);

  const isAlive = (ts) => {
    if (!ts) return false;
    return Date.now() - new Date(ts).getTime() < 60_000;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
          <Icon.Server /> Backends
        </h3>
        {loading ? <div className="text-zinc-600 text-sm">Loading…</div> :
          backends.length === 0 ? (
            <div className="text-zinc-700 text-sm text-center py-8 border border-dashed border-white/5 rounded-xl">
              No backends registered
            </div>
          ) : (
            <div className="space-y-3">
              {backends.map(b => (
                <div key={b.serviceId} className="border border-white/5 rounded-xl p-4 bg-white/[0.02]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-zinc-200">{b.serviceName}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isAlive(b.lastHeartbeat) ? "bg-emerald-400" : "bg-zinc-600"}`} />
                      <span className="text-xs text-zinc-600">{isAlive(b.lastHeartbeat) ? "live" : "offline"}</span>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono mb-2">{b.baseUrl}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs bg-white/5 px-2 py-0.5 rounded text-zinc-400">{b.stack}</span>
                    <span className="text-xs bg-white/5 px-2 py-0.5 rounded text-zinc-400">v{b.version}</span>
                    <span className="text-xs text-zinc-600">{b.capabilities.length} capabilities</span>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
          <Icon.Globe /> Frontends
        </h3>
        {loading ? <div className="text-zinc-600 text-sm">Loading…</div> :
          frontends.length === 0 ? (
            <div className="text-zinc-700 text-sm text-center py-8 border border-dashed border-white/5 rounded-xl">
              No frontends registered
            </div>
          ) : (
            <div className="space-y-3">
              {frontends.map(f => (
                <div key={f.appId} className="border border-white/5 rounded-xl p-4 bg-white/[0.02]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-zinc-200">{f.appName}</span>
                    <span className="text-xs bg-white/5 px-2 py-0.5 rounded text-zinc-400">{f.framework}</span>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono mb-2">{f.appId}</div>
                  <div className="text-xs text-zinc-600">{f.intents.length} intents declared</div>
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  );
}

// ─── KEYS TAB ─────────────────────────────────────────────────────────────────

function KeysTab() {
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadKeys = useCallback(async () => {
    try {
      const data = await api("/admin/keys");
      setKeys(data);
    } catch { /* bridge not running */ }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const addKey = async () => {
    if (!newKey.trim()) return;
    setAdding(true);
    setError("");
    try {
      await api("/admin/keys", {
        method: "POST",
        body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      setNewKey("");
      setSuccess("API key saved securely.");
      setTimeout(() => setSuccess(""), 3000);
      await loadKeys();
    } catch (e) {
      setError("Invalid key format. Must start with sk-ant-");
    }
    setAdding(false);
  };

  const deleteKey = async (id) => {
    await api(`/admin/keys/${id}`, { method: "DELETE" });
    await loadKeys();
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-1">Add Claude API Key</h3>
        <p className="text-xs text-zinc-600 mb-4">
          Your key is AES-256 encrypted at rest and never logged or exposed via the API.
          It's used only for LLM synthesis when convention matching fails.
        </p>

        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addKey()}
            placeholder="sk-ant-api03-…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/20 font-mono"
          />
          <button
            onClick={addKey}
            disabled={adding || !newKey}
            className="px-4 py-2 rounded-lg bg-white/10 text-zinc-200 text-sm hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? "Saving…" : "Save"}
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        {success && <p className="text-xs text-emerald-400 mt-2">✓ {success}</p>}
      </div>

      {keys.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Saved Keys</h3>
          <div className="space-y-2">
            {keys.map(key => (
              <div key={key.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/5 bg-white/[0.02]">
                <Icon.Key />
                <code className="flex-1 text-sm text-zinc-300 font-mono">{key.preview}</code>
                <span className="text-xs text-zinc-600">{key.provider}</span>
                <button
                  onClick={() => deleteKey(key.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <Icon.Trash />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-white/5 rounded-xl p-4 bg-white/[0.02]">
        <h4 className="text-xs font-medium text-zinc-400 mb-2">Key Resolution Order</h4>
        <ol className="space-y-1.5 text-xs text-zinc-500">
          <li className="flex items-center gap-2">
            <span className="text-zinc-700">1.</span> Per-request key (passed in SDK call)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-zinc-700">2.</span> Project key (set in bridge.config.ts)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-zinc-700">3.</span> Environment variable (WIREBRIDGE_ANTHROPIC_KEY)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-zinc-700">4.</span> Key saved here in the dashboard
          </li>
          <li className="flex items-center gap-2">
            <span className="text-zinc-700">5.</span>
            <span className="text-amber-600/80">Convention-only mode (no LLM synthesis)</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────

const EVENT_STYLES = {
  "contract:resolved":   { color: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/20", icon: "⛓", label: "Contract Resolved" },
  "contract:approved":   { color: "text-sky-300",     bg: "bg-sky-500/10 border-sky-500/20",         icon: "✓", label: "Contract Approved" },
  "contract:rejected":   { color: "text-red-300",     bg: "bg-red-500/10 border-red-500/20",         icon: "✗", label: "Contract Rejected" },
  "contract:drifted":    { color: "text-amber-300",   bg: "bg-amber-500/10 border-amber-500/20",     icon: "⚠", label: "Contract Drifted" },
  "backend:registered":  { color: "text-violet-300",  bg: "bg-violet-500/10 border-violet-500/20",   icon: "⬆", label: "Backend Online" },
  "backend:offline":     { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",         icon: "⬇", label: "Backend Offline" },
  "frontend:registered": { color: "text-cyan-300",    bg: "bg-cyan-500/10 border-cyan-500/20",       icon: "◎", label: "Frontend Connected" },
  "drift:detected":      { color: "text-orange-300",  bg: "bg-orange-500/10 border-orange-500/20",   icon: "≠", label: "Drift Detected" },
  "resolution:failed":   { color: "text-red-300",     bg: "bg-red-500/10 border-red-500/20",         icon: "?", label: "Resolution Failed" },
};

function EventCard({ event }) {
  const style = EVENT_STYLES[event.type] || { color: "text-zinc-400", bg: "bg-white/5 border-white/10", icon: "·", label: event.type };
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className={`flex gap-3 px-3 py-2.5 rounded-lg border ${style.bg} transition-all`}>
      <span className={`text-base leading-none mt-0.5 ${style.color} w-4 text-center flex-shrink-0`}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={`text-xs font-medium ${style.color}`}>{style.label}</span>
          <span className="text-xs text-zinc-600 font-mono flex-shrink-0">{time}</span>
        </div>
        <div className="text-xs text-zinc-500 space-y-0.5">
          {event.payload.endpoint && (
            <div><code className="text-zinc-400 font-mono">{event.payload.endpoint}</code></div>
          )}
          {event.payload.serviceName && (
            <div>service: <span className="text-zinc-300">{event.payload.serviceName}</span></div>
          )}
          {event.payload.appName && (
            <div>app: <span className="text-zinc-300">{event.payload.appName}</span></div>
          )}
          {event.payload.confidence !== undefined && (
            <div>confidence: <span className="text-zinc-300">{Math.round(event.payload.confidence * 100)}%</span></div>
          )}
          {event.payload.reason && (
            <div>reason: <span className="text-zinc-400">{event.payload.reason}</span></div>
          )}
          {event.payload.changes && (
            <div>changes: <span className="text-orange-300/80">{event.payload.changes.join(", ")}</span></div>
          )}
          {event.payload.source && event.payload.source !== "convention" && event.payload.source !== "llm" && (
            <div>via: <span className="text-zinc-400">{event.payload.source}</span></div>
          )}
        </div>
      </div>
      {event.payload.source && (
        <div className="flex-shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono border ${
            event.payload.source === "llm"
              ? "text-violet-300 bg-violet-500/10 border-violet-500/20"
              : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
          }`}>
            {event.payload.source === "llm" ? "✦ LLM" : "⚡ conv"}
          </span>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ events, sseConnected }) {
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${
          sseConnected
            ? "text-violet-300 border-violet-500/20 bg-violet-500/5"
            : "text-zinc-500 border-white/5 bg-white/[0.02]"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? "bg-violet-400 animate-pulse" : "bg-zinc-600"}`} />
          {sseConnected ? "receiving live events" : "not connected to event stream"}
        </div>
        {events.length > 0 && (
          <span className="text-xs text-zinc-600">{events.length} events</span>
        )}
      </div>

      {/* Event stream */}
      {events.length === 0 ? (
        <div className="text-center py-20 text-zinc-700">
          <div className="text-4xl mb-3">〜</div>
          <div className="text-sm">Waiting for events…</div>
          <div className="text-xs mt-1 text-zinc-800">
            Register a backend or frontend to see activity here.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <EventCard key={`${event.timestamp}-${i}`} event={event} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="pt-4 border-t border-white/5">
        <div className="text-xs text-zinc-700 mb-2">Event types</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {Object.entries(EVENT_STYLES).map(([type, style]) => (
            <div key={type} className="flex items-center gap-1.5 text-xs text-zinc-600">
              <span className={style.color}>{style.icon}</span>
              <span className="font-mono">{type.split(":")[1]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("contracts");
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState([]);
  const [sseConnected, setSseConnected] = useState(false);

  // Health polling
  useEffect(() => {
    const check = async () => {
      try {
        const data = await api("/health");
        setHealth(data);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  // SSE live event stream
  useEffect(() => {
    if (!connected) return;
    let es;
    try {
      es = new EventSource(`${BRIDGE_URL}/events`);
      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          // Skip the meta "connected" event
          if (event.payload?._meta === "connected") return;
          setLiveEvents(prev => [event, ...prev].slice(0, 50));
          // Refresh health on meaningful events
          if (["contract:resolved", "backend:registered", "frontend:registered"].includes(event.type)) {
            api("/health").then(setHealth).catch(() => {});
          }
        } catch {}
      };
    } catch {}
    return () => { es?.close(); setSseConnected(false); };
  }, [connected]);

  const tabs = [
    { id: "contracts", label: "Contracts", icon: <Icon.Bridge /> },
    { id: "services", label: "Services", icon: <Icon.Server /> },
    { id: "activity", label: "Live", icon: <Icon.Zap /> },
    { id: "keys", label: "API Keys", icon: <Icon.Key /> },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100" style={{
      fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
      backgroundImage: "radial-gradient(ellipse at 20% 50%, rgba(120,40,200,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(20,120,200,0.04) 0%, transparent 50%)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center">
              <Icon.Bridge />
            </div>
            <div>
              <div className="text-sm font-medium tracking-tight">WireBridge</div>
              <div className="text-xs text-zinc-600">runtime wiring layer</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Stats */}
            {connected && health && (
              <div className="hidden md:flex items-center gap-4 text-xs text-zinc-500">
                <span>{health.backends} backends</span>
                <span className="text-zinc-700">·</span>
                <span>{health.frontends} frontends</span>
                <span className="text-zinc-700">·</span>
                <span>{health.contracts} contracts</span>
              </div>
            )}

            {/* Connection status */}
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              connected
                ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                : "text-red-400 border-red-500/20 bg-red-500/5"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              {connected ? "bridge online" : "bridge offline"}
            </div>
            {sseConnected && (
              <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border text-violet-400 border-violet-500/20 bg-violet-500/5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                live
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Offline notice */}
        {!connected && (
          <div className="mb-6 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-300/80 text-sm">
            Bridge server is not running. Start it with{" "}
            <code className="font-mono bg-white/10 px-1 py-0.5 rounded text-xs">npm run dev</code>{" "}
            in the <code className="font-mono bg-white/10 px-1 py-0.5 rounded text-xs">core/</code> directory.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-white/5 pb-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-all border-b-2 -mb-px ${
                tab === t.id
                  ? "border-white/40 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "contracts" && <ContractsTab />}
        {tab === "services" && <ServicesTab />}
        {tab === "activity" && <ActivityTab events={liveEvents} sseConnected={sseConnected} />}
        {tab === "keys" && <KeysTab />}
      </div>
    </div>
  );
}
