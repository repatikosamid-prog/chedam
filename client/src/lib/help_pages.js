// Built-in help (P2 step 11, FR-12.11): short pages in plain words, part of the app so they work offline.
// Each page: id, title, the screens it explains (the Help button opens the page of the screen you are on),
// words to find it by, and blocks: {p}, {steps: [...]}, {tip}, {warn}.

export const PAGES = [
  { id: "start", title: "Getting started", screens: ["home"], words: "sign in pin home device name lock",
    body: [
      { p: "Chedam runs on the store's own hub (the small computer by the router). Every till, phone and PC talks to it over the store Wi-Fi." },
      { steps: ["Pick your name and type your PIN.", "Home shows what you can use. Tap a tile to open it.", "The C logo at the top always brings you back to Home.", "Chedam locks itself after a few minutes without use; pick your name again to carry on."] },
      { tip: "The coloured bar at the very top says whether the hub and the internet are reachable. Selling keeps working when the internet is down." },
    ] },
  { id: "sell", title: "Selling", screens: ["sell"], words: "sale scan barcode plu cart quantity discount weight pay",
    body: [
      { steps: ["Scan the barcode, type a PLU and press Add, or tap a product in the grid.", "Change the quantity with − and +, or tap the item to change it.", "Remove one item with ✕. The whole sale: Clear sale.", "Discount one item: 'Discount this item'. The whole sale: Sale discount.", "Press Pay when everything is in."] },
      { p: "Deals (promotions, near-expiry markdowns) are taken off by themselves and shown in green under each item." },
      { tip: "Training mode lets new people practise: training sales never change stock, money or reports." },
    ] },
  { id: "pay", title: "Payments and receipts", screens: ["sell", "sales"], words: "cash card change rounding split receipt print pdf reprint usd store credit",
    body: [
      { steps: ["Cash: tap a note button or type the amount; Chedam shows the change (cash is rounded to 5¢).", "Card: take the payment on the card terminal, then press Card approved.", "Split: pay part by one method, the rest by another.", "US cash: Chedam converts at the store's rate."] },
      { p: "The receipt stays 15 seconds so you can print it or save it as a PDF, then the till is back to selling. Tap the receipt to keep it on the screen." },
      { tip: "A reprint needs a manager's approval: it is recorded." },
    ] },
  { id: "returns", title: "Returns and exchanges", screens: ["returns"], words: "refund return exchange receipt store credit damaged",
    body: [
      { steps: ["Sell → Return, then scan or type the receipt number.", "Pick the items coming back and whether they go back on the shelf.", "Choose how to refund: the way it was paid, cash, or store credit.", "No receipt: refunds are limited and may need a manager."] },
      { p: "An exchange: ring up the new items, the returned items are taken off the total." },
    ] },
  { id: "till", title: "Opening and closing the till", screens: ["till"], words: "float open close z report count cash drop payout no sale",
    body: [
      { steps: ["Open: count the float and enter it.", "During the day: cash drop, pay-out, no sale are recorded with a reason.", "Close: count the cash by note and coin; Chedam shows the Z report and any difference."] },
      { tip: "Tills and the card terminal are reconciled later in Reports → Tills." },
    ] },
  { id: "offline", title: "When the hub or internet is down", screens: ["sell"], words: "offline down no internet hub off queue upload",
    body: [
      { p: "No internet: everything works; only email and updates wait." },
      { p: "Hub off: the till keeps selling with its own copy of products, prices, deals and members. Sales get an offline number and go to the hub by themselves when it is back. Card payments still go through the card terminal." },
      { warn: "Do not clear the browser's data on a till while it has offline sales waiting." },
    ] },
  { id: "products", title: "Products and prices", screens: ["products", "product", "categories"], words: "product price barcode pack case unit cost category draft import",
    body: [
      { steps: ["Products → New product: name, category, tax, price, barcode.", "Packs and cases: add selling units (e.g. a 12-pack) with their own barcode and price.", "A product stays Draft until it has what selling needs; Draft products cannot be sold."] },
      { tip: "Many products at once: Import and export → download the template, fill it in Excel or Google Sheets, upload it." },
    ] },
  { id: "stock", title: "Stock: receiving, counting, damage", screens: ["stock", "stockitem", "receive", "counts", "approvals", "shrink"], words: "stock receive delivery count damage expiry lot fefo",
    body: [
      { steps: ["Receive: scan each item of the delivery, enter the quantity, the cost and the expiry date.", "Count: start a count for a category or area, scan and type what is there; a manager approves differences.", "Damage or loss: Stock → the product → Damaged, with a reason (and a photo)."] },
      { p: "Products with an expiry are sold oldest first. Green means received, blue means sold in the recent changes." },
    ] },
  { id: "labels", title: "Shelf labels", screens: ["labels"], words: "label print shelf price tag sale sticker",
    body: [
      { p: "Price changes and deals put the product on the label list by themselves. Labels → print the list as a PDF on label sheets." },
      { tip: "Near-expiry stickers show the % off for marked-down lots." },
    ] },
  { id: "promotions", title: "Promotions and markdowns", screens: ["promotions"], words: "promotion deal sale coupon buy get multi price spend markdown staff discount",
    body: [
      { steps: ["Promotions → New: choose the kind (% off, $ off, sale price, buy X get Y, X for $Y, mix and match, spend threshold).", "Choose the products or categories, the dates, days and hours.", "Preview shows the regular and deal price and the margin; it warns below cost.", "A coupon code makes it a coupon: the cashier enters it at the till."] },
      { p: "Near-expiry markdowns and staff discounts are switched on in Promotions → settings." },
    ] },
  { id: "customers", title: "Customers and loyalty", screens: ["customers"], words: "customer loyalty points card member join phone privacy delete",
    body: [
      { steps: ["At the till: Customer → phone number or scan the card → Find.", "Not a member yet: first name, phone and/or card, tick 'Customer agreed', Join.", "Use points: the points come off before tax.", "The receipt shows points earned and the balance."] },
      { p: "The owner sets the points (per $1 and for $1 off). Until then customers can join but earn nothing." },
      { tip: "Customers are never contacted. A customer can ask for their data or to be deleted: Customers → the customer → Their data / Delete." },
    ] },
  { id: "display", title: "Customer display", screens: ["devices", "sell"], words: "customer display screen second monitor tablet",
    body: [
      { steps: ["Pair a tablet, phone or small PC as type 'Customer display'.", "Devices → the display → 'Shows the sale of': choose the till.", "It shows the items, savings, total and 'Thank you'; the store's logo when idle."] },
      { tip: "A laptop till with a second monitor: Sell → Customer screen, and drag the window to the monitor facing the customer." },
    ] },
  { id: "reports", title: "Dashboard and reports", screens: ["dashboard", "reports"], words: "dashboard report insights sales margin tills reconcile loss audit export",
    body: [
      { p: "Dashboard: what needs attention first, then today and the month against last week and last month, stock health." },
      { steps: ["Reports → Insights: busy times, best and slowest sellers, sell-through, against last year.", "Tills: enter the card terminal's total to reconcile each closed till.", "Promotions and Loyalty: results of deals, members and points.", "Loss prevention and Audit log: who did what, when."] },
      { tip: "Every table has Export (Excel or CSV)." },
    ] },
  { id: "team", title: "Tasks, checklists and handover", screens: ["team"], words: "task checklist opening closing handover note licence insurance reminder",
    body: [
      { steps: ["Tasks: managers give tasks with a due time; the person ticks Done.", "Checklists: open Opening or Closing, tick each item, then Finish.", "Handover notes: leave a note for the next shift; the next people press Read it.", "Licences and insurance: add the expiry date; Chedam reminds you 30 days before."] },
      { p: "Chedam also opens tasks by itself (low stock, wrong storage, backups). They close when the problem is fixed." },
    ] },
  { id: "messages", title: "Messages, announcements and pings", screens: ["messages", "pings"], words: "message chat group announcement ping urgent mention",
    body: [
      { steps: ["💬 Messages: Everyone, groups or one person. Type @ to mention someone; 📎 for a photo; 🔗 to link a product.", "📌 Announcements: managers post; press 'I have read this' when asked.", "📣 Ping: a quick message to a till, all tills, phones or everyone. Urgent fills their screen until someone answers."] },
      { tip: "A ping never interrupts a sale: it shows over the Sell screen, the cart stays." },
    ] },
  { id: "inbox", title: "Inbox and the end-of-day report", screens: ["inbox"], words: "inbox report end of day alert email",
    body: [
      { p: "📥 Inbox: the end-of-day report every evening (for the owner and the people chosen), and urgent alerts." },
      { tip: "Inbox → Settings: choose what you receive. Email if unread comes when the owner connects Gmail or Outlook." },
    ] },
  { id: "devices", title: "Devices and people", screens: ["devices", "wizard"], words: "device pair approve lock remove people pin role permission",
    body: [
      { steps: ["Devices → Pair a new device: give it a name and type, scan the QR code on the device.", "A lost phone: Lock or Remove it at once.", "People and roles: Store setup → Team. Each person has a PIN; managers can reset PINs."] },
    ] },
  { id: "backups", title: "Backups, updates and hub health", screens: ["backups", "updates", "health"], words: "backup usb restore update health temperature",
    body: [
      { p: "The hub backs up by itself every night to the USB drive. Backups shows the last one; 'Back up now' makes one at once." },
      { p: "Updates are checked every day; the owner installs them (and can go back)." },
      { warn: "Keep the backup USB drive in the hub. Keep the printed recovery key somewhere safe, away from the store." },
    ] },
];

export function pageFor(screen) { return PAGES.find((p) => p.screens.includes(screen)) || PAGES[0]; }

export function search(q) {
  const w = String(q || "").toLowerCase().trim();
  if (!w) return PAGES;
  return PAGES.filter((p) => (p.title + " " + p.words + " " + p.body.map((b) => b.p || b.tip || b.warn || (b.steps || []).join(" ")).join(" ")).toLowerCase().includes(w));
}
