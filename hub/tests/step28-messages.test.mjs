// P2 step 8: messages and announcements (FR-2.04, 2.05). Everyone channel, groups, one-to-one; mentions,
// links, reactions, read receipts, removing; live delivery through realtime only to members; announcements
// that need acknowledging, and managers seeing who has and has not.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step28-messages.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8121 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

// A realtime listener: collects the records of "messages" events this person receives.
async function listen(token, dev) {
  const ctl = new AbortController();
  const res = await fetch(t.base + "/api/realtime", { signal: ctl.signal });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", clientId = "";
  const got = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event:(.*)$/m) || [])[1], data = (block.match(/^data:(.*)$/m) || [])[1];
          if (!ev || !data) continue;
          const d = JSON.parse(data);
          if (ev.trim() === "PB_CONNECT") clientId = d.clientId;
          else if (ev.trim() === "messages") got.push(d.record);
        }
      }
    } catch { /* closed */ }
  })();
  for (let k = 0; k < 50 && !clientId; k++) await new Promise((r) => setTimeout(r, 100));
  const sub = await fetch(t.base + "/api/realtime", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token, ...TestHub.deviceHeaders(dev) },
    body: JSON.stringify({ clientId, subscriptions: ["messages"] }) });
  return { ok: sub.status === 204, got, close: () => { ctl.abort(); return pump; } };
}

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    const dev = await t.pair("Device of " + n);
    devs[n] = dev;
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager"), staff = await login("Sam Staff");
  const as = (tok) => ({ get: (p) => t.api("GET", p, null, { token: tok }), post: (p, b) => t.api("POST", p, b, { token: tok }) });
  const C = as(cashier), M = as(manager), S = as(staff);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log("Channels (FR-2.04)");
  const ch0 = (await C.get("/api/chedam/messages/channels")).json;
  const everyone = ch0.channels.find((x) => x.kind === "everyone");
  check("everyone is in the Everyone channel", !!everyone && everyone.members.length >= 4, JSON.stringify(ch0.channels));
  const dm = await C.post("/api/chedam/messages/channels", { kind: "direct", members: [people["Mira Manager"]] });
  const dm2 = await M.post("/api/chedam/messages/channels", { kind: "direct", members: [people["Cal Cashier"]] });
  check("one conversation per pair (from either side)", dm.status === 200 && dm.json.id === dm2.json.id);
  check("a group needs a name and another person", (await C.post("/api/chedam/messages/channels", { kind: "group", name: "", members: [people["Sam Staff"]] })).status === 400
    && (await C.post("/api/chedam/messages/channels", { kind: "group", name: "Solo", members: [] })).status === 400);
  const grp = await M.post("/api/chedam/messages/channels", { kind: "group", name: "Morning shift", members: [people["Sam Staff"]] });
  check("a manager makes the Morning shift group with Sam", grp.status === 200);
  check("Cal is not in it: cannot read it", (await C.get(`/api/chedam/messages/channels/${grp.json.id}`)).status === 404);
  check("Cal cannot change it", (await C.post(`/api/chedam/messages/channels/${grp.json.id}`, { name: "x" })).status === 404);

  console.log("Messages, live");
  const calL = await listen(cashier, devs["Cal Cashier"]), samL = await listen(staff, devs["Sam Staff"]);
  check("realtime subscriptions accepted", calL.ok && samL.ok);
  const chips = (await C.get("/api/chedam/catalogue/lookup?code=2000000000060")).json.matches[0].product;
  const m1 = await M.post("/api/chedam/messages", { channel: dm.json.id, text: "Cal, please check the chips @Cal", mentions: [people["Cal Cashier"], people["Sam Staff"]], link_collection: "products", link_id: chips.id });
  check("a message with a mention and a link to the product", m1.status === 200 && m1.json.link.label === chips.name && JSON.stringify(m1.json.mentions) === JSON.stringify([people["Cal Cashier"]]), JSON.stringify(m1.json));
  await wait(800);
  check("Cal receives it live", calL.got.some((r) => r.id === m1.json.id));
  check("Sam (not in the conversation) does not", !samL.got.some((r) => r.id === m1.json.id));
  check("Sam cannot read it through the API either", (await S.get(`/api/collections/messages/records/${m1.json.id}`)).status === 404);
  const cl = (await C.get("/api/chedam/messages/channels")).json.channels.find((x) => x.id === dm.json.id);
  check("unread for Cal, with a mention", cl.unread === 1 && cl.mentioned === true && cl.name === "Mira Manager", JSON.stringify(cl));
  check("the unread badge", (await C.get("/api/chedam/messages/unread")).json.unread >= 1);
  await C.post(`/api/chedam/messages/channels/${dm.json.id}/read`, {});
  const seen = (await M.get(`/api/chedam/messages/channels/${dm.json.id}`)).json;
  check("read receipt: Mira sees Cal read it", seen.reads.some((r) => r.name === "Cal Cashier" && r.at >= m1.json.created_at), JSON.stringify(seen.reads));
  check("after reading: nothing unread", (await C.get("/api/chedam/messages/channels")).json.channels.find((x) => x.id === dm.json.id).unread === 0);
  const r1 = await C.post(`/api/chedam/messages/${m1.json.id}/react`, { emoji: "👍" });
  check("a reaction", r1.status === 200 && r1.json.reactions["👍"].count === 1 && r1.json.reactions["👍"].mine === true);
  check("the same reaction again takes it back", !(await C.post(`/api/chedam/messages/${m1.json.id}/react`, { emoji: "👍" })).json.reactions["👍"]);
  check("unknown reactions refused", (await C.post(`/api/chedam/messages/${m1.json.id}/react`, { emoji: "💩" })).status === 400);
  check("only the author (or a manager) removes a message", (await C.post(`/api/chedam/messages/${m1.json.id}/remove`, {})).status === 403);
  const rm = await M.post(`/api/chedam/messages/${m1.json.id}/remove`, {});
  check("removed: the text goes, the message stays as removed", rm.status === 200 && rm.json.removed === true && rm.json.text === "" && rm.json.link === null);
  const ev = await M.post("/api/chedam/messages", { channel: everyone.id, text: "Truck at 2 pm" });
  await wait(800);
  check("Everyone channel: Sam and Cal both get it live", calL.got.some((r) => r.id === ev.json.id) && samL.got.some((r) => r.id === ev.json.id));
  check("an empty message is refused", (await C.post("/api/chedam/messages", { channel: everyone.id, text: " " })).status === 400);
  const form = new FormData();
  form.append("channel", everyone.id); form.append("text", "Photo of the shelf");
  form.append("attachment", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" }), "shelf.png");
  const up = await fetch(t.base + "/api/chedam/messages", { method: "POST", headers: { Authorization: staff, ...TestHub.deviceHeaders(devs["Sam Staff"]) }, body: form });
  const upj = await up.json();
  check("a photo attachment", up.status === 200 && upj.attachment && upj.attachment.image === true, JSON.stringify(upj));
  await calL.close(); await samL.close();

  console.log("Announcements (FR-2.05)");
  check("a cashier cannot post announcements", (await C.post("/api/chedam/announcements", { title: "x" })).status === 403);
  const an = await M.post("/api/chedam/announcements", { title: "New till procedure", text: "Count the float twice.", needs_ack: true });
  check("a manager posts one that needs acknowledging", an.status === 200);
  check("waiting for Cal to acknowledge", (await C.get("/api/chedam/messages/unread")).json.to_ack === 1);
  const a1 = (await C.get("/api/chedam/announcements")).json.announcements.find((x) => x.id === an.json.id);
  check("Cal sees it, not acknowledged, without the list of others", a1 && a1.acked === false && a1.acks === undefined);
  await C.post(`/api/chedam/announcements/${an.json.id}/ack`, {});
  await C.post(`/api/chedam/announcements/${an.json.id}/ack`, {});
  const a2 = (await M.get("/api/chedam/announcements")).json.announcements.find((x) => x.id === an.json.id);
  check("the manager sees Cal has read it (once) and who has not", a2.acks.length === 1 && a2.acks[0].name === "Cal Cashier" && a2.waiting.includes("Sam Staff") && !a2.waiting.includes("Cal Cashier"), JSON.stringify(a2));
  check("nothing left for Cal", (await C.get("/api/chedam/messages/unread")).json.to_ack === 0);
  check("a cashier cannot end it", (await C.post(`/api/chedam/announcements/${an.json.id}/end`, {})).status === 403);
  await M.post(`/api/chedam/announcements/${an.json.id}/end`, {});
  check("ended: no longer shown", !(await S.get("/api/chedam/announcements")).json.announcements.some((x) => x.id === an.json.id));
} catch (e) { err = e; }
await t.finish(err);
