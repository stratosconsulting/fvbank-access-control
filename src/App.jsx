import { useState, useEffect, useMemo, useCallback } from "react";
import { LayoutGrid, Users, ScrollText, UserPlus, UserMinus, Pencil, RotateCcw, X, Check, Boxes, Trash2, Plus, Sun, Moon, AlertTriangle, LogOut, UserCog, ShieldCheck, ShieldOff, Building2, ListPlus, ListChecks, Bot, Laptop } from "lucide-react";
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
  const [deptDefaults, setDeptDefaults] = useState({});
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState("matrix");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [confirmOffboard, setConfirmOffboard] = useState(null);
  const [addingApp, setAddingApp] = useState(false);
  const [confirmDeleteApp, setConfirmDeleteApp] = useState(null);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState(null);
  const [editingEmployeeInfo, setEditingEmployeeInfo] = useState(null);
  const [managingDepartments, setManagingDepartments] = useState(false);
  const [editingAppLevels, setEditingAppLevels] = useState(null);
  const [editingDeptDefaults, setEditingDeptDefaults] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmBulkOffboard, setConfirmBulkOffboard] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [grantAppId, setGrantAppId] = useState("");
  const [grantLevel, setGrantLevel] = useState("");
  const [grantSelected, setGrantSelected] = useState([]);
  const [grantSearch, setGrantSearch] = useState("");
  const [grantDeptFilter, setGrantDeptFilter] = useState("All");
  const [serviceAccounts, setServiceAccounts] = useState([]);
  const [addingServiceAccount, setAddingServiceAccount] = useState(false);
  const [editingServiceAccount, setEditingServiceAccount] = useState(null);
  const [confirmDeleteServiceAccount, setConfirmDeleteServiceAccount] = useState(null);
  const [editingAppName, setEditingAppName] = useState(null);
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
    const [{ data: appsData }, { data: employeesData }, { data: permsData }, { data: logData }, { data: deptDefData }, { data: svcData }, { data: equipData }] = await Promise.all([
      supabase.from("apps").select("*").order("name"),
      supabase.from("employees").select("*").order("name"),
      supabase.from("permissions").select("*"),
      supabase.from("audit_log").select("*").order("ts", { ascending: false }).limit(500),
      supabase.from("department_defaults").select("*"),
      supabase.from("service_accounts").select("*").order("name"),
      // Equipment assigned in the STRATOS inventory (mirrored, read-only here)
      supabase.from("employee_assets").select("*").order("asset_name"),
    ]);
    const equipByEmp = {};
    (equipData || []).forEach((a) => {
      if (!equipByEmp[a.employee_id]) equipByEmp[a.employee_id] = [];
      equipByEmp[a.employee_id].push({ id: a.asset_id, name: a.asset_name, type: a.hardware_type || "", model: a.model || "", serial: a.serial || "", status: a.status || "" });
    });
    const nextApps = (appsData || []).map((a) => ({ id: a.id, name: a.name, owner: a.owner || "Unassigned", levels: (a.levels && a.levels.length ? a.levels : ["Admin", "User"]) }));
    const permsByEmp = {};
    (permsData || []).forEach((p) => {
      if (!permsByEmp[p.employee_id]) permsByEmp[p.employee_id] = [];
      permsByEmp[p.employee_id].push({ appId: p.app_id, level: p.level, notes: p.notes || "", _permId: p.id });
    });
    const nextEmployees = (employeesData || []).map((e) => ({
      id: e.id, name: e.name, email: e.email || "", department: e.department || "Unassigned", status: e.status,
      offboardedAt: e.offboarded_at, offboardReason: e.offboard_reason, google2fa: !!e.google_2fa_enabled,
      location: e.location || "",
      permissions: permsByEmp[e.id] || [],
      equipment: equipByEmp[e.id] || [],
    }));
    const nextLog = (logData || []).map((l) => ({ id: l.id, ts: nowStamp(l.ts), actor: l.actor, action: l.action, detail: l.detail }));
    const nextDeptDefaults = {};
    (deptDefData || []).forEach((d) => {
      if (!nextDeptDefaults[d.department]) nextDeptDefaults[d.department] = [];
      nextDeptDefaults[d.department].push({ appId: d.app_id, level: d.level });
    });
    const nextServiceAccounts = (svcData || []).map((s) => ({
      id: s.id, name: s.name, description: s.description || "", owner: s.owner || "", appId: s.app_id || "", status: s.status,
    }));
    setApps(nextApps);
    setEmployees(nextEmployees);
    setAuditLog(nextLog);
    setDeptDefaults(nextDeptDefaults);
    setServiceAccounts(nextServiceAccounts);
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
      if (statusFilter === "active" && e.status !== "active") return false;
      if (statusFilter === "offboarded" && e.status !== "offboarded") return false;
      if (deptFilter !== "All" && (e.department || "Unassigned") !== deptFilter) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [employees, deptFilter, search, statusFilter]);

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

  async function handleAddEmployee(name, department, email, google2fa, location) {
    const { data, error } = await supabase.from("employees").insert({ name, department: department || "Unassigned", status: "active", email: email || null, google_2fa_enabled: !!google2fa, location: location || null }).select().single();
    if (error) { showToast("Error adding employee"); return; }
    setEmployees((prev) => [...prev, { id: data.id, name: data.name, email: data.email || "", department: data.department, status: data.status, google2fa: !!data.google_2fa_enabled, location: data.location || "", permissions: [] }]);
    await logAudit("Employee added", `Added ${name} (${department || "Unassigned"})${email ? ` — ${email}` : ""}${location ? `, location: ${location}` : ""}. 2FA: ${google2fa ? "enabled" : "not enabled"}.`);
    setAddingEmployee(false);
    showToast(`${name} added`);
  }

  async function handleUpdatePermissions(empId, newPermissions, changeNote) {
    const emp = employees.find((e) => e.id === empId);
    const oldByApp = Object.fromEntries(emp.permissions.map((p) => [p.appId, p]));
    const newByApp = Object.fromEntries(newPermissions.map((p) => [p.appId, p]));
    const toInsert = newPermissions.filter((p) => !oldByApp[p.appId]);
    const toDelete = emp.permissions.filter((p) => !newByApp[p.appId]);
    const toUpdate = newPermissions.filter((p) => oldByApp[p.appId] && (oldByApp[p.appId].level !== p.level || (oldByApp[p.appId].notes || "") !== (p.notes || "")));

    if (toInsert.length) await supabase.from("permissions").insert(toInsert.map((p) => ({ employee_id: empId, app_id: p.appId, level: p.level, notes: p.notes || null })));
    if (toDelete.length) await supabase.from("permissions").delete().in("id", toDelete.map((p) => p._permId));
    for (const p of toUpdate) {
      await supabase.from("permissions").update({ level: p.level, notes: p.notes || null }).eq("id", oldByApp[p.appId]._permId);
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
    showToast(emp.equipment.length ? `${emp.name} offboarded · ${emp.equipment.length} device(s) released in the inventory` : `${emp.name} offboarded`);
    if (emp.equipment.length) setTimeout(fetchAll, 2500);
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

  async function handleEditEmployeeInfo(empId, name, department, email, google2fa, location) {
    const emp = employees.find((e) => e.id === empId);
    const changes = [];
    if (name !== emp.name) changes.push(`name: "${emp.name}" → "${name}"`);
    if (department !== emp.department) changes.push(`department: "${emp.department}" → "${department}"`);
    if ((email || "") !== (emp.email || "")) changes.push(`email: "${emp.email || "—"}" → "${email || "—"}"`);
    if ((location || "") !== (emp.location || "")) changes.push(`location: "${emp.location || "—"}" → "${location || "—"}"`);
    if (!!google2fa !== !!emp.google2fa) changes.push(`Google 2FA: ${emp.google2fa ? "enabled" : "not enabled"} → ${google2fa ? "enabled" : "not enabled"}`);
    if (!changes.length) { setEditingEmployeeInfo(null); return; }
    await supabase.from("employees").update({ name, department, email: email || null, google_2fa_enabled: !!google2fa, location: location || null }).eq("id", empId);
    setEmployees((prev) => prev.map((e) => (e.id === empId ? { ...e, name, department, email, google2fa: !!google2fa, location } : e)));
    await logAudit("Employee info updated", `${emp.name}: ${changes.join(", ")}`);
    setEditingEmployeeInfo(null);
    showToast("Employee updated");
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleSelectAll(ids) {
    setSelectedIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  }

  async function handleBulkOffboard(reason) {
    const targets = employees.filter((e) => selectedIds.includes(e.id) && e.status === "active");
    for (const emp of targets) {
      await supabase.from("permissions").delete().eq("employee_id", emp.id);
      await supabase.from("employees").update({ status: "offboarded", offboarded_at: new Date().toISOString(), offboard_reason: reason || null }).eq("id", emp.id);
    }
    await fetchAll();
    await logAudit("Bulk offboard", `Offboarded ${targets.length} employee(s)${reason ? ` (reason: ${reason})` : ""}: ${targets.map((e) => e.name).join(", ")}.`);
    setConfirmBulkOffboard(false);
    setSelectedIds([]);
    showToast(`${targets.length} employee(s) offboarded`);
    if (targets.some((e) => e.equipment.length)) setTimeout(fetchAll, 2500);
  }

  async function handleBulkDelete() {
    const targets = employees.filter((e) => selectedIds.includes(e.id));
    for (const emp of targets) {
      await supabase.from("employees").delete().eq("id", emp.id);
    }
    setEmployees((prev) => prev.filter((e) => !selectedIds.includes(e.id)));
    await logAudit("Bulk permanent deletion", `${targets.length} employee(s) permanently deleted by ${session?.user?.email || "a user"}: ${targets.map((e) => e.name).join(", ")}. Only this log entry remains.`);
    setConfirmBulkDelete(false);
    setSelectedIds([]);
    showToast(`${targets.length} employee(s) permanently deleted`);
  }

  async function handleApplyDeptDefaultsBulk() {
    const targets = employees.filter((e) => selectedIds.includes(e.id) && e.status === "active");
    let totalGrants = 0;
    for (const emp of targets) {
      const companyWide = deptDefaults["*"] || [];
      const deptSpecific = deptDefaults[emp.department] || [];
      const merged = {};
      companyWide.forEach((d) => { merged[d.appId] = d.level; });
      deptSpecific.forEach((d) => { merged[d.appId] = d.level; }); // dept-specific wins on conflict
      const defaults = Object.entries(merged).map(([appId, level]) => ({ appId, level }));
      const existingAppIds = new Set(emp.permissions.map((p) => p.appId));
      const toInsert = defaults.filter((d) => !existingAppIds.has(d.appId));
      if (toInsert.length) {
        await supabase.from("permissions").insert(toInsert.map((d) => ({ employee_id: emp.id, app_id: d.appId, level: d.level })));
        totalGrants += toInsert.length;
      }
    }
    await fetchAll();
    await logAudit("Applied department defaults", `Applied company-wide + department default access to ${targets.length} employee(s), granting ${totalGrants} new access(es) total.`);
    setSelectedIds([]);
    showToast(`Defaults applied to ${targets.length} employee(s)`);
  }

  async function handleSaveDeptDefaults(department, list) {
    await supabase.from("department_defaults").delete().eq("department", department);
    if (list.length) {
      await supabase.from("department_defaults").insert(list.map((d) => ({ department, app_id: d.appId, level: d.level })));
    }
    await fetchAll();
    await logAudit("Department defaults updated", `${department}: set to [${list.map((d) => `${appById[d.appId]?.name || d.appId} (${d.level})`).join(", ") || "none"}].`);
    setEditingDeptDefaults(null);
    showToast(`${department} defaults saved`);
  }

  async function handleBulkGrant() {
    const app = appById[grantAppId];
    if (!app || !grantLevel || !grantSelected.length) return;
    const targets = employees.filter((e) => grantSelected.includes(e.id));
    let inserted = 0, updated = 0;
    for (const emp of targets) {
      const existing = emp.permissions.find((p) => p.appId === grantAppId);
      if (existing) {
        if (existing.level !== grantLevel) {
          await supabase.from("permissions").update({ level: grantLevel }).eq("id", existing._permId);
          updated++;
        }
      } else {
        await supabase.from("permissions").insert({ employee_id: emp.id, app_id: grantAppId, level: grantLevel });
        inserted++;
      }
    }
    await fetchAll();
    await logAudit("Bulk grant", `${app.name} → ${grantLevel}: granted to ${inserted} new employee(s), updated ${updated} existing grant(s). Total selected: ${targets.length}.`);
    setGrantSelected([]);
    showToast(`${app.name}: ${inserted + updated} employee(s) updated`);
  }

  async function handleBulkRevokeGrant() {
    const app = appById[grantAppId];
    if (!app || !grantSelected.length) return;
    const targets = employees.filter((e) => grantSelected.includes(e.id) && e.permissions.some((p) => p.appId === grantAppId));
    const permIds = targets.flatMap((e) => e.permissions.filter((p) => p.appId === grantAppId).map((p) => p._permId));
    if (permIds.length) await supabase.from("permissions").delete().in("id", permIds);
    await fetchAll();
    await logAudit("Bulk revoke", `${app.name}: revoked from ${targets.length} employee(s): ${targets.map((e) => e.name).join(", ")}.`);
    setGrantSelected([]);
    showToast(`${app.name}: revoked from ${targets.length} employee(s)`);
  }

  async function handleAddServiceAccount(name, description, owner, appId) {
    const { data, error } = await supabase.from("service_accounts").insert({ name, description: description || null, owner: owner || null, app_id: appId || null, status: "active" }).select().single();
    if (error) { showToast("Error adding service account"); return; }
    setServiceAccounts((prev) => [...prev, { id: data.id, name: data.name, description: data.description || "", owner: data.owner || "", appId: data.app_id || "", status: data.status }]);
    await logAudit("Service account added", `Added ${name}${owner ? ` (owner: ${owner})` : ""}${appId ? `, associated app: ${appById[appId]?.name}` : ""}.`);
    setAddingServiceAccount(false);
    showToast(`${name} added`);
  }

  async function handleEditServiceAccount(id, name, description, owner, appId, status) {
    const svc = serviceAccounts.find((s) => s.id === id);
    const changes = [];
    if (name !== svc.name) changes.push(`name: "${svc.name}" → "${name}"`);
    if ((owner || "") !== (svc.owner || "")) changes.push(`owner: "${svc.owner || "—"}" → "${owner || "—"}"`);
    if ((appId || "") !== (svc.appId || "")) changes.push(`app: "${appById[svc.appId]?.name || "—"}" → "${appById[appId]?.name || "—"}"`);
    if (status !== svc.status) changes.push(`status: ${svc.status} → ${status}`);
    if ((description || "") !== (svc.description || "")) changes.push(`description updated`);
    if (!changes.length) { setEditingServiceAccount(null); return; }
    await supabase.from("service_accounts").update({ name, description: description || null, owner: owner || null, app_id: appId || null, status }).eq("id", id);
    setServiceAccounts((prev) => prev.map((s) => (s.id === id ? { ...s, name, description, owner, appId, status } : s)));
    await logAudit("Service account updated", `${svc.name}: ${changes.join(", ")}`);
    setEditingServiceAccount(null);
    showToast("Service account updated");
  }

  async function handleDeleteServiceAccount(id) {
    const svc = serviceAccounts.find((s) => s.id === id);
    await supabase.from("service_accounts").delete().eq("id", id);
    setServiceAccounts((prev) => prev.filter((s) => s.id !== id));
    await logAudit("Service account deleted", `${svc.name} removed from the registry.`);
    setConfirmDeleteServiceAccount(null);
    showToast(`${svc.name} deleted`);
  }

  async function handleRenameApp(appId, name, owner) {
    const app = apps.find((a) => a.id === appId);
    const changes = [];
    if (name !== app.name) changes.push(`name: "${app.name}" → "${name}"`);
    if (owner !== app.owner) changes.push(`owner: "${app.owner}" → "${owner}"`);
    if (!changes.length) { setEditingAppName(null); return; }
    await supabase.from("apps").update({ name, owner }).eq("id", appId);
    setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, name, owner } : a)));
    await logAudit("Application renamed", `${app.name}: ${changes.join(", ")}`);
    setEditingAppName(null);
    showToast("Application updated");
  }

  async function handleRenameDepartments(renames) {
    // renames: array of { from, to } where "to" differs from "from"
    const applied = renames.filter((r) => r.to.trim() && r.to.trim() !== r.from);
    if (!applied.length) { setManagingDepartments(false); return; }
    for (const r of applied) {
      await supabase.from("employees").update({ department: r.to.trim() }).eq("department", r.from);
    }
    await fetchAll();
    await logAudit("Departments renamed", applied.map((r) => `"${r.from}" → "${r.to.trim()}"`).join(", "));
    setManagingDepartments(false);
    showToast("Departments updated");
  }

  async function handleUpdateAppLevels(appId, levels) {
    const app = apps.find((a) => a.id === appId);
    const cleanLevels = levels.map((l) => l.trim()).filter(Boolean);
    if (!cleanLevels.length) { showToast("Keep at least one level"); return; }
    await supabase.from("apps").update({ levels: cleanLevels }).eq("id", appId);
    setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, levels: cleanLevels } : a)));
    await logAudit("Application levels updated", `${app.name}: [${(app.levels || []).join(", ")}] → [${cleanLevels.join(", ")}]`);
    setEditingAppLevels(null);
    showToast(`${app.name} levels updated`);
  }

  async function handleAddApp(name, owner) {
    const { data, error } = await supabase.from("apps").insert({ name, owner: owner || "Unassigned" }).select().single();
    if (error) { showToast("Error adding application"); return; }
    setApps((prev) => [...prev, { id: data.id, name: data.name, owner: data.owner, levels: (data.levels && data.levels.length ? data.levels : ["Admin", "User"]) }]);
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
          --btn-solid-text: #FFFFFF;
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
          --btn-solid-text: #0B1620;
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
          color: var(--btn-solid-text); font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          transition: background 0.15s ease;
        }
        .fv-btn:hover { background: var(--navy-hover); }
        .fv-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .fv-btn-ghost {
          background: none; color: var(--navy); border: 1px solid var(--border);
        }
        .fv-btn-ghost:hover { border-color: var(--navy); background: var(--ghost-hover); }
        .fv-btn-danger { background: var(--danger); border-color: var(--danger); color: var(--btn-solid-text); }
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
        .fv-equip-box {
          background: var(--surface-alt, rgba(127,127,127,0.08)); border: 1px solid var(--gold); border-radius: 5px;
          padding: 10px 12px; font-size: 12.5px; color: var(--ink); line-height: 1.5; margin-bottom: 14px;
          display: block;
        }
        .fv-equip-box svg { vertical-align: -2px; margin-right: 4px; }
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
        <button className={`fv-tab ${tab === "grant" ? "active" : ""}`} onClick={() => setTab("grant")}><ListChecks size={15} />Bulk Grant</button>
        <button className={`fv-tab ${tab === "service" ? "active" : ""}`} onClick={() => setTab("service")}><Bot size={15} />Service Accounts</button>
        <button className={`fv-tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}><ScrollText size={15} />Audit Log</button>
      </div>

      {tab !== "grant" && tab !== "service" && (
      <div className="fv-toolbar">
        <input className="fv-input" placeholder="Search employee..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select className="fv-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="fv-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">Active only</option>
          <option value="offboarded">Offboarded only</option>
          <option value="all">All statuses</option>
        </select>
        {tab === "employees" && (
          <>
            <button className="fv-btn fv-btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setManagingDepartments(true)}><Building2 size={14} />Manage departments</button>
            <button className="fv-btn" onClick={() => setAddingEmployee(true)}><UserPlus size={14} />Add employee</button>
          </>
        )}
        {tab === "apps" && (
          <button className="fv-btn" style={{ marginLeft: "auto" }} onClick={() => setAddingApp(true)}><Plus size={14} />Add application</button>
        )}
      </div>
      )}

      {tab === "service" && (
      <div className="fv-toolbar">
        <button className="fv-btn" style={{ marginLeft: "auto" }} onClick={() => setAddingServiceAccount(true)}><Plus size={14} />Add service account</button>
      </div>
      )}

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
          {selectedIds.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--gold-soft)", borderBottom: "1px solid var(--hairline)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gold-soft-text)" }}>{selectedIds.length} selected</span>
              <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={handleApplyDeptDefaultsBulk}><ListPlus size={12} />Apply department defaults</button>
              <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => setConfirmBulkOffboard(true)}><UserMinus size={12} />Offboard selected</button>
              <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setConfirmBulkDelete(true)} style={{ color: "var(--danger)", borderColor: "var(--danger-soft)" }}><Trash2 size={12} />Delete selected</button>
              <button className="fv-btn fv-btn-ghost fv-btn-sm" style={{ marginLeft: "auto" }} onClick={() => setSelectedIds([])}>Clear selection</button>
            </div>
          )}
          <table className="fv-list-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filteredEmployees.length > 0 && filteredEmployees.every((e) => selectedIds.includes(e.id))}
                    onChange={() => toggleSelectAll(filteredEmployees.map((e) => e.id))}
                  />
                </th>
                <th>Employee</th>
                <th>Department</th>
                <th>Location</th>
                <th>Status</th>
                <th>Active grants</th>
                <th>Equipment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr><td colSpan={8} className="fv-empty">No employees match this filter.</td></tr>
              ) : filteredEmployees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    {e.email && <div style={{ fontSize: 11.5, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>{e.email}</div>}
                    <div style={{ fontSize: 11, marginTop: 2, display: "flex", alignItems: "center", gap: 4, color: e.google2fa ? "var(--success)" : "var(--text-dim)" }}>
                      {e.google2fa ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
                      {e.google2fa ? "2FA on" : "2FA off"}
                    </div>
                  </td>
                  <td>{e.department}</td>
                  <td>{e.location || "—"}</td>
                  <td>
                    <span className={`status-pill ${e.status === "active" ? "status-active" : "status-offboarded"}`}>
                      {e.status === "active" ? <Check size={11} /> : <X size={11} />}
                      {e.status === "active" ? "Active" : "Offboarded"}
                    </span>
                  </td>
                  <td>{e.permissions.length}</td>
                  <td><EquipmentCell equipment={e.equipment} /></td>
                  <td>
                    {e.status === "active" ? (
                      <>
                        <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setEditingEmployeeInfo(e.id)}><UserCog size={12} />Edit</button>{" "}
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
                <th>Permission levels</th>
                <th>Employees with access</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.length === 0 ? (
                <tr><td colSpan={5} className="fv-empty">No applications in the catalog.</td></tr>
              ) : apps.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{a.owner}</td>
                  <td style={{ fontSize: 12, color: "var(--text-dim)" }}>{(a.levels || LEVEL_PRESETS).join(", ")}</td>
                  <td>{appEmployeeCounts[a.id] || 0}</td>
                  <td>
                    <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setEditingAppName(a.id)}><Pencil size={12} />Edit</button>{" "}
                    <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setEditingAppLevels(a.id)}><ListPlus size={12} />Edit levels</button>{" "}
                    <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => setConfirmDeleteApp(a.id)}><Trash2 size={12} />Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "grant" && (
        <BulkGrantPanel
          apps={apps}
          employees={employees}
          departments={departments.filter((d) => d !== "All")}
          grantAppId={grantAppId}
          setGrantAppId={setGrantAppId}
          grantLevel={grantLevel}
          setGrantLevel={setGrantLevel}
          grantSelected={grantSelected}
          setGrantSelected={setGrantSelected}
          grantSearch={grantSearch}
          setGrantSearch={setGrantSearch}
          grantDeptFilter={grantDeptFilter}
          setGrantDeptFilter={setGrantDeptFilter}
          onGrant={handleBulkGrant}
          onRevoke={handleBulkRevokeGrant}
        />
      )}

      {tab === "service" && (
        <div className="fv-card">
          <table className="fv-list-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Owner</th>
                <th>Associated app</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {serviceAccounts.length === 0 ? (
                <tr><td colSpan={6} className="fv-empty">No service accounts recorded yet. These don't have app permissions tracked — just kept here for reference.</td></tr>
              ) : serviceAccounts.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{s.description || "—"}</td>
                  <td>{s.owner || "—"}</td>
                  <td>{appById[s.appId]?.name || "—"}</td>
                  <td>
                    <span className={`status-pill ${s.status === "active" ? "status-active" : "status-offboarded"}`}>
                      {s.status === "active" ? <Check size={11} /> : <X size={11} />}
                      {s.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setEditingServiceAccount(s.id)}><Pencil size={12} />Edit</button>{" "}
                    <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => setConfirmDeleteServiceAccount(s.id)} style={{ color: "var(--danger)", borderColor: "var(--danger-soft)" }}><Trash2 size={12} />Delete</button>
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

      {editingEmployeeInfo && (
        <EditEmployeeInfoModal
          employee={employees.find((e) => e.id === editingEmployeeInfo)}
          departments={departments.filter((d) => d !== "All")}
          onClose={() => setEditingEmployeeInfo(null)}
          onSave={(name, department, email, google2fa, location) => handleEditEmployeeInfo(editingEmployeeInfo, name, department, email, google2fa, location)}
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

      {managingDepartments && (
        <ManageDepartmentsModal
          departments={departments.filter((d) => d !== "All")}
          onClose={() => setManagingDepartments(false)}
          onSave={handleRenameDepartments}
          onEditDefaults={(d) => { setManagingDepartments(false); setEditingDeptDefaults(d); }}
        />
      )}

      {editingAppLevels && (
        <EditAppLevelsModal
          app={apps.find((a) => a.id === editingAppLevels)}
          onClose={() => setEditingAppLevels(null)}
          onSave={(levels) => handleUpdateAppLevels(editingAppLevels, levels)}
        />
      )}

      {editingDeptDefaults && (
        <DeptDefaultsModal
          department={editingDeptDefaults}
          apps={apps}
          current={deptDefaults[editingDeptDefaults] || []}
          onClose={() => setEditingDeptDefaults(null)}
          onSave={(list) => handleSaveDeptDefaults(editingDeptDefaults, list)}
        />
      )}

      {confirmBulkOffboard && (
        <BulkOffboardModal
          equipmentCount={employees.filter((e) => selectedIds.includes(e.id) && e.status === "active").reduce((n, e) => n + e.equipment.length, 0)}
          count={employees.filter((e) => selectedIds.includes(e.id) && e.status === "active").length}
          onClose={() => setConfirmBulkOffboard(false)}
          onConfirm={handleBulkOffboard}
        />
      )}

      {confirmBulkDelete && (
        <BulkDeleteModal
          names={employees.filter((e) => selectedIds.includes(e.id)).map((e) => e.name)}
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={handleBulkDelete}
        />
      )}

      {editingAppName && (
        <EditAppNameModal
          app={apps.find((a) => a.id === editingAppName)}
          onClose={() => setEditingAppName(null)}
          onSave={(name, owner) => handleRenameApp(editingAppName, name, owner)}
        />
      )}

      {addingServiceAccount && (
        <ServiceAccountModal
          apps={apps}
          onClose={() => setAddingServiceAccount(false)}
          onSave={(name, description, owner, appId) => handleAddServiceAccount(name, description, owner, appId)}
        />
      )}

      {editingServiceAccount && (
        <ServiceAccountModal
          apps={apps}
          serviceAccount={serviceAccounts.find((s) => s.id === editingServiceAccount)}
          onClose={() => setEditingServiceAccount(null)}
          onSave={(name, description, owner, appId, status) => handleEditServiceAccount(editingServiceAccount, name, description, owner, appId, status)}
        />
      )}

      {confirmDeleteServiceAccount && (
        <DeleteServiceAccountModal
          serviceAccount={serviceAccounts.find((s) => s.id === confirmDeleteServiceAccount)}
          onClose={() => setConfirmDeleteServiceAccount(null)}
          onConfirm={() => handleDeleteServiceAccount(confirmDeleteServiceAccount)}
        />
      )}

      {toast && <div className="fv-toast">{toast}</div>}
    </div>
  );
}

function BulkGrantPanel({
  apps, employees, departments,
  grantAppId, setGrantAppId, grantLevel, setGrantLevel,
  grantSelected, setGrantSelected, grantSearch, setGrantSearch, grantDeptFilter, setGrantDeptFilter,
  onGrant, onRevoke,
}) {
  const appById = Object.fromEntries(apps.map((a) => [a.id, a]));
  const selectedApp = appById[grantAppId];
  const levels = selectedApp?.levels?.length ? selectedApp.levels : LEVEL_PRESETS;
  const effectiveLevel = levels.includes(grantLevel) ? grantLevel : levels[0];

  const filtered = employees.filter((e) => {
    if (e.status !== "active") return false;
    if (grantDeptFilter !== "All" && e.department !== grantDeptFilter) return false;
    if (grantSearch && !e.name.toLowerCase().includes(grantSearch.toLowerCase())) return false;
    return true;
  });

  function toggle(id) {
    setGrantSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function selectAllFiltered() {
    const ids = filtered.map((e) => e.id);
    setGrantSelected((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  }

  const currentLevelFor = (emp) => emp.permissions.find((p) => p.appId === grantAppId)?.level;

  return (
    <div className="fv-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div className="fv-field" style={{ marginBottom: 0, minWidth: 220 }}>
          <label>Application</label>
          <select className="fv-select" style={{ width: "100%" }} value={grantAppId} onChange={(e) => { setGrantAppId(e.target.value); setGrantLevel(""); }}>
            <option value="">Select an application...</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="fv-field" style={{ marginBottom: 0, minWidth: 160 }}>
          <label>Level</label>
          <select className="fv-select" style={{ width: "100%" }} value={effectiveLevel} onChange={(e) => setGrantLevel(e.target.value)} disabled={!grantAppId}>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <button className="fv-btn" disabled={!grantAppId || !grantSelected.length} onClick={onGrant}>
          <ListChecks size={14} />Grant {effectiveLevel} to {grantSelected.length || 0} selected
        </button>
        <button className="fv-btn fv-btn-ghost" disabled={!grantAppId || !grantSelected.length} onClick={onRevoke} style={{ color: "var(--danger)", borderColor: "var(--danger-soft)" }}>
          <X size={14} />Revoke {selectedApp?.name || "app"} from selected
        </button>
      </div>

      {!grantAppId ? (
        <div className="fv-empty">Pick an application above to see and select employees.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
            <input className="fv-input" placeholder="Search employee..." value={grantSearch} onChange={(e) => setGrantSearch(e.target.value)} style={{ minWidth: 200 }} />
            <select className="fv-select" value={grantDeptFilter} onChange={(e) => setGrantDeptFilter(e.target.value)}>
              <option value="All">All</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={selectAllFiltered}>Select/deselect all shown ({filtered.length})</button>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>{grantSelected.length} selected total</span>
          </div>
          <div className="fv-table-wrap" style={{ maxHeight: "50vh" }}>
            <table className="fv-list-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Current access to {selectedApp?.name}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const currentLevel = currentLevelFor(e);
                  return (
                    <tr key={e.id}>
                      <td><input type="checkbox" checked={grantSelected.includes(e.id)} onChange={() => toggle(e.id)} /></td>
                      <td style={{ fontWeight: 600 }}>{e.name}</td>
                      <td>{e.department}</td>
                      <td>{currentLevel ? <Badge level={currentLevel} /> : <span style={{ color: "#98A2B3" }}>None</span>}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={4} className="fv-empty">No employees match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function EditPermissionsModal({ employee, apps, onClose, onSave }) {
  const [perms, setPerms] = useState(employee.permissions.map((p) => ({ ...p })));
  const [newAppId, setNewAppId] = useState(apps[0]?.id || "");
  const [newLevel, setNewLevel] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [changes, setChanges] = useState([]);

  const appById = Object.fromEntries(apps.map((a) => [a.id, a]));
  const availableApps = apps.filter((a) => !perms.some((p) => p.appId === a.id));
  const levelsForApp = (appId) => (appById[appId]?.levels?.length ? appById[appId].levels : LEVEL_PRESETS);
  const newAppLevels = levelsForApp(newAppId);
  const effectiveNewLevel = newAppLevels.includes(newLevel) ? newLevel : newAppLevels[0];

  function levelOptionsFor(appId, currentValue) {
    const base = levelsForApp(appId);
    return base.includes(currentValue) ? base : [currentValue, ...base];
  }

  function addPerm() {
    if (!newAppId) return;
    setPerms([...perms, { appId: newAppId, level: effectiveNewLevel, notes: newNotes.trim() }]);
    setChanges([...changes, `+ ${appById[newAppId]?.name} → ${effectiveNewLevel}${newNotes.trim() ? ` (${newNotes.trim()})` : ""}`]);
    setNewLevel("");
    setNewNotes("");
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
  function changeNotes(appId, notes) {
    setPerms(perms.map((p) => (p.appId === appId ? { ...p, notes } : p)));
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
          <div key={p.appId} style={{ borderBottom: "1px solid var(--hairline)", padding: "8px 0" }}>
            <div className="fv-perm-row" style={{ border: "none", padding: 0 }}>
              <span className="fv-perm-app">{appById[p.appId]?.name || p.appId}</span>
              <select
                className="fv-select"
                value={p.level}
                onChange={(e) => changeLevel(p.appId, e.target.value)}
                style={{ width: 160 }}
              >
                {levelOptionsFor(p.appId, p.level).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => removePerm(p.appId)}><X size={12} />Revoke</button>
            </div>
            <input
              className="fv-input"
              value={p.notes || ""}
              onChange={(e) => changeNotes(p.appId, e.target.value)}
              placeholder="Notes (e.g. Zoom ext. 1234, softphone)"
              style={{ marginTop: 6, fontSize: 12.5 }}
            />
          </div>
        ))}
        {perms.length === 0 && <div style={{ color: "#98A2B3", fontSize: 13, padding: "8px 0" }}>No access assigned.</div>}

        <div className="fv-field" style={{ marginTop: 16 }}>
          <label>Add access</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="fv-select" value={newAppId} onChange={(e) => { setNewAppId(e.target.value); setNewLevel(""); }} style={{ flex: 1 }}>
              {availableApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="fv-select" value={effectiveNewLevel} onChange={(e) => setNewLevel(e.target.value)} style={{ width: 150 }}>
              {newAppLevels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className="fv-btn fv-btn-sm" onClick={addPerm} disabled={!availableApps.length}>Add</button>
          </div>
          <input
            className="fv-input"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes for this grant (optional — e.g. Zoom ext. 1234, softphone)"
            style={{ marginTop: 8 }}
          />
        </div>

        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" onClick={handleSave}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

const LOCATION_PRESETS = ["Puerto Rico", "United States", "India"];

function EditEmployeeInfoModal({ employee, departments, onClose, onSave }) {
  const [name, setName] = useState(employee.name);
  const [email, setEmail] = useState(employee.email || "");
  const [google2fa, setGoogle2fa] = useState(!!employee.google2fa);
  const options = departments.includes(employee.department) ? departments : [employee.department, ...departments];
  const [department, setDepartment] = useState(employee.department);
  const [customDept, setCustomDept] = useState("");
  const usingCustom = department === "__custom__";
  const locOptions = LOCATION_PRESETS.includes(employee.location) || !employee.location ? LOCATION_PRESETS : [employee.location, ...LOCATION_PRESETS];
  const [location, setLocation] = useState(employee.location || "");
  const [customLoc, setCustomLoc] = useState("");
  const usingCustomLoc = location === "__custom__";

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3><UserCog size={16} />Edit employee</h3>
        <div className="fv-modal-sub">Changes are recorded in the audit log.</div>
        <div className="fv-field">
          <label>Full name</label>
          <input className="fv-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fv-field">
          <label>Email</label>
          <input className="fv-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@fvbank.us" />
        </div>
        <div className="fv-field">
          <label>Department</label>
          <select className="fv-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
            {options.map((d) => <option key={d} value={d}>{d}</option>)}
            <option value="__custom__">Other...</option>
          </select>
          {usingCustom && (
            <input className="fv-input" style={{ marginTop: 8 }} value={customDept} onChange={(e) => setCustomDept(e.target.value)} placeholder="Department name" />
          )}
        </div>
        <div className="fv-field">
          <label>Location</label>
          <select className="fv-select" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Unspecified</option>
            {locOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value="__custom__">Other...</option>
          </select>
          {usingCustomLoc && (
            <input className="fv-input" style={{ marginTop: 8 }} value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} placeholder="Location" />
          )}
        </div>
        <div className="fv-field">
          <label className="fv-checkbox-label" style={{ fontSize: 13.5, color: "var(--text)" }}>
            <input type="checkbox" checked={google2fa} onChange={(e) => setGoogle2fa(e.target.checked)} />
            Google 2FA active
          </label>
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="fv-btn"
            disabled={!name.trim() || (usingCustom && !customDept.trim())}
            onClick={() => onSave(name.trim(), usingCustom ? customDept.trim() : department, email.trim(), google2fa, usingCustomLoc ? customLoc.trim() : location)}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEmployeeModal({ departments, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [google2fa, setGoogle2fa] = useState(false);
  const [department, setDepartment] = useState(departments[0] || "");
  const [customDept, setCustomDept] = useState("");
  const [location, setLocation] = useState("");
  const [customLoc, setCustomLoc] = useState("");
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
          <label>Email</label>
          <input className="fv-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@fvbank.us" />
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
        <div className="fv-field">
          <label>Location</label>
          <select className="fv-select" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Unspecified</option>
            {LOCATION_PRESETS.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value="__custom__">Other...</option>
          </select>
          {location === "__custom__" && (
            <input className="fv-input" style={{ marginTop: 8 }} value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} placeholder="Location" />
          )}
        </div>
        <div className="fv-field">
          <label className="fv-checkbox-label" style={{ fontSize: 13.5, color: "var(--text)" }}>
            <input type="checkbox" checked={google2fa} onChange={(e) => setGoogle2fa(e.target.checked)} />
            Google 2FA active
          </label>
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="fv-btn"
            disabled={!name.trim()}
            onClick={() => onAdd(name.trim(), department === "__custom__" ? customDept.trim() : department, email.trim(), google2fa, location === "__custom__" ? customLoc.trim() : location)}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// Equipment comes from the STRATOS inventory and is read-only here.
function EquipmentCell({ equipment }) {
  if (!equipment || !equipment.length) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }} title="Assigned in the STRATOS inventory (read-only)">
      {equipment.map((a) => (
        <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, whiteSpace: "nowrap" }}>
          <Laptop size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{a.name}</span>
          {a.type && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{a.type}</span>}
        </span>
      ))}
    </div>
  );
}

function EquipmentRelease({ equipment }) {
  if (!equipment || !equipment.length) return null;
  return (
    <div className="fv-equip-box">
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><Laptop size={13} />Equipment to release</div>
      <div style={{ marginTop: 4 }}>
        These devices are assigned to this person in the STRATOS inventory. They'll be marked <b>Spare / Available</b> there automatically, with this person kept as Previous user:
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {equipment.map((a) => <li key={a.id}><span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{a.name}</span>{a.type ? ` · ${a.type}` : ""}{a.model ? ` · ${a.model}` : ""}</li>)}
      </ul>
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
        <EquipmentRelease equipment={employee.equipment} />
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
        <EquipmentRelease equipment={employee.equipment} />
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

function ManageDepartmentsModal({ departments, onClose, onSave, onEditDefaults }) {
  const [values, setValues] = useState(Object.fromEntries(departments.map((d) => [d, d])));

  function handleSave() {
    onSave(departments.map((d) => ({ from: d, to: values[d] ?? d })));
  }

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3><Building2 size={16} />Manage departments</h3>
        <div className="fv-modal-sub">Renaming a department updates every employee currently in it. Recorded in the audit log.</div>

        <div className="fv-field" style={{ background: "var(--gold-soft)", padding: 12, borderRadius: 6 }}>
          <label style={{ color: "var(--gold-soft-text)" }}>Company-wide (applies to every department)</label>
          <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => onEditDefaults("*")}><ListPlus size={12} />Edit company-wide defaults</button>
        </div>

        {departments.map((d) => (
          <div className="fv-field" key={d}>
            <label>{d}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="fv-input" style={{ flex: 1 }} value={values[d] ?? d} onChange={(e) => setValues({ ...values, [d]: e.target.value })} />
              <button className="fv-btn fv-btn-ghost fv-btn-sm" onClick={() => onEditDefaults(d)}><ListPlus size={12} />Default apps</button>
            </div>
          </div>
        ))}
        {departments.length === 0 && <div style={{ color: "#98A2B3", fontSize: 13 }}>No departments yet.</div>}
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" onClick={handleSave}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function DeptDefaultsModal({ department, apps, current, onClose, onSave }) {
  const [selected, setSelected] = useState(current.map((c) => ({ ...c })));
  const appById = Object.fromEntries(apps.map((a) => [a.id, a]));
  const availableApps = apps.filter((a) => !selected.some((s) => s.appId === a.id));
  const [newAppId, setNewAppId] = useState(availableApps[0]?.id || "");

  function levelsFor(appId) { return appById[appId]?.levels?.length ? appById[appId].levels : LEVEL_PRESETS; }
  const [newLevel, setNewLevel] = useState("");
  const effectiveNewLevel = levelsFor(newAppId).includes(newLevel) ? newLevel : levelsFor(newAppId)[0];

  function add() {
    if (!newAppId) return;
    setSelected([...selected, { appId: newAppId, level: effectiveNewLevel }]);
    setNewLevel("");
  }
  function remove(appId) { setSelected(selected.filter((s) => s.appId !== appId)); }
  function changeLevel(appId, level) { setSelected(selected.map((s) => (s.appId === appId ? { ...s, level } : s))); }
  function selectAll() {
    setSelected(apps.map((a) => ({ appId: a.id, level: levelsFor(a.id)[0] })));
  }

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()}>
        <h3><ListPlus size={16} />Default apps for {department === "*" ? "everyone (company-wide)" : department}</h3>
        <div className="fv-modal-sub">
          {department === "*"
            ? "These grants are combined with each employee's department defaults whenever you use \"Apply department defaults.\" Use this for things every employee gets, like Google Cloud Platform or Zoom."
            : "These grants can be applied in bulk to employees in this department (select them and use \"Apply department defaults\"), combined with any company-wide defaults. For a department that should get everything — e.g. IT — use \"Select all apps\" below."}
        </div>
        {selected.map((s) => (
          <div className="fv-perm-row" key={s.appId}>
            <span className="fv-perm-app">{appById[s.appId]?.name || s.appId}</span>
            <select className="fv-select" value={s.level} onChange={(e) => changeLevel(s.appId, e.target.value)} style={{ width: 160 }}>
              {levelsFor(s.appId).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => remove(s.appId)}><X size={12} />Remove</button>
          </div>
        ))}
        {selected.length === 0 && <div style={{ color: "#98A2B3", fontSize: 13, padding: "8px 0" }}>No default apps set for this department yet.</div>}

        <div className="fv-field" style={{ marginTop: 16 }}>
          <label>Add a default app</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="fv-select" value={newAppId} onChange={(e) => { setNewAppId(e.target.value); setNewLevel(""); }} style={{ flex: 1 }}>
              {availableApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="fv-select" value={effectiveNewLevel} onChange={(e) => setNewLevel(e.target.value)} style={{ width: 150 }}>
              {levelsFor(newAppId).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button className="fv-btn fv-btn-sm" onClick={add} disabled={!availableApps.length}>Add</button>
          </div>
        </div>
        <button className="fv-btn fv-btn-ghost fv-btn-sm" style={{ marginTop: 10 }} onClick={selectAll}>Select all apps (e.g. for IT)</button>

        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" onClick={() => onSave(selected)}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function BulkOffboardModal({ count, equipmentCount = 0, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3><UserMinus size={16} />Offboard {count} employee(s)</h3>
        <div className="fv-modal-sub">Revokes all access for each selected active employee. Recorded in the audit log.</div>
        {equipmentCount > 0 && (
          <div className="fv-equip-box"><Laptop size={13} />{equipmentCount} device(s) assigned to them will be released in the STRATOS inventory (marked Spare / Available).</div>
        )}
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

function BulkDeleteModal({ names, onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText.trim().toUpperCase() === "DELETE";
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 style={{ color: "var(--danger)" }}><AlertTriangle size={16} />Permanently delete {names.length} employee(s)</h3>
        <div className="fv-warning-box">
          This erases the records and access history of: {names.join(", ")}. Cannot be undone. Only one audit log entry remains per person.
        </div>
        <div className="fv-field">
          <label>Type DELETE to confirm</label>
          <input className="fv-input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn fv-btn-danger" disabled={!matches} onClick={onConfirm}><Trash2 size={13} />Delete permanently</button>
        </div>
      </div>
    </div>
  );
}

function EditAppLevelsModal({ app, onClose, onSave }) {
  const [levels, setLevels] = useState((app.levels && app.levels.length ? app.levels : LEVEL_PRESETS).slice());
  const [newLevel, setNewLevel] = useState("");

  function addLevel() {
    const v = newLevel.trim();
    if (!v || levels.includes(v)) return;
    setLevels([...levels, v]);
    setNewLevel("");
  }
  function removeLevel(v) {
    setLevels(levels.filter((l) => l !== v));
  }
  function renameLevel(oldV, newV) {
    setLevels(levels.map((l) => (l === oldV ? newV : l)));
  }

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3><ListPlus size={16} />Permission levels for {app.name}</h3>
        <div className="fv-modal-sub">These are the options available when granting access to this application (e.g. Admin, Administrator, Viewer, Read-only).</div>
        {levels.map((l, i) => (
          <div className="fv-perm-row" key={i}>
            <input className="fv-input" style={{ flex: 1 }} value={l} onChange={(e) => renameLevel(l, e.target.value)} />
            <button className="fv-btn fv-btn-danger fv-btn-sm" onClick={() => removeLevel(l)} disabled={levels.length <= 1}><X size={12} />Remove</button>
          </div>
        ))}
        <div className="fv-field" style={{ marginTop: 16 }}>
          <label>Add a level</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="fv-input" style={{ flex: 1 }} value={newLevel} onChange={(e) => setNewLevel(e.target.value)} placeholder="e.g. Read-only" onKeyDown={(e) => e.key === "Enter" && addLevel()} />
            <button className="fv-btn fv-btn-sm" onClick={addLevel} disabled={!newLevel.trim()}>Add</button>
          </div>
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" onClick={() => onSave(levels)}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function EditAppNameModal({ app, onClose, onSave }) {
  const [name, setName] = useState(app.name);
  const [owner, setOwner] = useState(app.owner);
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <h3><Pencil size={16} />Edit application</h3>
        <div className="fv-modal-sub">Recorded in the audit log.</div>
        <div className="fv-field">
          <label>Application name</label>
          <input className="fv-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fv-field">
          <label>Owner</label>
          <input className="fv-input" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn" disabled={!name.trim()} onClick={() => onSave(name.trim(), owner.trim())}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function ServiceAccountModal({ apps, serviceAccount, onClose, onSave }) {
  const isEdit = !!serviceAccount;
  const [name, setName] = useState(serviceAccount?.name || "");
  const [description, setDescription] = useState(serviceAccount?.description || "");
  const [owner, setOwner] = useState(serviceAccount?.owner || "");
  const [appId, setAppId] = useState(serviceAccount?.appId || "");
  const [status, setStatus] = useState(serviceAccount?.status || "active");

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <h3><Bot size={16} />{isEdit ? "Edit service account" : "Add service account"}</h3>
        <div className="fv-modal-sub">For record-keeping — service accounts aren't tracked against app permissions yet.</div>
        <div className="fv-field">
          <label>Name</label>
          <input className="fv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. svc-backup-fireblocks" />
        </div>
        <div className="fv-field">
          <label>Description</label>
          <input className="fv-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it's used for" />
        </div>
        <div className="fv-field">
          <label>Owner</label>
          <input className="fv-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who's responsible for it" />
        </div>
        <div className="fv-field">
          <label>Associated application (optional)</label>
          <select className="fv-select" value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">None</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {isEdit && (
          <div className="fv-field">
            <label>Status</label>
            <select className="fv-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        )}
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="fv-btn"
            disabled={!name.trim()}
            onClick={() => (isEdit ? onSave(name.trim(), description.trim(), owner.trim(), appId, status) : onSave(name.trim(), description.trim(), owner.trim(), appId))}
          >
            {isEdit ? "Save changes" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteServiceAccountModal({ serviceAccount, onClose, onConfirm }) {
  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3><Trash2 size={16} />Delete {serviceAccount.name}</h3>
        <div className="fv-modal-sub">This removes it from the registry. Recorded in the audit log.</div>
        <div className="fv-modal-actions">
          <button className="fv-btn fv-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="fv-btn fv-btn-danger" onClick={onConfirm}><Trash2 size={13} />Delete</button>
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
