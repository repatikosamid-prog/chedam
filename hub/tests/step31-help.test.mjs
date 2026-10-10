// P2 step 11: help (FR-12.11). Training videos stored on the hub: added by people who manage settings (video
// files only), watched by everyone signed in; help pages ship with the app (checked in the client build).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step31-help.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8124 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const devs = {};
  const login = async (n) => {
    devs[n] = await t.pair("Device of " + n);
    return (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: devs[n] })).json.token;
  };
  const cashier = await login("Cal Cashier"), manager = await login("Mira Manager");
  // A tiny file that reads as MP4 (ftyp box)
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.from([0, 0, 0, 0]), Buffer.from("mp42isom"), Buffer.alloc(64)]);
  const upload = async (tok, who, file, type, name) => {
    const f = new FormData();
    f.append("title", "Opening the till"); f.append("topic", "till"); f.append("minutes", "2"); f.append("video", new Blob([file], { type }), name);
    const r = await fetch(t.base + "/api/collections/help_videos/records", { method: "POST", headers: { Authorization: tok, ...TestHub.deviceHeaders(devs[who]) }, body: f });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  check("a cashier cannot add videos", (await upload(cashier, "Cal Cashier", mp4, "video/mp4", "till.mp4")).status === 403);
  check("only video files", (await upload(manager, "Mira Manager", Buffer.from("not a video"), "text/plain", "x.txt")).status === 400);
  const v = await upload(manager, "Mira Manager", mp4, "video/mp4", "till.mp4");
  check("a manager adds a training video", v.status === 200 && v.json.topic === "till", JSON.stringify(v.json));
  const list = await t.api("GET", "/api/collections/help_videos/records", null, { token: cashier });
  check("everyone signed in sees it", list.status === 200 && list.json.items.some((x) => x.id === v.json.id));
  const file = await fetch(`${t.base}/api/files/${v.json.collectionId}/${v.json.id}/${v.json.video}`);
  check("the video plays from the hub", file.status === 200 && (file.headers.get("content-type") || "").startsWith("video/mp4"));
  check("signed out: the list is closed", (await t.api("GET", "/api/collections/help_videos/records")).status !== 200);
  const pages = readFileSync(join(HUB, "..", "client", "src", "lib", "help_pages.js"), "utf8");
  check("help pages for the main areas ship with the app", ["sell", "pay", "returns", "offline", "stock", "promotions", "customers", "team", "messages", "inbox", "backups"].every((id) => pages.includes(`id: "${id}"`)));
} catch (e) { err = e; }
await t.finish(err);
