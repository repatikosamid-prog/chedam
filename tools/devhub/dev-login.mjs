// Dev only: pair a browser on the local dev hub (tools/devhub/dev-hub.sh) and sign in a sample person by
// PIN; prints {device, token} for the browser's localStorage (chedam.device, chedam.token). Never for a store.
// Usage: node tools/devhub/dev-login.mjs "Cal Cashier" "Front till"
import { readFileSync } from "node:fs";

const [,, who, devName] = process.argv;
const base = "http://127.0.0.1:8095";
const [email, pw] = readFileSync("C:/Users/Venkata/Desktop/Projects/Chedam/.devhub/superuser.txt", "utf8").trim().split(/\r?\n/);
const pins = Object.fromEntries([...readFileSync("C:/Users/Venkata/Desktop/Projects/Chedam/hub/pb_migrations_dev/1791200101_dev_sample_pins.js", "utf8").matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));
const j = async (path, body, h = {}) => (await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...h }, body: body ? JSON.stringify(body) : undefined })).json();
const su = (await j("/api/collections/_superusers/auth-with-password", { identity: email, password: pw })).token;
const code = (await j("/api/chedam/devices/pairing-code", { name: devName, type: "till" }, { Authorization: su })).code;
const p = await j("/api/chedam/devices/pair", { code });
const dev = { id: p.device_id, key: p.key };
const users = await j("/api/chedam/auth/pin-users", null, { "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key });
const u = users.find((x) => x.name === who);
const a = await j("/api/chedam/auth/pin", { user: u.id, pin: pins[who] }, { "X-Chedam-Device": dev.id, "X-Chedam-Device-Key": dev.key });
console.log(JSON.stringify({ device: dev, token: a.token }));
