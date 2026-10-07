// Barcodes for shelf labels (FR-5.14), drawn as vector bars so they scan at any size. Pure: tested in
// Node by decoding with ZXing (hub/tests/step17-labels.test.mjs).
// encode(code) -> { type, modules: "1010..." (1 = bar, one character per narrowest bar width), text,
//                   guards: [[from, to], ...] (EAN/UPC bars that run longer) } or null.
// EAN-13 and UPC-A (as EAN-13 with a leading 0) when the check digit is right, EAN-8, else CODE128 (B).

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => p.split("").reverse().map((b) => (b === "1" ? "0" : "1")).join(""));
const R = L.map((p) => p.split("").map((b) => (b === "1" ? "0" : "1")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// Check digit of an EAN/UPC number (all digits but the last).
export function checkDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

function ean13(d) {
  const par = PARITY[Number(d[0])];
  let m = "101";
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === "L" ? L : G)[Number(d[i])];
  m += "01010";
  for (let i = 7; i <= 12; i++) m += R[Number(d[i])];
  m += "101";
  return { type: "EAN-13", modules: m, text: d, guards: [[0, 3], [45, 50], [92, 95]] };
}

function ean8(d) {
  let m = "101";
  for (let i = 0; i < 4; i++) m += L[Number(d[i])];
  m += "01010";
  for (let i = 4; i < 8; i++) m += R[Number(d[i])];
  m += "101";
  return { type: "EAN-8", modules: m, text: d, guards: [[0, 3], [31, 36], [64, 67]] };
}

// CODE128 bar/space widths, values 0-106 (106 = stop).
const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
  "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
  "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
  "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
  "311141 411131 211412 211214 211232 2331112").split(" ");

function widthsToModules(w) {
  let m = "";
  for (let i = 0; i < w.length; i++) m += (i % 2 === 0 ? "1" : "0").repeat(Number(w[i]));
  return m;
}

function code128(text) {
  const vals = [104];                                  // start B
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    vals.push(c - 32);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  return { type: "CODE128", modules: vals.map((v) => widthsToModules(C128[v])).join(""), text, guards: [] };
}

export function encode(code) {
  const c = String(code || "").trim();
  if (!c) return null;
  if (/^\d{13}$/.test(c) && checkDigit(c.slice(0, 12)) === c[12]) return ean13(c);
  if (/^\d{12}$/.test(c) && checkDigit(c.slice(0, 11)) === c[11]) return Object.assign(ean13("0" + c), { type: "UPC-A", text: c });
  if (/^\d{8}$/.test(c) && checkDigit(c.slice(0, 7)) === c[7]) return ean8(c);
  if (c.length > 40) return null;
  return code128(c);
}

export const C128_WIDTHS = C128;
