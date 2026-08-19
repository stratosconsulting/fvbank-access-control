import { useState, useEffect, useMemo, useCallback } from "react";
import { LayoutGrid, Users, ScrollText, UserPlus, UserMinus, Pencil, RotateCcw, X, Check, Boxes, Trash2, Plus, Sun, Moon, AlertTriangle, LogOut } from "lucide-react";
import { supabase } from "./supabaseClient";

const THEME_KEY = "fvbank-theme-pref";
const LEVEL_PRESETS = ["Admin", "User"];

function nowStamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString("es-PR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function levelTone(level) {
  const l = (level || "").toLowerCase();
  if (l.includes("super admin") || l.includes("owner") || l.includes("approver")) return "gold";
  if (l.includes("admin")) return "navy";
  if (l.includes("viewer") || l.includes("user")) return "slate";
  return "teal";
}

function Badge({ level }) {
  const tone = levelTone(level);
  return <span className={`badge badge-${tone}`}>{level}</span>;
}

export default function App() {
  const [apps, setApps] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState("matrix");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [showOffboarded, setShowOffboarded] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [confirmOffboard, setConfirmOffboard] = useState(null);
  const [addingApp, setAddingApp] = useState(false);
  const [confirmDeleteApp, setConfirmDeleteApp] = useState(null);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState(null);
  const [theme, setTheme] = useState("light");
  const [toast, setToast] = useState(null);

  // Theme preference (real browser -> localStorage is fine here)
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  // Auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  const fetchAll = useCallback(async () => {
    const [{ data: appsData }, { data: employeesData }, { data: permsData }, { data: logData }] = await Promise.all([
      supabase.from("apps").select("*").order("name"),
      supabase.from("employees").select("*").order("name"),
      supabase.from("permissions").select("*"),
      supabase.from("audit_log").select("*").order("ts", { ascending: false }).limit(500),
    ]);
    const nextApps = (appsData || []).map((a) => ({ id: a.id, name: a.name, owner: a.owner || "Unassigned" }));
    const permsByEmp = {};
    (permsData || []).forEach((p) => {
      if (!permsByEmp[p.employee_id]) permsByEmp[p.employee_id] = [];
      permsByEmp[p.employee_id].push({ appId: p.app_id, level: p.level, _permId: p.id });
    });
    const nextEmployees = (employeesData || []).map((e) => ({
      id: e.id, name: e.name, department: e.department || "Unassigned", status: e.status,
      offboardedAt: e.offboarded_at, offboardReason: e.offboard_reason,
      permissions: permsByEmp[e.id] || [],
    }));
    const nextLog = (logData || []).map((l) => ({ id: l.id, ts: nowStamp(l.ts), actor: l.actor, action: l.action, detail: l.detail }));
    setApps(nextApps);
    setEmployees(nextEmployees);
    setAuditLog(nextLog);
    setReady(true);
  }, []);

  useEffect(() => {
    if (session) fetchAll();
  }, [session, fetchAll]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  async function logAudit(action, detail) {
    const actor = session?.user?.email || "Desconocido";
    const { data } = await supabase.from("audit_log").insert({ actor, action, detail }).select().single();
    const entry = data
      ? { id: data.id, ts: nowStamp(data.ts), actor, action, detail }
      : { id: "local-" + Date.now(), ts: nowStamp(), actor, action, detail };
    setAuditLog((log) => [entry, ...log]);
  }

  const departments = useMemo(() => {
    const set = new Set(employees.map((e) => e.department || "Unassigned"));
    return ["All", ...Array.from(set).sort()];
  }, [employees]);

  const appById = useMemo(() => Object.fromEntries(apps.map((a) => [a.id, a])), [apps]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (!showOffboarded && e.status === "offboarded") return false;
      if (deptFilter !== "All" && (e.department || "Unassigned") !== deptFilter) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [employees, deptFilter, search, showOffboarded]);

  const appsWithAnyPermission = useMemo(() => {
    const used = new Set();
    filteredEmployees.forEach((e) => e.permissions.forEach((p) => used.add(p.appId)));
    return apps.filter((a) => used.has(a.id));
  }, [apps, filteredEmployees]);

  const appEmployeeCounts = useMemo(() => {
    const counts = {};
    employees.forEach((e) => {
      if (e.status !== "active") return;
      e.permissions.forEach((p) => { counts[p.appId] = (counts[p.appId] || 0) + 1; });
    });
    return counts;
  }, [employees]);

  async function handleAddEmployee(name, department) {
    const { data, error } = await supabase.from("employees").insert({ name, department: department || "Unassigned", status: "active" }).select().single();
    if (error) { showToast("Error adding employee"); return; }
    setEmployees((prev) => [...prev, { id: data.id, name: data.name, department: data.department, status: data.status, permissions: [] }]);
    await logAudit("Employee added", `Added ${name} (${department || "Unassigned"}).`);
    setAddingEmployee(false);
    showToast(`${name} added`);
  }

  async function handleUpdatePermissions(empId, newPermissions, changeNote) {
    const emp = employees.find((e) => e.id === empId);
    const oldByApp = Object.fromEntries(emp.permissions.map((p) => [p.appId, p]));
    const newByApp = Object.fromEntries(newPermissions.map((p) => [p.appId, p]));
    const toInsert = newPermissions.filter((p) => !oldByApp[p.appId]);
    const toDelete = emp.permissions.filter((p) => !newByApp[p.appId]);
    const toUpdate = newPermissions.filter((p) => oldByApp[p.appId] && oldByApp[p.appId].level !== p.level);

    if (toInsert.length) await supabase.from("permissions").insert(toInsert.map((p) => ({ employee_id: empId, app_id: p.appId, level: p.level })));
    if (toDelete.length) await supabase.from("permissions").delete().in("id", toDelete.map((p) => p._permId));
    for (const p of toUpdate) {
      await supabase.from("permissions").update({ level: p.level }).eq("id", oldByApp[p.appId]._permId);
    }
    await fetchAll();
    await logAudit("Permission change", `${emp.name}: ${changeNote}`);
  }

  async function handleOffboard(empId, reason) {
    const emp = employees.find((e) => e.id === empId);
    const revokedApps = emp.permissions.map((p) => appById[p.appId]?.name || p.appId);
    await supabase.from("permissions").delete().eq("employee_id", empId);
    await supabase.from("employees").update({ status: "offboarded", offboarded_at: new Date().toISOString(), offboard_reason: reason || null }).eq("id", empId);
    await fetchAll();
    await logAudit("Employee offboarded", `${emp.name} was offboarded${reason ? ` (reason: ${reason})` : ""}. Revoked ${revokedApps.length} grant(s): ${revokedApps.join(", ") || "none"}.`);
    setConfirmOffboard(null);
    showToast(`${emp.name} offboarded`);
  }

  async function handleReactivate(empId) {
    const emp = employees.find((e) => e.id === empId);
    await supabase.from("employees").update({ status: "active", offboarded_at: null, offboard_reason: null }).eq("id", empId);
    await fetchAll();
    await logAudit("Reactivation", `${emp.name} reactivated. Their access grants need to be reassigned manually.`);
    showToast(`${emp.name} reactivated`);
  }

  async function handleDeleteEmployee(empId) {
    const emp = employees.find((e) => e.id === empId);
    await supabase.from("employees").delete().eq("id", empId);
    setEmployees((prev) => prev.filter((e) => e.id !== empId));
    await logAudit("Permanent deletion", `${emp.name} (${emp.department}) was permanently deleted from the registry by ${session?.user?.email || "a user"}. Their access history and record were erased; this log entry is the only remaining trace.`);
    setConfirmDeleteEmployee(null);
    showToast(`${emp.name} permanently deleted`);
  }

  async function handleAddApp(name, owner) {
    const { data, error } = await supabase.from("apps").insert({ name, owner: owner || "Unassigned" }).select().single();
    if (error) { showToast("Error adding application"); return; }
    setApps((prev) => [...prev, { id: data.id, name: data.name, owner: data.owner }]);
    await logAudit("Application added", `Added ${name}${owner ? ` (owner: ${owner})` : ""} to the catalog.`);
    setAddingApp(false);
    showToast(`${name} added`);
  }

  async function handleDeleteApp(appId) {
    const app = apps.find((a) => a.id === appId);
    const affected = employees.filter((e) => e.permissions.some((p) => p.appId === appId));
    await supabase.from("apps").delete().eq("id", appId);
    await fetchAll();
    await logAudit("Application removed", `${app.name} removed from the catalog.${affected.length ? ` Revoked access for ${affected.length} employee(s): ${affected.map((e) => e.name).join(", ")}.` : " No one had access assigned."}`);
    setConfirmDeleteApp(null);
    showToast(`${app.name} removed`);
  }

  if (!authReady) {
    return (
      <div style={{ padding: 40, fontFamily: "Inter, system-ui, sans-serif", color: "#5b6472" }}>
        Verifying session...
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (!ready) {
    return (
      <div style={{ padding: 40, fontFamily: "Inter, system-ui, sans-serif", color: "#5b6472" }}>
        Loading access registry...
      </div>
    );
  }

  const activeCount = employees.filter((e) => e.status === "active").length;
  const offboardedCount = employees.filter((e) => e.status === "offboarded").length;
  const totalGrants = employees.reduce((sum, e) => sum + e.permissions.length, 0);

  return (
    <div className="fv-root" data-theme={theme}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        .fv-root {
          --navy: #1F3A5C;
          --navy-hover: #0E2338;
          --surface-deep: #0E2338;
          --on-deep: #F1EFE6;
          --ink: #0E2338;
          --gold: #A9791E;
          --gold-soft: #F1E7CC;
          --gold-soft-text: #6E5115;
          --teal: #2B6E68;
          --teal-soft: #E1EFEE;
          --slate: #5B6472;
          --slate-soft: #EEEDE5;
          --navy-soft: #E4ECF5;
          --paper: #F7F6F1;
          --card: #FFFFFF;
          --hairline: #DDD8C9;
          --border: #E3E1D6;
          --text: #1C2530;
          --text-dim: #6B6558;
          --danger: #A13D2E;
          --danger-hover: #7E2F23;
          --danger-soft: #F3E2DD;
          --success: #2F6F4E;
          --success-soft: #E1EDE5;
          --row-alt: #FBFAF6;
          --row-hover: #F1ECDD;
          --overlay: rgba(14, 35, 56, 0.6);
          --ghost-hover: #EEF2F6;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: var(--paper);
          color: var(--text);
          min-height: 100%;
          padding: 28px;
          box-sizing: border-box;
          background-image: linear-gradient(var(--hairline) 1px, transparent 1px);
          background-size: 100% 32px;
          background-position: 0 128px;
          transition: background-color 0.2s ease, color 0.2s ease;
        }
        .fv-root[data-theme="dark"] {
          --navy: #6E9CD1;
          --navy-hover: #8FB4DE;
          --surface-deep: #0B1620;
          --on-deep: #E8EDF2;
          --ink: #E8EDF2;
          --gold: #E0B563;
          --gold-soft: #3C3117;
          --gold-soft-text: #E0B563;
          --teal: #6FC2B9;
          --teal-soft: #16302E;
          --slate: #9AA6B2;
          --slate-soft: #202832;
          --navy-soft: #1B2C40;
          --paper: #121A22;
          --card: #182029;
          --hairline: #2A333D;
          --border: #2A333D;
          --text: #DDE3E8;
          --text-dim: #8B96A1;
          --danger: #D9695A;
          --danger-hover: #C15546;
          --danger-soft: #3A2320;
          --success: #5FAE86;
          --success-soft: #1D3226;
          --row-alt: #161E27;
          --row-hover: #202B36;
          --overlay: rgba(4, 8, 12, 0.72);
          --ghost-hover: #1D2731;
        }
        .fv-root * { box-sizing: border-box; }
        .fv-header {
          display: flex; justify-content: space-between; align-items: flex-end;
          margin-bottom: 22px; flex-wrap: wrap; gap: 16px;
          padding-bottom: 18px;
          border-bottom: 3px double var(--navy);
        }
        .fv-title { display: flex; flex-direction: column; gap: 6px; }
        .fv-eyebrow {
          font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.16em;
          color: var(--gold); text-transform: uppercase; font-weight: 600;
        }
        .fv-h1 {
          font-family: 'Source Serif 4', Georgia, serif; font-size: 27px; font-weight: 600;
          color: var(--ink); margin: 0; letter-spacing: -0.005em;
        }
        .fv-header-right { display: flex; align-items: center; gap: 16px; }
        .fv-theme-toggle {
          display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: 4px; border: 1px solid var(--border);
          background: var(--card); color: var(--text-dim); cursor: pointer; flex-shrink: 0;
        }
        .fv-theme-toggle:hover { color: var(--ink); border-color: var(--navy); }
        .fv-stats { display: flex; gap: 10px; }
        .fv-stat {
          text-align: center; border: 1px solid var(--hairline); border-radius: 3px;
          padding: 7px 16px 8px; background: var(--card); position: relative;
        }
        .fv-stat::before {
          content: ""; position: absolute; top: 4px; left: 4px; right: 4px; bottom: 4px;
          border: 1px solid var(--border); border-radius: 2px; pointer-events: none;
        }
        .fv-stat-num { font-size: 19px; font-weight: 600; color: var(--ink); font-family: 'Source Serif 4', serif; }
        .fv-stat-label {
          font-size: 9.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;
          font-family: 'JetBrains Mono', monospace;
        }
        .fv-tabs { display: flex; gap: 2px; margin-bottom: 18px; border-bottom: 1px solid var(--hairline); }
        .fv-tab {
          display: flex; align-items: center; gap: 7px;
          padding: 10px 18px; font-size: 13px; font-weight: 600; color: var(--text-dim);
          background: none; border: none; cursor: pointer; border-bottom: 2px solid transparent;
          margin-bottom: -1px; transition: color 0.15s ease, border-color 0.15s ease;
        }
        .fv-tab svg { opacity: 0.75; }
        .fv-tab:hover { color: var(--ink); }
        .fv-tab.active { color: var(--ink); border-bottom-color: var(--gold); }
        .fv-tab.active svg { opacity: 1; color: var(--gold); }
        .fv-toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
        .fv-input, .fv-select {
          padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13.5px;
          background: var(--card); color: var(--text); font-family: inherit;
        }
        .fv-input:focus, .fv-select:focus { outline: none; border-color: var(--navy); }
        .fv-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 4px; border: 1px solid var(--navy); background: var(--navy);
          color: var(--fv-root, white); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          transition: background 0.15s ease;
        }
        .fv-root[data-theme="dark"] .fv-btn { color: #0B1620; }
        .fv-root:not([data-theme="dark"]) .fv-btn { color: #FFFFFF; }
        .fv-btn:hover { background: var(--navy-hover); }
        .fv-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .fv-btn-ghost {
          background: none; color: var(--navy); border: 1px solid var(--border);
        }
        .fv-btn-ghost:hover { border-color: var(--navy); background: var(--ghost-hover); }
        .fv-btn-danger { background: var(--danger); border-color: var(--danger); color: white; }
        .fv-btn-danger:hover { background: var(--danger-hover); }
        .fv-btn-sm { padding: 5px 10px; font-size: 12px; }
        .fv-checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); }
        .fv-card { background: var(--card); border: 1px solid var(--hairline); border-radius: 4px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
        .fv-table-wrap { overflow: auto; max-height: 70vh; }
        table.fv-matrix { border-collapse: collapse; font-size: 12.5px; white-space: nowrap; }
        table.fv-matrix th, table.fv-matrix td { border: 1px solid var(--hairline); padding: 7px 11px; text-align: left; }
        table.fv-matrix thead th {
          position: sticky; top: 0; background: var(--surface-deep); color: var(--on-deep); z-index: 2;
          font-weight: 600; font-size: 11px; font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.01em; box-shadow: 0 2px 0 rgba(0,0,0,0.15);
        }
        table.fv-matrix th.sticky-col, table.fv-matrix td.sticky-col {
          position: sticky; left: 0; background: var(--card); z-index: 1; font-weight: 600;
        }
        table.fv-matrix thead th.sticky-col { background: var(--surface-deep); z-index: 3; left: 0; }
        table.fv-matrix tr:nth-child(even) td:not(.sticky-col) { background: var(--row-alt); }
        table.fv-matrix tr:hover td:not(.sticky-col) { background: var(--row-hover); }
        table.fv-matrix td.dept-cell { color: var(--text-dim); font-size: 11.5px; font-style: italic; }
        table.fv-matrix tr.offboarded td { opacity: 0.4; text-decoration: line-through; }
        .badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 2px 9px 2px 7px; border-radius: 3px; font-size: 10.5px; font-weight: 600;
          white-space: nowrap; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.01em;
          border-left: 3px solid transparent;
        }
        .badge-navy { background: var(--navy-soft); color: var(--ink); border-left-color: var(--navy); }
        .badge-gold { background: var(--gold-soft); color: var(--gold-soft-text); border-left-color: var(--gold); }
        .badge-slate { background: var(--slate-soft); color: var(--slate); border-left-color: var(--slate); }
        .badge-teal { background: var(--teal-soft); color: var(--teal); border-left-color: var(--teal); }
        .fv-list-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .fv-list-table th {
          text-align: left; padding: 10px 14px; background: var(--surface-deep); color: var(--on-deep);
          font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-family: 'JetBrains Mono', monospace;
        }
        .fv-list-table td { padding: 11px 14px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
        .fv-list-table tr:hover td { background: var(--row-alt); }
        .status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
        .status-active { background: var(--success-soft); color: var(--success); }
        .status-offboarded { background: var(--danger-soft); color: var(--danger); }
        .fv-modal-overlay {
          position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center;
          justify-content: center; z-index: 50; padding: 20px;
        }
        .fv-modal {
          background: var(--card); border-radius: 6px; padding: 26px; width: 100%; max-width: 560px;
          max-height: 85vh; overflow: auto; box-shadow: 0 24px 64px rgba(0,0,0,0.4);
          border-top: 3px solid var(--navy);
        }
        .fv-modal h3 {
          margin: 0 0 4px 0; color: var(--ink); font-size: 18px;
          font-family: 'Source Serif 4', serif; font-weight: 600;
          display: flex; align-items: center; gap: 9px;
        }
        .fv-modal .fv-modal-sub { color: var(--text-dim); font-size: 12.5px; margin-bottom: 18px; line-height: 1.5; }
        .fv-field { margin-bottom: 14px; }
        .fv-field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'JetBrains Mono', monospace; }
        .fv-field .fv-input, .fv-field .fv-select { width: 100%; }
        .fv-perm-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--hairline); }
        .fv-perm-row .fv-perm-app { flex: 1; font-weight: 600; font-size: 13px; }
        .fv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--hairline); }
        .fv-empty { padding: 44px; text-align: center; color: var(--text-dim); font-size: 13.5px; font-style: italic; }
        .fv-toast {
          position: fixed; bottom: 24px; right: 24px; background: var(--surface-deep); color: var(--on-deep);
          padding: 12px 18px; border-radius: 5px; font-size: 13px; font-weight: 500; z-index: 100;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35); border-left: 3px solid var(--gold);
        }
        .fv-warning-box {
          background: var(--danger-soft); border: 1px solid var(--danger); border-radius: 5px;
          padding: 12px 14px; font-size: 12.5px; color: var(--danger); line-height: 1.5; margin-bottom: 14px;
        }
        .audit-entry-no { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-dim); white-space: nowrap; }
        .audit-time { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-dim); white-space: nowrap; }
        .audit-action { font-weight: 700; color: var(--ink); font-family: 'Source Serif 4', serif; font-size: 13.5px; }
      `}</style>

      <div className="fv-header">
        <div className="fv-title">
          <span className="fv-eyebrow">FV Bank Access Control</span>
          <h1 className="fv-h1">FV Bank — Admin Access Registry</h1>
        </div>
        <div className="fv-header-right">
          <button className="fv-theme-toggle" onClick={toggleTheme} title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button className="fv-theme-toggle" onClick={() => supabase.auth.signOut()} title={`Sign out (${session?.user?.email || ""})`}>
            <LogOut size={16} />
          </button>
          <div className="fv-stats">
            <div className="fv-stat">
              <div className="fv-stat-num">{activeCount}</div>
              <div className="fv-stat-label">Active</div>
            </div>
            <div className="fv-stat">
              <div className="fv-stat-num">{offboardedCount}</div>
              <div className="fv-stat-label">Offboarded</div>
            </div>
            <div className="fv-stat">
              <div className="fv-stat-num">{totalGrants}</div>
              <div className="fv-stat-label">Grants</div>
            </div>
            <div className="fv-stat">
              <div className="fv-stat-num">{apps.length}</div>
              <div className="fv-stat-label">Apps</div>
            </div>
          </div>
        </div>
      </div>

      <div className="fv-tabs">
        <button className={`fv-tab ${tab === "matrix" ? "active" : ""}`} onClick={() => setTab("matrix")}><LayoutGrid size={15} />Access Matrix</button>
        <button className={`fv-tab ${tab === "employees" ? "active" : ""}`} onClick={() => setTab("employees")}><Users size={15} />Employees</button>
        <button className={`fv-tab ${tab === "apps" ? "active" : ""}`} onClick={() => setTab("apps")}><Boxes size={15} />Applications</button>
        <button className={`fv-tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}><ScrollText size={15} />Audit Log</button>
      </div>

      <div className="fv-toolbar">
        <input className="fv-input" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select className="fv-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="fv-checkbox-label">
          <input type="checkbox" checked={showOffboarded} onChange={(e) => setShowOffboarded(e.target.checked)} />
          Show offboarded
        </label>
        {tab === "employees" && (
          <button className="fv-btn" style={{ marginLeft: "auto" }} onClick={() => setAddingEmployee(true)}><UserPlus size={14} />Add employee</button>
        )}
        {tab === "apps" && (
          <button className="fv-btn" style={{ marginLeft: "auto" }} onClick={() => setAddingApp(true)}><Plus size={14} />Add application</button>
        )}
      </div>

      {tab === "matrix" && (
        <div className="fv-card">
          <div className="fv-table-wrap">
            {filteredEmployees.length === 0 ? (
              <div className="fv-empty">No employees match this filter.</div>
            ) : (
              <table className="fv-matrix">
                <thead>
                  <tr>
                    <th className="sticky-col">Employee</th>
                    <th>Dept.</th>
                    {appsWithAnyPermission.map((a) => <th key={a.id} title={`Owner: ${a.owner}`}>{a.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((e) => (
                    <tr key={e.id} className={e.status === "offboarded" ? "offboarded" : ""}>
                      <td className="sticky-col">{e.name}{e.status === "offboarded" ? " (offboarded)" : ""}</td>
                      <td className="dept-cell">{e.department}</td>
                      {appsWithAnyPermission.map((a) => {
                        const perm = e.permissions.find((p) => p.appId === a.id);
                        return <td key={a.id}>{perm ? <Badge level={perm.level} /> : <span style={{ color: "#D0D5DD" }}>—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "employees" && (
        <div className="fv-card">
          <table className="fv-list-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Status</th>
                <th>Active grants</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={5} className="fv-empty">No employees match this filter.</td></tr>
              ) : filteredEmployees.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td>{e.department}</td>
                  <td>
                    <span className={`status-pill ${e.status === "active" ? "status-active" : "status-offboarded"}`}>
                      {e.status === "active" ? <Check size={11} /> : <X size={11} />}
                      {e.status === "active" ? "Active" : "Offboarded"}
                    </span>
                  </td>
                  <td>{e.permissions.length}</td>
                  <td>
                    {e.status === "active" ? (
                      <>
                        <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setEditingEmployee(e.id)}><Pencil size={12} />Edit permissions</button>{" "}
                        <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => setConfirmOffboard(e.id)}><UserMinus size={12} />Offboard</button>{" "}
                      </>
                    ) : (
                      <>
                        <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => handleReactivate(e.id)}><RotateCcw size={12} />Reactivate</button>{" "}
                      </>
                    )}
                    <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setConfirmDeleteEmployee(e.id)} style={{ color: "var(--danger)", borderColor: "var(--danger-soft)" }}><Trash2 size={12} />Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "apps" && (
        <div className="fv-card">
          <table className="fv-list-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Owner</th>
                <th>Employees with access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.length === 0 ? (
                <tr><td colSpan={4} className="fv-empty">No applications in the catalog.</td></tr>
              ) : apps.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{a.owner}</td>
                  <td>{appEmployeeCounts[a.id] || 0}</td>
                  <td>
                    <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => setConfirmDeleteApp(a.id)}><Trash2 size={12} />Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="fv-card">
          <table className="fv-list-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Entry</th>
                <th style={{ width: 150 }}>Date/Time</th>
                <th style={{ width: 160 }}>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 ? (
                <tr><td colSpan={4} className="fv-empty">No activity recorded yet.</td></tr>
              ) : auditLog.map((entry, i) => (
                <tr key={entry.id}>
                  <td className="audit-entry-no">No. {String(auditLog.length - i).padStart(3, "0")}</td>
                  <td className="audit-time">{entry.ts}</td>
                  <td className="audit-action">{entry.action}</td>
                  <td>{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingEmployee && (
        <EditPermissionsModal
          employee={employees.find((e) => e.id === editingEmployee)}
          apps={apps}
          onClose={() => setEditingEmployee(null)}
          onSave={(perms, note) => {
            handleUpdatePermissions(editingEmployee, perms, note);
            setEditingEmployee(null);
          }}
        />
      )}

      {addingEmployee && (
        <AddEmployeeModal
          departments={departments.filter((d) => d !== "All")}
          onClose={() => setAddingEmployee(false)}
          onAdd={handleAddEmployee}
        />
      )}

      {confirmOffboard && (
        <OffboardModal
          employee={employees.find((e) => e.id === confirmOffboard)}
          onClose={() => setConfirmOffboard(null)}
          onConfirm={(reason) => handleOffboard(confirmOffboard, reason)}
        />
      )}

      {addingApp && (
        <AddAppModal onClose={() => setAddingApp(false)} onAdd={handleAddApp} />
      )}

      {confirmDeleteApp && (
        <DeleteAppModal
          app={apps.find((a) => a.id === confirmDeleteApp)}
          affectedCount={appEmployeeCounts[confirmDeleteApp] || 0}
          onClose={() => setConfirmDeleteApp(null)}
          onConfirm={() => handleDeleteApp(confirmDeleteApp)}
        />
      )}

      {confirmDeleteEmployee && (
        <DeleteEmployeeModal
          employee={employees.find((e) => e.id === confirmDeleteEmployee)}
          onClose={() => setConfirmDeleteEmployee(null)}
          onConfirm={() => handleDeleteEmployee(confirmDeleteEmployee)}
        />
      )}

      {toast && <div className="fv-toast">{toast}</div>}
    </div>
  );
}

function EditPermissionsModal({ employee, apps, onClose, onSave }) {
  const [perms, setPerms] = useState(employee.permissions.map((p) => ({ ...p })));
  const [newAppId, setNewAppId] = useState(apps[0]?.id || "");
  const [newLevel, setNewLevel] = useState("Admin");
  const [changes, setChanges] = useState([]);

  const appById = Object.fromEntries(apps.map((a) => [a.id, a]));
  const availableApps = apps.filter((a) => !perms.some((p) => p.appId === a.id));

  function levelOptionsFor(currentValue) {
    return LEVEL_PRESETS.includes(currentValue) ? LEVEL_PRESETS : [currentValue, ...LEVEL_PRESETS];
  }

  function addPerm() {
    if (!newAppId) return;
    setPerms([...perms, { appId: newAppId, level: newLevel }]);
    setChanges([...changes, `+ ${appById[newAppId]?.name} → ${newLevel}`]);
    setNewLevel("Admin");
  }
  function removePerm(appId) {
    const p = perms.find((x) => x.appId === appId);
    setPerms(perms.filter((x) => x.appId !== appId));
    setChanges([...changes, `- ${appById[appId]?.name} (${p.level}) revocado`]);
  }
  function changeLevel(appId, level) {
    const old = perms.find((p) => p.appId === appId)?.level;
    setPerms(perms.map((p) => (p.appId === appId ? { ...p, level } : p)));
    setChanges([...changes, `${appById[appId]?.name}: ${old} → ${level}`]);
  }
  function handleSave() {
    const note = changes.length ? changes.join("; ") : "No changes to access.";
    onSave(perms, note);
  }

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()}>
        <h3><Pencil size={16} />Permissions for {employee.name}</h3>
        <div className="fv-modal-sub">{employee.department} · {perms.length} active grant(s)</div>

        {perms.map((p) => (
          <div className="fv-perm-row" key={p.appId}>
            <span className="fv-perm-app">{appById[p.appId]?.name || p.appId}</span>
            <select
              className="fv-select"
              value={p.level}
              onChange={(e) => changeLevel(p.appId, e.target.value)}
              style={{ width: 160 }}
            >
              {levelOptionsFor(p.level).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => removePerm(p.appId)}><X size={12} />Revoke</button>
          </div>
        ))}
        {perms.length === 0 && <div style={{ color: "#98A2B3", fontSize: 13, padding: "8px 0" }}>No access assigned.</div>}

        <div className="fv-field" style={{ marginTop: 16 }}>
          <label>Add access</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="fv-select" value={newAppId} onChange={(e) => setNewAppId(e.target.value)} style={{ flex: 1 }}>
              {availableApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="fv-select" value={newLevel} onChange={(e) => setNewLevel(e.target.value)} style={{ width: 150 }}>
              {LEVEL_PRESETS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className="fv-btn fv-btn-sm" onClick={addPerm} disabled={!availableApps.length}>Add</button>
          </div>
        </div>

        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" onClick={handleSave}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function AddEmployeeModal({ departments, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState(departments[0] || "");
  const [customDept, setCustomDept] = useState("");
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3><UserPlus size={16} />Add employee</h3>
        <div className="fv-modal-sub">Will be created with no access assigned.</div>
        <div className="fv-field">
          <label>Full name</label>
          <input className="fv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" />
        </div>
        <div className="fv-field">
          <label>Department</label>
          <select className="fv-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            <option value="__custom__">Other...</option>
          </select>
          {department === "__custom__" && (
            <input className="fv-input" style={{ marginTop: 8 }} value={customDept} onChange={(e) => setCustomDept(e.target.value)} placeholder="Department name" />
          )}
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="fv-btn"
            disabled={!name.trim()}
            onClick={() => onAdd(name.trim(), department === "__custom__" ? customDept.trim() : department)}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function OffboardModal({ employee, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3><UserMinus size={16} />Offboard {employee.name}</h3>
        <div className="fv-modal-sub">
          This will revoke their {employee.permissions.length} active grant(s) and will be recorded in the audit log. Their history isn't erased.
        </div>
        <div className="fv-field">
          <label>Reason (optional)</label>
          <select className="fv-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Unspecified</option>
            <option value="Resignation">Resignation</option>
            <option value="Termination">Termination</option>
            <option value="Transfer">Transferred to another entity</option>
          </select>
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn fv-btn-danger" onClick={() => onConfirm(reason)}><UserMinus size={13} />Confirm offboarding</button>
        </div>
      </div>
    </div>
  );
}

function AddAppModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3><Plus size={16} />Add application</h3>
        <div className="fv-modal-sub">Added to the catalog with no access assigned yet.</div>
        <div className="fv-field">
          <label>Application name</label>
          <input className="fv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g. DocuSign" />
        </div>
        <div className="fv-field">
          <label>Owner (optional)</label>
          <input className="fv-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="E.g. IT" />
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" disabled={!name.trim()} onClick={() => onAdd(name.trim(), owner.trim())}>Add</button>
        </div>
      </div>
    </div>
  );
}

function DeleteEmployeeModal({ employee, onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText.trim().toLowerCase() === employee.name.trim().toLowerCase();
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, borderTopColor: "var(--danger)" }}>
        <h3 style={{ color: "var(--danger)" }}><AlertTriangle size={16} />Delete permanently</h3>
        <div className="fv-warning-box">
          This permanently erases {employee.name}'s record and access history — it can't be undone, and unlike "Offboard", no editable history is kept. Only one audit log entry will remain, noting that {employee.name} was deleted and by whom.
        </div>
        <div className="fv-field">
          <label>Type "{employee.name}" to confirm</label>
          <input className="fv-input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={employee.name} />
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn fv-btn-danger" disabled={!matches} onClick={onConfirm}><Trash2 size={13} />Delete permanently</button>
        </div>
      </div>
    </div>
  );
}

function DeleteAppModal({ app, affectedCount, onClose, onConfirm }) {
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3><Trash2 size={16} />Delete {app.name}</h3>
        <div className="fv-modal-sub">
          {affectedCount > 0
            ? `${affectedCount} active employee(s) currently have access to this application. Deleting it will automatically revoke that access and it will be recorded in the audit log.`
            : "No active employee currently has access to this application."}
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn fv-btn-danger" onClick={onConfirm}><Trash2 size={13} />Confirm deletion</button>
        </div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("Incorrect email or password.");
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#F7F6F1", fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "#FFFFFF", border: "1px solid #E3E1D6", borderTop: "3px solid #1F3A5C",
        borderRadius: 6, padding: 32, width: 320, boxShadow: "0 24px 64px rgba(0,0,0,0.12)",
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: "0.16em", color: "#A9791E", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
          FV Bank Access Control
        </div>
        <h2 style={{ margin: "0 0 20px 0", fontFamily: "'Source Serif 4', Georgia, serif", color: "#0E2338", fontSize: 20 }}>
          FV Bank — Sign in
        </h2>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B6558", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E3E1D6", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B6558", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #E3E1D6", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" }} />
        </div>
        {error && <div style={{ color: "#A13D2E", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={loading} style={{
          width: "100%", padding: "10px 14px", borderRadius: 4, border: "1px solid #1F3A5C", background: "#1F3A5C",
          color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div style={{ fontSize: 11.5, color: "#8B96A1", marginTop: 14, lineHeight: 1.5 }}>
          Users are created from the Supabase dashboard (Authentication → Users) — there's no public sign-up.
        </div>
      </form>
    </div>
  );
}
