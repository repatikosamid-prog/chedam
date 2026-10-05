export const TYPES = {
  till: "Till",
  back_office_pc: "Back-office PC",
  phone: "Phone",
  tablet: "Tablet",
  customer_display: "Customer display",
  kiosk: "Kiosk",
};

export function initials(name) {
  return String(name || "?").split(/\s+/).map((w) => w[0] || "").join("").substring(0, 2).toUpperCase();
}

export function ago(iso) {
  if (!iso) return "never";
  const d = new Date(iso.replace(" ", "T"));
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.round(sec / 60) + " min ago";
  if (sec < 86400) return Math.round(sec / 3600) + " h ago";
  return d.toLocaleString();
}

export function shortUa(ua) {
  if (!ua) return "unknown";
  const ios = /iPhone OS ([\d_]+)/.exec(ua);
  const android = /Android [\d.]+/.exec(ua);
  const os = ios ? "iOS " + ios[1].replace(/_/g, ".") : android ? android[0] : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : "";
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const br = /Edg\//.test(ua) ? "Edge" : chrome ? "Chrome " + chrome[1] : /Firefox\//.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(", ") || ua.substring(0, 60);
}
