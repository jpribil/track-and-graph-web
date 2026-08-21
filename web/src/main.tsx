import { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type User = { id: string; email: string; isAdmin: boolean };
type Group = { id: string; name: string; description: string; tracker_count: number };
type Tracker = { id: string; name: string; description: string; is_duration: boolean; default_value: number | null; point_count: number; total: number };
type Point = { id: string; value: number; label: string | null; note: string | null; tracked_at: string };
type GroupDetail = { group: Group; trackers: Tracker[] };
type TrackerDetail = { tracker: Tracker; points: Point[] };

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Nastala neznámá chyba." }));
    throw new Error(payload.error ?? "Požadavek se nezdařil.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function dateTimeLocalValue(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatValue(value: number, duration: boolean): string {
  if (!duration) return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value);
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [selectedTracker, setSelectedTracker] = useState<TrackerDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshGroups = async () => {
    const response = await api<{ groups: Group[] }>("/api/groups");
    setGroups(response.groups);
  };

  useEffect(() => {
    api<{ user: User | null; allowRegistration: boolean }>("/api/auth/me")
      .then(({ user: signedInUser, allowRegistration: registration }) => {
        setUser(signedInUser);
        setAllowRegistration(registration);
        if (signedInUser) void refreshGroups();
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const chooseGroup = async (groupId: string) => {
    setError("");
    setSelectedTracker(null);
    const response = await api<GroupDetail>(`/api/groups/${groupId}`);
    setSelectedGroup(response);
  };

  const chooseTracker = async (trackerId: string) => {
    setError("");
    const response = await api<TrackerDetail>(`/api/trackers/${trackerId}`);
    setSelectedTracker(response);
  };

  if (user === undefined) return <main className="loading">Načítám Track & Graph…</main>;

  if (!user) {
    return <AuthScreen
      allowRegistration={allowRegistration}
      onAuthenticated={(signedInUser) => { setUser(signedInUser); void refreshGroups(); }}
      error={error}
      setError={setError}
    />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">T</span><span>Track <em>&</em> Graph</span></div>
        <div className="account"><span>{user.email}</span><button className="link-button" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); }}>Odhlásit</button></div>
        <section className="sidebar-section">
          <div className="section-heading"><span>Skupiny</span><button className="round-button" aria-label="Nová skupina" onClick={() => document.getElementById("new-group-name")?.focus()}>+</button></div>
          <nav className="group-list">
            {groups.map((group) => <button key={group.id} className={selectedGroup?.group.id === group.id ? "group-button selected" : "group-button"} onClick={() => void chooseGroup(group.id)}><span>{group.name}</span><small>{group.tracker_count}</small></button>)}
            {groups.length === 0 && <p className="empty-note">Začni první skupinou — třeba Zdraví nebo Denní návyky.</p>}
          </nav>
        </section>
        <GroupForm onCreated={async (group) => { await refreshGroups(); await chooseGroup(group.id); }} setError={setError} />
      </aside>
      <section className="workspace">
        {error && <div className="error-banner">{error}<button onClick={() => setError("")}>×</button></div>}
        {!selectedGroup && <Welcome groups={groups} />}
        {selectedGroup && !selectedTracker && <GroupView groupDetail={selectedGroup} onTracker={chooseTracker} onTrackerCreated={async () => { await chooseGroup(selectedGroup.group.id); await refreshGroups(); }} setError={setError} />}
        {selectedGroup && selectedTracker && <TrackerView detail={selectedTracker} onBack={() => setSelectedTracker(null)} onPointCreated={async () => chooseTracker(selectedTracker.tracker.id)} setError={setError} />}
      </section>
    </main>
  );
}

function AuthScreen({ allowRegistration, onAuthenticated, error, setError }: { allowRegistration: boolean; onAuthenticated: (user: User) => void; error: string; setError: (value: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<{ user: User }>(`/api/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      onAuthenticated(response.user);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <main className="auth-layout"><section className="auth-intro"><div className="brand"><span className="brand-mark">T</span><span>Track <em>&</em> Graph</span></div><h1>Osobní data, která dávají smysl.</h1><p>Zaznamenávej, porovnávej a objevuj vlastní vzorce. Data zůstávají na tvém serveru.</p><div className="intro-stat"><strong>1 datum</strong><span>hodnota · štítek · poznámka</span></div></section><section className="auth-card"><p className="eyebrow">Vítej zpět</p><h2>{mode === "login" ? "Přihlášení" : "Nový účet"}</h2><p className="muted">{mode === "login" ? "Pokračuj ke svým trackerům." : "Vytvoř si soukromý prostor pro vlastní data."}</p>{error && <p className="form-error">{error}</p>}<form onSubmit={submit}><label>E-mail<input name="email" type="email" autoComplete="email" required /></label><label>Heslo<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required /></label><button className="primary-button" disabled={busy}>{busy ? "Pracuji…" : mode === "login" ? "Přihlásit se" : "Vytvořit účet"}</button></form>{allowRegistration && <button className="switch-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Nemáš účet? Zaregistruj se" : "Už účet máš? Přihlas se"}</button>}</section></main>;
}

function Welcome({ groups }: { groups: Group[] }) {
  return <div className="welcome"><p className="eyebrow">Tvůj prostor</p><h1>{groups.length ? "Vyber skupinu vlevo." : "Založ si první skupinu."}</h1><p>{groups.length ? "V každé skupině najdeš trackery a jejich záznamy." : "Skupiny udržují trackery pohromadě — například pohyb, zdraví nebo finance."}</p></div>;
}

function GroupForm({ onCreated, setError }: { onCreated: (group: Group) => void; setError: (error: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { const response = await api<{ group: Group }>("/api/groups", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); event.currentTarget.reset(); setOpen(false); onCreated(response.group); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <section className="new-group">{open ? <form onSubmit={submit}><label>Název<input id="new-group-name" name="name" placeholder="Např. Zdraví" required /></label><label>Popis <small>nepovinný</small><input name="description" placeholder="Co tu sleduješ?" /></label><div className="inline-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Zrušit</button><button className="small-primary" disabled={busy}>Přidat</button></div></form> : <button className="new-group-button" onClick={() => setOpen(true)}>+ Nová skupina</button>}</section>;
}

function GroupView({ groupDetail, onTracker, onTrackerCreated, setError }: { groupDetail: GroupDetail; onTracker: (id: string) => void; onTrackerCreated: () => void; setError: (error: string) => void }) {
  const [open, setOpen] = useState(false);
  const { group, trackers } = groupDetail;
  return <div className="content"><header className="page-header"><div><p className="eyebrow">Skupina</p><h1>{group.name}</h1>{group.description && <p className="muted">{group.description}</p>}</div><button className="primary-button compact" onClick={() => setOpen(true)}>+ Nový tracker</button></header>{open && <TrackerForm groupId={group.id} onCreated={() => { setOpen(false); onTrackerCreated(); }} setError={setError} />}{trackers.length === 0 ? <div className="empty-panel"><h2>Zatím tu nic není.</h2><p>Tracker může měřit číslo, počet, délku trvání nebo cokoliv dalšího.</p><button className="primary-button" onClick={() => setOpen(true)}>Vytvořit tracker</button></div> : <div className="tracker-grid">{trackers.map((tracker) => <button className="tracker-card" key={tracker.id} onClick={() => void onTracker(tracker.id)}><span className="tracker-card-top"><span className="tracker-icon">⌁</span><span>{tracker.point_count} záznamů</span></span><strong>{tracker.name}</strong><span className="tracker-total">{formatValue(tracker.total, tracker.is_duration)}</span><span className="tracker-card-bottom">Celkem <i>→</i></span></button>)}</div>}</div>;
}

function TrackerForm({ groupId, onCreated, setError }: { groupId: string; onCreated: () => void; setError: (error: string) => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await api(`/api/groups/${groupId}/trackers`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), isDuration: form.get("isDuration") === "on", defaultValue: form.get("defaultValue") }) }); onCreated(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <form className="tracker-form" onSubmit={submit}><h2>Nový tracker</h2><div className="form-grid"><label>Název<input name="name" placeholder="Např. Kroky" required autoFocus /></label><label>Výchozí hodnota <small>nepovinná</small><input name="defaultValue" type="number" step="any" placeholder="Např. 1" /></label><label className="span-2">Popis <small>nepovinný</small><input name="description" placeholder="Co tento tracker zachycuje?" /></label></div><label className="checkbox"><input name="isDuration" type="checkbox" /> Hodnota představuje délku v sekundách</label><button className="small-primary" disabled={busy}>{busy ? "Ukládám…" : "Vytvořit tracker"}</button></form>;
}

function TrackerView({ detail, onBack, onPointCreated, setError }: { detail: TrackerDetail; onBack: () => void; onPointCreated: () => void; setError: (error: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState(dateTimeLocalValue());
  const points = detail.points;
  const summary = useMemo(() => points.reduce((total, point) => total + point.value, 0), [points]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await api(`/api/trackers/${detail.tracker.id}/points`, { method: "POST", body: JSON.stringify({ value: form.get("value"), label: form.get("label"), note: form.get("note"), trackedAt: new Date(when).toISOString() }) }); event.currentTarget.reset(); setWhen(dateTimeLocalValue()); onPointCreated(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <div className="content"><header className="page-header"><div><button className="back-button" onClick={onBack}>← {"Zpět ke skupině"}</button><p className="eyebrow">Tracker</p><h1>{detail.tracker.name}</h1>{detail.tracker.description && <p className="muted">{detail.tracker.description}</p>}</div><div className="big-stat"><span>Součet zobrazených</span><strong>{formatValue(summary, detail.tracker.is_duration)}</strong></div></header><div className="tracker-layout"><section className="record-panel"><p className="eyebrow">Nový záznam</p><h2>Přidej data</h2><form onSubmit={submit}><label>Hodnota<input name="value" type="number" step="any" defaultValue={detail.tracker.default_value ?? ""} required autoFocus /></label><label>Čas<input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required /></label><label>Štítek <small>nepovinný</small><input name="label" placeholder="Např. ranní" /></label><label>Poznámka <small>nepovinná</small><textarea name="note" rows={3} placeholder="Kontext k tomuto záznamu" /></label><button className="primary-button" disabled={busy}>{busy ? "Ukládám…" : "Přidat záznam"}</button></form></section><section className="history-panel"><div className="history-heading"><div><p className="eyebrow">Historie</p><h2>Poslední záznamy</h2></div><span>{points.length}</span></div>{points.length === 0 ? <p className="empty-note">První záznam se tady objeví hned po uložení.</p> : <div className="point-list">{points.map((point) => <article className="point" key={point.id}><div><strong>{formatValue(point.value, detail.tracker.is_duration)}</strong>{point.label && <span className="tag">{point.label}</span>}{point.note && <p>{point.note}</p>}</div><time>{new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(point.tracked_at))}</time></article>)}</div>}</section></div></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
