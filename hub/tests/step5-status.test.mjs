// P0 step 5 (hub side): connectivity status for the client's connectivity bar (FR-12.01).
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step5-status.test.mjs
import { TestHub } from "./lib/hub.mjs";

const t = new TestHub({ port: 8096 });
const check = t.check.bind(t);
let err = null;
try {
  await t.start();
  console.log("Connectivity status");
  const s = await t.api("GET", "/api/chedam/status");
  check("open without sign-in or device", s.status === 200, JSON.stringify(s.json));
  check("internet is offline, router or hotspot", ["offline", "router", "hotspot"].includes(s.json.internet));
  check("hub clock included (BR-30 time check)", Math.abs(new Date(s.json.hub_time) - Date.now()) < 60000);

  const setting = async (key, value) => {
    const r = (await t.list("settings", `key='${key}'`)).items[0];
    return t.su_("PATCH", `/api/collections/settings/records/${r.id}`, { value });
  };
  await setting("network.check_url", "http://127.0.0.1:9/nothing-here");
  const off = await t.su_("GET", "/api/chedam/status?check=1");
  check("unreachable check address = offline", off.json.internet === "offline", JSON.stringify(off.json));
  await setting("network.check_url", `${t.base}/api/health`);
  const on = await t.su_("GET", "/api/chedam/status?check=1");
  check("reachable check address = online (router: not on a hotspot Wi-Fi)", on.json.internet === "router", JSON.stringify(on.json));
  check("a guest cannot force a check (cached answer)", (await t.api("GET", "/api/chedam/status?check=1")).json.checked_at === on.json.checked_at);

  const p = await t.api("POST", "/api/chedam/devices/request", { name: "Waiting tablet", type: "tablet" });
  const waiting = { id: p.json.device_id, key: p.json.key };
  check("a waiting device still sees the status", (await t.api("GET", "/api/chedam/status", null, { device: waiting })).status === 200);
} catch (e) {
  err = e;
}
await t.finish(err);
