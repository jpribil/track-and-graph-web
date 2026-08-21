import { createContext, FormEvent, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { languageNames, languages, messages, type Language } from "./i18n";
import "./styles.css";

type User = { id: string; email: string; isAdmin: boolean };
type Group = { id: string; name: string; description: string; tracker_count: number };
type Tracker = { id: string; name: string; description: string; is_duration: boolean; default_value: number | null; point_count: number; total: number };
type Point = { id: string; value: number; label: string | null; note: string | null; tracked_at: string };
type GroupDetail = { group: Group; trackers: Tracker[] };
type TrackerDetail = { tracker: Tracker; points: Point[] };

type I18n = { language: Language; setLanguage: (language: Language) => void; t: (key: string) => string };
const I18nContext = createContext<I18n | null>(null);

function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18n context is missing.");
  return context;
}

function LanguagePicker() {
  const { language, setLanguage, t } = useI18n();
  return <label className="language-picker"><span>{t("language")}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{languages.map((code) => <option key={code} value={code}>{languageNames[code]}</option>)}</select></label>;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "An unknown error occurred." }));
    throw new Error(payload.error ?? "The request failed.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function dateTimeLocalValue(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function formatValue(value: number, duration: boolean, language: Language): string {
  if (!duration) return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function App() {
  const [language, setLanguageState] = useState<Language>(() => (localStorage.getItem("tng-language") as Language) || "en");
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [selectedTracker, setSelectedTracker] = useState<TrackerDetail | null>(null);
  const [error, setError] = useState("");
  const t = (key: string) => messages[language][key] ?? messages.en[key] ?? key;
  const setLanguage = (nextLanguage: Language) => { localStorage.setItem("tng-language", nextLanguage); document.documentElement.lang = nextLanguage; setLanguageState(nextLanguage); };

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

  useEffect(() => { document.documentElement.lang = language; }, [language]);

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

  if (user === undefined) return <main className="loading">{t("loading")}</main>;

  if (!user) {
    return <I18nContext.Provider value={{ language, setLanguage, t }}><AuthScreen
      allowRegistration={allowRegistration}
      onAuthenticated={(signedInUser) => { setUser(signedInUser); void refreshGroups(); }}
      error={error}
      setError={setError}
    /></I18nContext.Provider>;
  }

  return (<I18nContext.Provider value={{ language, setLanguage, t }}>
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">T</span><span>Track <em>&</em> Graph</span></div>
        <div className="account"><span>{user.email}</span><button className="link-button" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); setUser(null); }}>{t("logout")}</button></div>
        <LanguagePicker />
        <section className="sidebar-section">
          <div className="section-heading"><span>{t("groups")}</span><button className="round-button" aria-label={t("newGroup")} onClick={() => document.getElementById("new-group-name")?.focus()}>+</button></div>
          <nav className="group-list">
            {groups.map((group) => <button key={group.id} className={selectedGroup?.group.id === group.id ? "group-button selected" : "group-button"} onClick={() => void chooseGroup(group.id)}><span>{group.name}</span><small>{group.tracker_count}</small></button>)}
            {groups.length === 0 && <p className="empty-note">{t("firstGroupHint")}</p>}
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
  </I18nContext.Provider>);
}

function AuthScreen({ allowRegistration, onAuthenticated, error, setError }: { allowRegistration: boolean; onAuthenticated: (user: User) => void; error: string; setError: (value: string) => void }) {
  const { t } = useI18n();
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
  return <main className="auth-layout"><section className="auth-intro"><div className="brand"><span className="brand-mark">T</span><span>Track <em>&</em> Graph</span></div><LanguagePicker /><h1>{t("personalData")}</h1><p>{t("intro")}</p><div className="intro-stat"><strong>{t("oneEntry")}</strong><span>{t("entryFields")}</span></div></section><section className="auth-card"><p className="eyebrow">{t("welcomeBack")}</p><h2>{mode === "login" ? t("signIn") : t("newAccount")}</h2><p className="muted">{mode === "login" ? t("signInSub") : t("newAccountSub")}</p>{error && <p className="form-error">{error}</p>}<form onSubmit={submit}><label>{t("email")}<input name="email" type="email" autoComplete="email" required /></label><label>{t("password")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required /></label><button className="primary-button" disabled={busy}>{busy ? t("working") : mode === "login" ? t("signIn") : t("createAccount")}</button></form>{allowRegistration && <button className="switch-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? t("noAccount") : t("alreadyAccount")}</button>}</section></main>;
}

function Welcome({ groups }: { groups: Group[] }) {
  const { t } = useI18n();
  return <div className="welcome"><p className="eyebrow">{t("yourSpace")}</p><h1>{groups.length ? t("chooseGroup") : t("createFirstGroup")}</h1><p>{groups.length ? t("chooseGroupDetail") : t("groupsExplain")}</p></div>;
}

function GroupForm({ onCreated, setError }: { onCreated: (group: Group) => void; setError: (error: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { const response = await api<{ group: Group }>("/api/groups", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description") }) }); event.currentTarget.reset(); setOpen(false); onCreated(response.group); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <section className="new-group">{open ? <form onSubmit={submit}><label>{t("name")}<input id="new-group-name" name="name" placeholder={t("healthExample")} required /></label><label>{t("description")} <small>{t("optional")}</small><input name="description" placeholder={t("groupDescription")} /></label><div className="inline-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>{t("cancel")}</button><button className="small-primary" disabled={busy}>{t("add")}</button></div></form> : <button className="new-group-button" onClick={() => setOpen(true)}>+ {t("newGroup")}</button>}</section>;
}

function GroupView({ groupDetail, onTracker, onTrackerCreated, setError }: { groupDetail: GroupDetail; onTracker: (id: string) => void; onTrackerCreated: () => void; setError: (error: string) => void }) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const { group, trackers } = groupDetail;
  return <div className="content"><header className="page-header"><div><p className="eyebrow">{t("group")}</p><h1>{group.name}</h1>{group.description && <p className="muted">{group.description}</p>}</div><button className="primary-button compact" onClick={() => setOpen(true)}>+ {t("newTracker")}</button></header>{open && <TrackerForm groupId={group.id} onCreated={() => { setOpen(false); onTrackerCreated(); }} setError={setError} />}{trackers.length === 0 ? <div className="empty-panel"><h2>{t("nothingHere")}</h2><p>{t("trackerExplain")}</p><button className="primary-button" onClick={() => setOpen(true)}>{t("createTracker")}</button></div> : <div className="tracker-grid">{trackers.map((tracker) => <button className="tracker-card" key={tracker.id} onClick={() => void onTracker(tracker.id)}><span className="tracker-card-top"><span className="tracker-icon">⌁</span><span>{tracker.point_count} {t("records")}</span></span><strong>{tracker.name}</strong><span className="tracker-total">{formatValue(tracker.total, tracker.is_duration, language)}</span><span className="tracker-card-bottom">{t("total")} <i>→</i></span></button>)}</div>}</div>;
}

function TrackerForm({ groupId, onCreated, setError }: { groupId: string; onCreated: () => void; setError: (error: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await api(`/api/groups/${groupId}/trackers`, { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), isDuration: form.get("isDuration") === "on", defaultValue: form.get("defaultValue") }) }); onCreated(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <form className="tracker-form" onSubmit={submit}><h2>{t("newTracker")}</h2><div className="form-grid"><label>{t("name")}<input name="name" placeholder={t("stepsExample")} required autoFocus /></label><label>{t("defaultValue")} <small>{t("optional")}</small><input name="defaultValue" type="number" step="any" placeholder="e.g. 1" /></label><label className="span-2">{t("description")} <small>{t("optional")}</small><input name="description" placeholder={t("trackerDescription")} /></label></div><label className="checkbox"><input name="isDuration" type="checkbox" /> {t("duration")}</label><button className="small-primary" disabled={busy}>{busy ? t("creating") : t("saveTracker")}</button></form>;
}

function TrackerView({ detail, onBack, onPointCreated, setError }: { detail: TrackerDetail; onBack: () => void; onPointCreated: () => void; setError: (error: string) => void }) {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState(dateTimeLocalValue());
  const points = detail.points;
  const summary = useMemo(() => points.reduce((total, point) => total + point.value, 0), [points]);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await api(`/api/trackers/${detail.tracker.id}/points`, { method: "POST", body: JSON.stringify({ value: form.get("value"), label: form.get("label"), note: form.get("note"), trackedAt: new Date(when).toISOString() }) }); event.currentTarget.reset(); setWhen(dateTimeLocalValue()); onPointCreated(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return <div className="content"><header className="page-header"><div><button className="back-button" onClick={onBack}>← {t("backToGroup")}</button><p className="eyebrow">{t("tracker")}</p><h1>{detail.tracker.name}</h1>{detail.tracker.description && <p className="muted">{detail.tracker.description}</p>}</div><div className="big-stat"><span>{t("visibleTotal")}</span><strong>{formatValue(summary, detail.tracker.is_duration, language)}</strong></div></header><div className="tracker-layout"><section className="record-panel"><p className="eyebrow">{t("newEntry")}</p><h2>{t("addData")}</h2><form onSubmit={submit}><label>{t("value")}<input name="value" type="number" step="any" defaultValue={detail.tracker.default_value ?? ""} required autoFocus /></label><label>{t("time")}<input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required /></label><label>{t("label")} <small>{t("optional")}</small><input name="label" placeholder={t("morning")} /></label><label>{t("note")} <small>{t("optional")}</small><textarea name="note" rows={3} placeholder={t("noteContext")} /></label><button className="primary-button" disabled={busy}>{busy ? t("saving") : t("addEntry")}</button></form></section><section className="history-panel"><div className="history-heading"><div><p className="eyebrow">{t("history")}</p><h2>{t("recentEntries")}</h2></div><span>{points.length}</span></div>{points.length === 0 ? <p className="empty-note">{t("firstEntry")}</p> : <div className="point-list">{points.map((point) => <article className="point" key={point.id}><div><strong>{formatValue(point.value, detail.tracker.is_duration, language)}</strong>{point.label && <span className="tag">{point.label}</span>}{point.note && <p>{point.note}</p>}</div><time>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(point.tracked_at))}</time></article>)}</div>}</section></div></div>;
}

createRoot(document.getElementById("root")!).render(<App />);
