import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { clearSession, createSession, currentUser, deleteSession, hashPassword, requireUser, verifyPassword } from "./auth.js";
import { db, migrate } from "./db.js";

const app = fastify({ logger: true });
const allowRegistration = process.env.ALLOW_REGISTRATION !== "false";
const staticRoot = join(fileURLToPath(new URL("..", import.meta.url)), "dist");

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function text(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll("\"", "\"\"")}"` : raw;
}

function durationCsvValue(value: number): string {
  const seconds = Math.trunc(value);
  const hours = Math.trunc(seconds / 3600);
  const minutes = Math.trunc((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) { if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ""; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  return rows;
}

function parseCsvValue(raw: string): { value: number; isDuration: boolean; legacyLabel: string } | null {
  const duration = /^(-?\d+):(-?\d{2}):(-?\d{2})$/.exec(raw);
  if (duration) return { value: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), isDuration: true, legacyLabel: "" };
  const legacy = /^([^:]+):(.*)$/.exec(raw);
  const value = Number(legacy ? legacy[1] : raw);
  return Number.isFinite(value) ? { value, isDuration: false, legacyLabel: legacy?.[2] ?? "" } : null;
}

async function ownsGroup(userId: string, groupId: string): Promise<boolean> {
  const result = await db.query("SELECT 1 FROM tracker_groups WHERE id = $1 AND owner_id = $2", [groupId, userId]);
  return result.rowCount === 1;
}

async function ownsTracker(userId: string, trackerId: string): Promise<boolean> {
  const result = await db.query(
    "SELECT 1 FROM trackers t JOIN tracker_groups g ON g.id = t.group_id WHERE t.id = $1 AND g.owner_id = $2",
    [trackerId, userId],
  );
  return result.rowCount === 1;
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/auth/me", async (request) => ({ user: await currentUser(request), allowRegistration }));

app.post("/api/auth/register", async (request, reply) => {
  if (!allowRegistration) return reply.code(403).send({ error: "Registration is disabled by the administrator." });
  const body = request.body as { email?: unknown; password?: unknown };
  const email = text(body?.email)?.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !email.includes("@") || password.length < 10) {
    return reply.code(400).send({ error: "Enter a valid email address and a password with at least 10 characters." });
  }
  try {
    const id = randomUUID();
    await db.query("INSERT INTO app_users (id, email, password_hash) VALUES ($1, $2, $3)", [id, email, await hashPassword(password)]);
    await createSession(reply, id);
    return reply.code(201).send({ user: { id, email, isAdmin: false } });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this email address already exists." });
    throw error;
  }
});

app.post("/api/auth/login", async (request, reply) => {
  const body = request.body as { email?: unknown; password?: unknown };
  const email = text(body?.email)?.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return reply.code(400).send({ error: "Enter both email and password." });
  const result = await db.query<{ id: string; email: string; password_hash: string; is_admin: boolean }>(
    "SELECT id, email, password_hash, is_admin FROM app_users WHERE email = $1",
    [email],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return reply.code(401).send({ error: "Invalid email or password." });
  }
  await createSession(reply, user.id);
  return { user: { id: user.id, email: user.email, isAdmin: user.is_admin } };
});

app.post("/api/auth/logout", async (request, reply) => {
  await deleteSession(request);
  clearSession(reply);
  return reply.code(204).send();
});

app.get("/api/groups", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const result = await db.query(
    `SELECT g.id, g.name, g.description, g.created_at, COUNT(t.id)::int AS tracker_count
     FROM tracker_groups g LEFT JOIN trackers t ON t.group_id = g.id
     WHERE g.owner_id = $1 GROUP BY g.id ORDER BY g.position, g.created_at`,
    [user.id],
  );
  return { groups: result.rows };
});

app.post("/api/groups", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = request.body as { name?: unknown; description?: unknown };
  const name = text(body?.name, 100);
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!name) return reply.code(400).send({ error: "A group needs a name." });
  const id = randomUUID();
  await db.query(
    "INSERT INTO tracker_groups (id, owner_id, name, description, position) VALUES ($1, $2, $3, $4, (SELECT COUNT(*) FROM tracker_groups WHERE owner_id = $2))",
    [id, user.id, name, description],
  );
  return reply.code(201).send({ group: { id, name, description, tracker_count: 0 } });
});

app.get("/api/groups/:groupId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { groupId } = request.params as { groupId: string };
  if (!(await ownsGroup(user.id, groupId))) return reply.code(404).send({ error: "Group not found." });
  const group = await db.query("SELECT id, name, description FROM tracker_groups WHERE id = $1", [groupId]);
  const trackers = await db.query(
    `SELECT t.id, t.name, t.description, t.is_duration, t.default_value,
       COUNT(p.id)::int AS point_count, COALESCE(SUM(p.value), 0)::float AS total
     FROM trackers t LEFT JOIN data_points p ON p.tracker_id = t.id
     WHERE t.group_id = $1 GROUP BY t.id ORDER BY t.position, t.created_at`,
    [groupId],
  );
  return { group: group.rows[0], trackers: trackers.rows };
});

app.post("/api/groups/:groupId/trackers", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { groupId } = request.params as { groupId: string };
  if (!(await ownsGroup(user.id, groupId))) return reply.code(404).send({ error: "Group not found." });
  const body = request.body as { name?: unknown; description?: unknown; isDuration?: unknown; defaultValue?: unknown };
  const name = text(body?.name, 100);
  const defaultValue = body?.defaultValue === "" || body?.defaultValue === undefined ? null : number(body?.defaultValue);
  if (!name || (body?.defaultValue !== "" && body?.defaultValue !== undefined && defaultValue === null)) {
    return reply.code(400).send({ error: "A tracker needs a name and a valid default value." });
  }
  const id = randomUUID();
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
  await db.query(
    "INSERT INTO trackers (id, group_id, name, description, is_duration, default_value, position) VALUES ($1, $2, $3, $4, $5, $6, (SELECT COUNT(*) FROM trackers WHERE group_id = $2))",
    [id, groupId, name, description, body?.isDuration === true, defaultValue],
  );
  return reply.code(201).send({ tracker: { id, name, description, is_duration: body?.isDuration === true, default_value: defaultValue } });
});

app.get("/api/groups/:groupId/export.csv", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { groupId } = request.params as { groupId: string };
  if (!(await ownsGroup(user.id, groupId))) return reply.code(404).send({ error: "Group not found." });
  const result = await db.query<{
    tracker_name: string;
    is_duration: boolean;
    value: number;
    label: string | null;
    note: string | null;
    tracked_at: Date;
  }>(
    `SELECT t.name AS tracker_name, t.is_duration, p.value, p.label, p.note, p.tracked_at
     FROM trackers t JOIN data_points p ON p.tracker_id = t.id
     WHERE t.group_id = $1
     ORDER BY t.position, t.created_at, p.tracked_at DESC, p.created_at DESC`,
    [groupId],
  );
  const rows = result.rows.map((point) => [
    point.tracker_name,
    point.tracked_at.toISOString(),
    point.is_duration ? durationCsvValue(point.value) : point.value,
    point.label,
    point.note,
  ].map(csvCell).join(","));
  const csv = ["FeatureName,Timestamp,Value,Label,Note", ...rows].join("\r\n") + "\r\n";
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", "attachment; filename=track-and-graph.csv")
    .send(csv);
});

app.post("/api/groups/:groupId/import.csv", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { groupId } = request.params as { groupId: string };
  if (!(await ownsGroup(user.id, groupId))) return reply.code(404).send({ error: "Group not found." });
  const upload = await request.file();
  if (!upload) return reply.code(400).send({ error: "Choose a CSV file to import." });
  const rows = parseCsv((await upload.toBuffer()).toString("utf8"));
  const [header, ...records] = rows;
  const expected = ["FeatureName", "Timestamp", "Value"];
  if (!header || expected.some((name) => !header.includes(name))) return reply.code(400).send({ error: "CSV must include FeatureName, Timestamp, and Value columns." });
  const column = (name: string) => header.indexOf(name);
  const featureColumn = column("FeatureName"), timestampColumn = column("Timestamp"), valueColumn = column("Value"), labelColumn = column("Label"), noteColumn = column("Note");
  const existing = await db.query<{ id: string; name: string; is_duration: boolean }>("SELECT id, name, is_duration FROM trackers WHERE group_id = $1", [groupId]);
  const trackers = new Map(existing.rows.map((tracker) => [tracker.name, tracker]));
  const client = await db.connect(); let imported = 0;
  try {
    await client.query("BEGIN");
    for (const [offset, record] of records.entries()) {
      if (record.every((value) => value === "")) continue;
      const name = record[featureColumn]?.trim(); const parsed = parseCsvValue(record[valueColumn] ?? ""); const date = new Date(record[timestampColumn] ?? "");
      if (!name || !parsed || Number.isNaN(date.valueOf())) throw new Error(`Invalid CSV record on line ${offset + 2}.`);
      let tracker = trackers.get(name);
      if (!tracker) { tracker = { id: randomUUID(), name, is_duration: parsed.isDuration }; await client.query("INSERT INTO trackers (id, group_id, name, is_duration, position) VALUES ($1, $2, $3, $4, (SELECT COUNT(*) FROM trackers WHERE group_id = $2))", [tracker.id, groupId, name, parsed.isDuration]); trackers.set(name, tracker); }
      if (tracker.is_duration !== parsed.isDuration) throw new Error(`Inconsistent value type for ${name} on line ${offset + 2}.`);
      await client.query("INSERT INTO data_points (id, tracker_id, value, label, note, tracked_at) VALUES ($1, $2, $3, $4, $5, $6)", [randomUUID(), tracker.id, parsed.value, (record[labelColumn] ?? parsed.legacyLabel) || null, record[noteColumn] || null, date]); imported += 1;
    }
    await client.query("COMMIT"); return { imported };
  } catch (error) { await client.query("ROLLBACK"); return reply.code(400).send({ error: error instanceof Error ? error.message : "CSV import failed." }); } finally { client.release(); }
});

app.get("/api/trackers/:trackerId", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { trackerId } = request.params as { trackerId: string };
  if (!(await ownsTracker(user.id, trackerId))) return reply.code(404).send({ error: "Tracker not found." });
  const tracker = await db.query("SELECT id, name, description, is_duration, default_value FROM trackers WHERE id = $1", [trackerId]);
  const points = await db.query(
    "SELECT id, value, label, note, tracked_at FROM data_points WHERE tracker_id = $1 ORDER BY tracked_at DESC, created_at DESC LIMIT 100",
    [trackerId],
  );
  return { tracker: tracker.rows[0], points: points.rows };
});

app.post("/api/trackers/:trackerId/points", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { trackerId } = request.params as { trackerId: string };
  if (!(await ownsTracker(user.id, trackerId))) return reply.code(404).send({ error: "Tracker not found." });
  const body = request.body as { value?: unknown; label?: unknown; note?: unknown; trackedAt?: unknown };
  const value = number(body?.value);
  const trackedAt = typeof body?.trackedAt === "string" ? new Date(body.trackedAt) : new Date();
  if (value === null || Number.isNaN(trackedAt.valueOf())) return reply.code(400).send({ error: "Enter a valid value and time." });
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 200) || null : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 4_000) || null : null;
  const id = randomUUID();
  await db.query(
    "INSERT INTO data_points (id, tracker_id, value, label, note, tracked_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, trackerId, value, label, note, trackedAt],
  );
  return reply.code(201).send({ point: { id, value, label, note, tracked_at: trackedAt.toISOString() } });
});

await migrate();
const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (bootstrapEmail && bootstrapPassword && bootstrapPassword.length >= 10) {
  await db.query(
    "INSERT INTO app_users (id, email, password_hash, is_admin) VALUES ($1, $2, $3, TRUE) ON CONFLICT (email) DO NOTHING",
    [randomUUID(), bootstrapEmail, await hashPassword(bootstrapPassword)],
  );
}

await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
  return reply.sendFile("index.html");
});

await app.listen({ port: 3000, host: "0.0.0.0" });
