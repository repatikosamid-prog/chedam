// P2 step 7: tasks, checklists, reminders (FR-2.03, 2.11, 2.12, 6.16). Manual tasks (who, due, link; the
// person ticks their own), checklists (one run a day, required items, late task), handover notes (read by the
// next people), documents expiring (a task N days before), wrong storage (product range vs area).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step27-tasks-checklists.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8120 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }), patch: (p, b) => t.api("PATCH", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff);
  const run = () => M.post("/api/chedam/reminders/run", {});
  const ruleTask = async (prefix) => (await t.list("tasks", `rule_key~'${prefix}' && status='open'`)).items;

  console.log("Tasks (FR-2.03)");
  const chips = (await C.get("/api/chedam/catalogue/lookup?code=2000000000060")).json.matches[0].product;
  check("a cashier cannot create tasks", (await C.post("/api/chedam/tasks", { title: "x" })).status === 403);
  check("a task needs a title", (await M.post("/api/chedam/tasks", { title: " " })).status === 400);
  const past = new Date(Date.now() - 3600000).toISOString();
  const tk = await M.post("/api/chedam/tasks", { title: "Face the chip shelf", owner: people["Cal Cashier"], due_at: past, link_collection: "products", link_id: chips.id, priority: "urgent" });
  check("a manager gives Cal a task with a due time and a link to the product", tk.status === 200 && tk.json.owner.name === "Cal Cashier" && tk.json.link.label === chips.name && tk.json.overdue === true, JSON.stringify(tk.json));
  const mine = (await C.get("/api/chedam/tasks?mine=1")).json.tasks;
  check("Cal sees it in their tasks, overdue and first", mine.length >= 1 && mine[0].id === tk.json.id);
  check("Sam cannot tick Cal's task", (await S.post(`/api/chedam/tasks/${tk.json.id}/done`, {})).status === 403);
  const done = await C.post(`/api/chedam/tasks/${tk.json.id}/done`, { note: "Done, 2 bags short" });
  check("Cal ticks it, with a note; who and when are kept", done.status === 200 && done.json.status === "done" && done.json.done_by === "Cal Cashier" && /2 bags short/.test(done.json.note));
  check("a manager can reopen it", (await M.post(`/api/chedam/tasks/${tk.json.id}/reopen`, {})).json.status === "open");
  check("linking to an unknown record is refused", (await M.post("/api/chedam/tasks", { title: "x", link_collection: "products", link_id: "nope" })).status === 400);

  console.log("Checklists (FR-2.11)");
  check("staff cannot set up checklists", (await S.post("/api/collections/checklists/records", { name: "X", kind: "other", items: [{ text: "a" }], active: true })).status === 403);
  check("a checklist without items is refused", (await M.post("/api/collections/checklists/records", { name: "X", kind: "other", items: [], active: true })).status === 400);
  const ck = await M.post("/api/collections/checklists/records", { name: "Closing", kind: "closing", due_time: "00:00", active: true,
    items: [{ text: "Count the till" }, { text: "Lock the back door" }, { text: "Wipe the counter", required: false }] });
  check("a manager sets up the closing checklist", ck.status === 200, JSON.stringify(ck.json));
  await run();
  check("not finished by its due time: a task", (await ruleTask("checklist:" + ck.json.id)).length === 1);
  const today = (await C.get("/api/chedam/checklists/today")).json;
  check("today's checklists: not started", today.checklists.some((x) => x.id === ck.json.id && x.run === null && x.items === 3));
  const r1 = (await C.post(`/api/chedam/checklists/${ck.json.id}/start`, {})).json;
  const r2 = (await S.post(`/api/chedam/checklists/${ck.json.id}/start`, {})).json;
  check("one run a day: starting again gives the same run", r1.id && r1.id === r2.id && r1.day === ymd(new Date()) && r1.items.length === 3);
  await C.post(`/api/chedam/checklist-runs/${r1.id}/tick`, { index: 0, done: true });
  check("finishing with a required item left is refused", (await C.post(`/api/chedam/checklist-runs/${r1.id}/complete`, {})).status === 400);
  const t2 = (await S.post(`/api/chedam/checklist-runs/${r1.id}/tick`, { index: 1, done: true, note: "Bolted" })).json;
  check("each tick keeps who and when", t2.items[0].by_name === "Cal Cashier" && t2.items[1].by_name === "Sam Staff" && t2.items[1].note === "Bolted" && !!t2.items[1].at);
  const fin = await C.post(`/api/chedam/checklist-runs/${r1.id}/complete`, {});
  check("finished (the optional item may stay open)", fin.status === 200 && fin.json.status === "done" && fin.json.completed_by === "Cal Cashier");
  check("finishing closes the late task", (await ruleTask("checklist:" + ck.json.id)).length === 0);
  check("history for managers", (await M.get(`/api/chedam/checklists/history?from=${ymd(new Date())}&to=${ymd(new Date())}`)).json.runs.some((x) => x.id === r1.id)
    && (await C.get("/api/chedam/checklists/history")).status === 403);

  console.log("Handover notes (FR-2.12)");
  check("an empty note is refused", (await C.post("/api/chedam/handover", { text: "" })).status === 400);
  const hn = await C.post("/api/chedam/handover", { text: "Cooler 2 is noisy; milk delivery comes at 7." });
  const hm = (await M.get("/api/chedam/handover")).json.notes.find((x) => x.id === hn.json.id);
  check("the next person sees it, unread, with who wrote it", hm && hm.read === false && hm.author === "Cal Cashier");
  await M.post(`/api/chedam/handover/${hn.json.id}/read`, {});
  const hm2 = (await C.get("/api/chedam/handover")).json.notes.find((x) => x.id === hn.json.id);
  check("read: the writer sees who read it", hm2.read_by.includes("Mira Manager"));

  console.log("Documents expiring (FR-2.12)");
  const in10 = new Date(Date.now() + 10 * 86400000).toISOString().replace("T", " ");
  check("a cashier cannot see documents", (await C.get("/api/collections/documents/records")).status === 403);
  const doc = await M.post("/api/collections/documents/records", { name: "Business licence", kind: "licence", number: "BL-123", expires_on: in10, remind_days: 30 });
  check("a manager adds the business licence", doc.status === 200, JSON.stringify(doc.json));
  await run();
  const dt = await ruleTask("document:" + doc.json.id);
  check("expiring within its reminder days: a task", dt.length === 1 && /Business licence expires on .* \(in 1?0 days\)/.test(dt[0].title) && dt[0].priority === "normal", JSON.stringify(dt));
  await M.patch(`/api/collections/documents/records/${doc.json.id}`, { expires_on: new Date(Date.now() + 400 * 86400000).toISOString().replace("T", " ") });
  await run();
  check("renewed: the task closes", (await ruleTask("document:" + doc.json.id)).length === 0);

  console.log("Wrong storage (FR-6.16)");
  const areas = Object.fromEntries((await t.list("storage_areas")).items.map((a) => [a.name, a.id]));
  const milk = (await t.list("products", "name~'Milk'")).items[0] || chips;
  const up = await M.patch(`/api/collections/products/records/${milk.id}`, { temp_min_c: 0, temp_max_c: 4, storage_area: areas["Dry store"] });
  check("a product needs 0–4 °C and is set to the dry store", up.status === 200, JSON.stringify(up.json));
  await run();
  const wt = await ruleTask("storage:" + milk.id);
  check("wrong storage: an urgent task naming both ranges", wt.length === 1 && wt[0].priority === "urgent" && /needs 0–4 °C but is kept in Dry store \(10–25 °C\)/.test(wt[0].title), JSON.stringify(wt));
  check("a rule task cannot be ticked by hand", (await M.post(`/api/chedam/tasks/${wt[0].id}/done`, {})).status === 400);
  await M.patch(`/api/collections/products/records/${milk.id}`, { storage_area: areas["Cooler"] });
  await run();
  check("moved to the cooler: the task closes", (await ruleTask("storage:" + milk.id)).length === 0);
} catch (e) { err = e; }
await t.finish(err);
