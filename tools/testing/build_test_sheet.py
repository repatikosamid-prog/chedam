"""Builds the manual test sheet for Sreya: docs/testing/Chedam-Manual-Tests-P1-1-10.xlsx

One row per check: what to do and what should happen, with a Pass / Fail / Blocked / Not tested choice,
notes, tester and date. A Summary tab counts the results per area. Rerun after adding checks; it
overwrites the sheet, so fill in a copy (or rename it) once testing starts.
--retest: the retest sheet for the fixes and changes from testing feedback (RETEST), in its own file,
so the main sheet being filled in is left alone.
--p2: the P2 sheet (P2_TESTS), grown step by step.
Usage: python tools/testing/build_test_sheet.py [--retest | --p2]
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parents[2] / "docs" / "testing" / "Chedam-Manual-Tests-P1-1-10.xlsx"

# (id, area, device / needs, what to do, what should happen)
TESTS = [
    # ---- A. Setup, sign-in and access (P0)
    ("A01", "Setup and access", "Laptop", "Open https://chedam.local", "The app opens with no certificate warning; the top bar says Online"),
    ("A02", "Setup and access", "iPhone", "Open https://chedam.local on the phone (after the device setup page)", "No warning; the app opens"),
    ("A03", "Setup and access", "Laptop + phone", "Manager: Devices → Pair a new device. Enter the code on a new browser", "The new browser is paired and shows the name list"),
    ("A04", "Setup and access", "Any paired device", "Choose a cashier, enter their PIN", "Signed in; Home shows their tiles"),
    ("A05", "Setup and access", "Any paired device", "Enter a wrong PIN several times", "Clear error each time; after repeated tries the person is locked for a while"),
    ("A06", "Setup and access", "Laptop", "Owner: sign in with email and password, then Owner account → Change my PIN", "New PIN works at the next sign-in"),
    ("A07", "Setup and access", "New browser", "Open the app in a browser that was never paired", "\"This browser is not paired\" with a Pair button"),
    ("A08", "Setup and access", "Laptop", "Store setup: open Language, Clock, Owner account, Business profile; save each", "Each opens and saves; the 'steps left' count on Home goes down"),
    ("A09", "Setup and access", "Laptop", "Business profile: look at the GST/HST, PST and BN numbers", "Temporary numbers 999999999 RT0001 / PST-9999-9999 / 999999999 (replace before selling for real)"),
    ("A10", "Setup and access", "Laptop", "Devices: lock a device, try to use it, then unlock", "Locked device cannot be used; works again after unlock"),
    ("A11", "Setup and access", "Laptop", "Sign in as a cashier: open Products and a product", "No cost or margin shown anywhere"),
    ("A12", "Setup and access", "Laptop", "Home → Hub health", "Everything green (disk, memory, temperature, backup)"),
    ("A13", "Setup and access", "Laptop", "Home → Backups: Back up now, then Restore test", "Backup verified; restore test OK"),
    ("A14", "Setup and access", "Laptop", "Home → Updates", "Shows the installed version"),
    # ---- B. Products (step 1)
    ("B01", "Products", "Laptop", "New product with only a name; save", "Saved as a Draft with the missing items listed; cannot be sold"),
    ("B02", "Products", "Laptop", "Complete it (category, tax class, price, barcode) and make it active", "Active; can be scanned at the till"),
    ("B03", "Products", "Laptop", "Add a 6-pack unit made of singles", "Pack price and barcode saved; stock counts packs and singles"),
    ("B04", "Products", "Laptop", "Give a second product the same barcode", "Refused with the other product's name"),
    ("B05", "Products", "Laptop", "Change a price", "Price history shows old and new price"),
    ("B06", "Products", "Laptop", "Fill in 'Size of one' (e.g. 200 g) on a packaged product", "Saved; the unit price shows on labels (H08)"),
    ("B07", "Products", "Laptop", "Categories and Tax screens", "Categories can be added and edited; GST 5% and PST 7% shown"),
    # ---- C. Stock (step 2)
    ("C01", "Stock", "Phone", "Receive stock: scan with the camera, enter qty, cost, expiry", "On hand goes up by the amount received"),
    ("C02", "Stock", "Phone", "Adjust stock with a reason (damaged)", "Stock goes down; shows in the shrink report (manager)"),
    ("C03", "Stock", "Phone", "Large adjustment as staff", "Waits for a manager in Approvals"),
    ("C04", "Stock", "Phone", "Stock count: count a product, submit, approve", "On hand set to the count; variance shown"),
    ("C05", "Stock", "Phone", "Break a pack into singles", "Pack count −1, singles +6"),
    # ---- D. Selling (step 3)
    ("D01", "Selling", "Till", "Till → Open till: count the float by notes and coins", "Till open with the counted float"),
    ("D02", "Selling", "Till", "Scan products (USB scanner or camera); type PLU 4011 and a weight", "Lines added; bananas priced by weight"),
    ("D03", "Selling", "Till", "Line discount within 10%, then above 10%", "Within: applied. Above: asks for a manager's PIN"),
    ("D04", "Selling", "Till", "Change a price with a reason", "New price used; above the limit asks for a manager's PIN"),
    ("D05", "Selling", "Till", "Sell the vape pods (age restricted)", "Asks to check ID before payment"),
    ("D06", "Selling", "Till", "Pay cash with a $20 note", "Total rounded to 5¢ for cash; correct change shown"),
    ("D07", "Selling", "Till", "Pay by card (record approved, last 4)", "Sale done; exact amount, no rounding"),
    ("D08", "Selling", "Till", "Split: part cash, part card", "Both payments on the receipt"),
    ("D09", "Selling", "Till", "Pay with US cash", "Converted at the store's rate; change in CAD"),
    ("D10", "Selling", "Till", "Hold a sale, start another, recall the first", "Held sale comes back intact"),
    ("D11", "Selling", "Till", "Training mode on: make a sale", "Marked TRAINING; stock and Z report money unchanged"),
    ("D12", "Selling", "Till", "Tax-exempt sale with a reason and reference", "Tax removed as the reason says; listed in the tax-exempt report"),
    ("D13", "Selling", "Till", "Void the last sale as a cashier", "Asks for a manager's PIN; stock goes back"),
    ("D14", "Selling", "Till", "Cash drop, pay-out (manager), no-sale with a reason", "Each recorded; expected cash changes accordingly"),
    ("D15", "Selling", "Till", "Close the till: count the drawer", "Z report: sales, taxes by type, payments, expected vs counted, over/short"),
    ("D16", "Selling", "Till", "Sell a cola", "Bottle deposit line added and taxed as set"),
    # ---- E. Offline (step 4)
    ("E01", "Offline", "Till + Pi", "Start a sale, switch the Pi off, finish the sale", "Offline receipt (OFF-…); '1 offline sale waiting'"),
    ("E02", "Offline", "Till + Pi", "Pi off BEFORE opening the till: open the till, sell", "Till opens on the device; sales work"),
    ("E03", "Offline", "Till + Pi", "Switch the Pi back on", "Waiting count goes to 0 by itself; the till gets its number"),
    ("E04", "Offline", "Till + Pi", "Pi off, reload the page", "Still signed in; can keep selling"),
    ("E05", "Offline", "Till + Pi", "Pi off: try to close the till, a return, store credit", "Each says it needs the hub"),
    # ---- F. Receipts and printer (step 5)
    ("F01", "Receipts and printer", "Laptop", "Home → Receipt printer → Preview (80 mm and 58 mm)", "The last sale as it will print; lines fit the paper"),
    ("F02", "Receipts and printer", "Till", "Look at a cash receipt", "GST/PST numbers; Total, then Cash rounding, then Total in cash; return barcode"),
    ("F03", "Receipts and printer", "Till", "Print on this device", "Browser print of the receipt"),
    ("F04", "Receipts and printer", "Laptop", "Sales → open a sale → Reprint", "Reprint works (marked COPY on the printer)"),
    ("F05", "Receipts and printer", "NEEDS PRINTER", "Receipt printer → Find printers → Test print", "Printer found; test page readable, 48-character ruler fits"),
    ("F06", "Receipts and printer", "NEEDS PRINTER + DRAWER", "Test with drawer", "Drawer opens"),
    ("F07", "Receipts and printer", "NEEDS PRINTER + DRAWER", "Cash sale; then a card sale", "Cash: prints and drawer opens. Card: prints, drawer stays shut"),
    ("F08", "Receipts and printer", "NEEDS PRINTER + DRAWER", "No sale (open drawer) with a reason; Print X report; close → Print Z report", "Drawer opens once; reports print"),
    ("F09", "Receipts and printer", "NEEDS PRINTER", "Sale over $150 → Full tax receipt (name)", "Receipt shows 'Sold to: <name>' and 'Terms: paid in full'"),
    ("F10", "Receipts and printer", "NEEDS PRINTER", "Switch the printer off, make a sale", "Clear message; sale saved; Print on this device works"),
    ("F11", "Receipts and printer", "NEEDS PRINTER", "Scan the barcode on a printed receipt in Returns", "Finds the sale"),
    # ---- G. Returns (step 6)
    ("G01", "Returns", "Till", "Sell → Return → type or scan the receipt number; return 1 of 2 items", "Refund = price paid + its tax (and deposit)"),
    ("G02", "Returns", "Till", "Find a sale by date + total, and by card last 4", "The sale is found"),
    ("G03", "Returns", "Till", "Return an item from a sale that had a cart discount", "Refund is the discounted price, not the shelf price"),
    ("G04", "Returns", "Till", "Refund in cash", "Rounded to 5¢; till's expected cash goes down"),
    ("G05", "Returns", "Till", "Refund to card (on the terminal)", "Cannot exceed what the card paid"),
    ("G06", "Returns", "Till", "As a cashier, refund over $50", "Asks for a manager's PIN"),
    ("G07", "Returns", "Till", "No receipt: scan the product", "Manager's PIN; store credit only, at the lowest price of 30 days"),
    ("G08", "Returns", "Till", "Pay a new sale with the store credit code", "Credit used; balance left if any"),
    ("G09", "Returns", "Till", "Exchange for a cheaper item, then for a dearer item", "Cheaper: difference refunded. Dearer: customer pays the difference"),
    ("G10", "Returns", "Till", "Return one item 'Back to stock' and one 'Damaged'", "Stock up for the first only; damaged shows in the shrink report"),
    ("G11", "Returns", "Till", "Return 'to vendor'", "A task 'Send back to the vendor' appears"),
    ("G12", "Returns", "Till", "Try to return more than sold; void a sale that has a return", "Both refused with a clear message"),
    ("G13", "Returns", "Till", "Close the till after returns", "Z report lists returns, tax refunded, refunds by method"),
    # ---- H. Labels (step 7; after step 7 is on the Pi)
    ("H01", "Labels", "Laptop", "Home → Labels as manager or staff; as cashier", "Manager/staff see it; cashier does not"),
    ("H02", "Labels", "Laptop", "Change a product's price", "It appears under To print with 'new price'"),
    ("H03", "Labels", "Phone", "Add by scanning, by category, by name search; add the same product twice", "One line per product (merged)"),
    ("H04", "Labels", "Laptop + printer", "Labels → Layouts → Alignment page; print at 100% on plain paper; hold over a label sheet", "Boxes line up with the labels (else set the printer offset)"),
    ("H05", "Labels", "Laptop + printer", "Make the PDF starting at a position on a used sheet; print at 100%", "Labels start at the chosen position and fit the sheet"),
    ("H06", "Labels", "Till", "Scan the barcode printed on a label", "The till finds the product"),
    ("H07", "Labels", "Laptop", "Printed fine; then Printed → Print again", "To print empties; reprint gives the same labels"),
    ("H08", "Labels", "Laptop", "Label of a product with a size (B06) and of bananas", "Unit price per 100 g / 100 mL; bananas price per kg with PLU"),
    ("H09", "Labels", "Laptop", "New layout that is too wide for the page", "Refused, says by how much"),
    ("H10", "Labels", "Laptop", "Template: turn on French name and origin", "Both appear on the labels"),
    # ---- J. Import and export (step 8; after step 8 is on the Pi)
    ("J01", "Import and export", "Laptop", "Home → Import and export: choose a product file exported from another system (or a spreadsheet you made)", "Shows the file type, rows and a preview; column names row found"),
    ("J02", "Import and export", "Laptop", "Next: columns", "Each column has a suggested field with high / medium / low; change any that are wrong"),
    ("J03", "Import and export", "Laptop", "Next: values: match categories and tax values; choose options", "Existing categories matched; new ones marked to be created; tax values set"),
    ("J04", "Import and export", "Laptop", "Next: check; look at Errors, Drafts, Warnings, Already there", "Duplicate barcodes and bad values shown with the line number; nothing saved yet"),
    ("J05", "Import and export", "Laptop", "Fix one row; exclude one row; 'Set for the rows shown' a category", "Check runs again; counts change"),
    ("J06", "Import and export", "Laptop", "Import", "Done in seconds; counts match the check; products appear in Products (Drafts with reasons)"),
    ("J07", "Import and export", "Laptop", "Import a file with an error you did not fix or exclude (Import stays disabled), then a file of 2001 rows", "Cannot import with errors; 2001 rows refused"),
    ("J08", "Import and export", "Laptop", "Import as Sam Staff", "New products come in as Drafts for a manager to activate"),
    ("J09", "Import and export", "Laptop", "Products / Stock / Sales → Export → CSV, Excel, PDF", "Files open in Excel / a PDF reader with the rows shown on screen"),
    ("J10", "Import and export", "Laptop (owner)", "Import and export → Download everything (zip)", "Zip with tables (CSV, JSON), data dictionary and README; no passwords or PINs inside"),
    # ---- K. Reports (step 9; after step 9 is on the Pi)
    ("K01", "Reports", "Laptop", "After closing a till: Home → Reports → Tills", "The till with sales, cash expected / counted / over or short, cards; flags such as 'Card settlement not entered'"),
    ("K02", "Reports", "Laptop + card terminal", "Reconcile: enter the terminal's end-of-day total and batch number for that till", "Balanced: reconciled. Not balanced: asks for a note, then reconciled with the note"),
    ("K03", "Reports", "Till + Pi", "Make a sale offline on a till, close the till, then switch the Pi on", "Tills shows '1 sale arrived after closing'"),
    ("K04", "Reports", "Laptop", "Reports → Loss prevention for the week; tap a cashier", "Voids, removed lines, discounts, overrides, no-sales, refunds per cashier; flags; the events with times and receipts"),
    ("K05", "Reports", "Laptop", "Reports → Audit log: filter by a person, by Products, by a receipt number", "Who, when, which device; open a row: before → after"),
    ("K06", "Reports", "Laptop", "Audit log as a person without costs.view (if you set one up)", "Cost changes are not shown"),
    ("K07", "Reports", "Laptop", "Admin dashboard (https://chedam.local/_/): try to delete a sale", "Refused: kept for 6 years"),
    ("K08", "Reports", "Laptop", "Export each report (CSV / Excel / PDF)", "Files open with the same rows"),
    # ---- L. P1 gate (step 10): with real devices; Claude runs the tools when you are ready
    ("L01", "P1 gate", "Laptop + iPhone + Android", "Sign in on three devices at once (laptop, iPhone, Android 9) and ring up sales on all three for 10 minutes; one also returns, one opens the till offline", "All sales on the Sales list; Z reports right; nothing stuck in 'waiting to upload'"),
    ("L02", "P1 gate", "Android 9", "Scan a barcode with the Android phone's camera (Sell or Stock → Receive)", "The product is found (iPhone already confirmed 2026-10-07)"),
    ("L03", "P1 gate", "Pi + laptop", "Power pull mid-sale ×10: Claude starts tools/powertest/sale-writer.mjs; pull the Pi's plug while it sells, wait 5 s, plug back in; 10 times", "Every cycle PASS: no confirmed sale lost or half-saved, stock consistent, databases ok"),
    ("L04", "P1 gate", "Pi + spare SD card", "Restore drill: the newest backup onto a spare card (docs/P0-backup-restore.md), time it", "Under 15 minutes; sales, stock and people as before; tills sign in"),
    ("L05", "P1 gate", "Laptop", "Look at Reports → Tills after the 3-device test", "Each till reconciled; no unexplained flags"),
    ("L06", "P1 gate", "Store", "Pilot: use Chedam in the store for at least one week", "No lost sales; issues written down"),
    # ---- I. Reliability
    ("I01", "Reliability", "Pi", "Pull the Pi's power while nothing is happening; plug back in", "Back within ~2 minutes; tills reconnect by themselves"),
    ("I02", "Reliability", "Pi + till", "Pull the Pi's power during a sale", "Till finishes offline; uploads after the Pi is back; nothing lost or doubled"),
    ("I03", "Reliability", "Router", "Restart the Wi-Fi router", "Hub comes back on the network by itself"),
    ("I04", "Reliability", "Laptop", "Next morning: Backups", "Last night's backup listed as verified"),
]

# Fixes and changes from Sreya's testing on 2026-10-09 (DL-109..113): retest these on the laptop and iPhone.
RETEST_OUT = Path(__file__).resolve().parents[2] / "docs" / "testing" / "Chedam-Retest-2026-10-09.xlsx"
RETEST = [
    ("R01", "Sell", "Till", "Ring up 3 products; tap ✕ on the middle one", "Only that line goes; totals and tax update at once; the other lines stay"),
    ("R02", "Sell", "Till", "Tap − on a line with quantity 1", "That line goes (same as ✕)"),
    ("R03", "Sell", "Till", "Under one product tap 'Discount this item', give 10%", "The line says 'Item discount (10% off) −$…'; no manager needed at exactly 10%"),
    ("R04", "Sell", "Till", "Give a second product $1.00 off, then 'Sale discount' 5% for the whole sale", "Totals show 'Item discounts' and 'Sale discount (5% off)' on separate lines"),
    ("R05", "Sell", "Till", "Pay; look at the receipt on screen (and printed, when there is a printer)", "Under each discounted product: 'Discount 10% off' / 'Discount $1.00 off'; then 'Sale discount 5% off' after the subtotal"),
    ("R06", "Sell", "Till", "After paying, wait without touching the screen", "'Back to selling in 15 s' counts down; the till returns to Sell by itself"),
    ("R07", "Sell", "Till", "After paying, tap 'Stay here' (or tap Reprint / Void)", "The countdown stops; New sale goes back"),
    ("R08", "Receipts", "Till", "As a cashier: Sales → open a sale → Reprint", "Asks for a manager: pick a manager, PIN; then it prints. The sale shows 'Reprinted 1 time'"),
    ("R09", "Receipts", "Till", "As a manager or owner: Reprint", "Prints without asking (it is still counted)"),
    ("R10", "Receipts", "Till", "Right after a sale: Print receipt, then press it again", "The second press is a reprint and asks for a manager (cashier)"),
    ("R11", "Till", "Till", "Close the till, open it again (same device)", "Still 'Till 1'; the Z report says 'Till 1 · Z 2' (Z counts the openings)"),
    ("R12", "Till", "Second device", "Open a till on another device (e.g. the iPhone)", "That device is 'Till 2'; the first stays 'Till 1'"),
    ("R13", "Reports", "Laptop", "Reports → Tills: reconcile a closed till", "Batch number given by Chedam: B-000001, then B-000002 for the next till; never twice; 'Change' keeps the number"),
    ("R14", "Stock", "Laptop", "Stock → a product that was received and sold → Recent changes", "Received in green, Sold in blue (Damaged / lost red); a key above the list"),
    ("R15", "Saving", "Any", "Save something on any screen (category, product, settings, printers, reconcile…)", "'Saved ✓' pops up at the bottom for 2-3 seconds"),
    ("R16", "Labels", "Laptop", "Labels: 10 labels of one product among others; make the PDF; print at 100% (Actual size)", "Every label shows its own name with its own price right under it; no price sits next to another label's name"),
    ("R17", "Labels", "iPhone", "Labels → add a category → Make the PDF (also right after an update was installed)", "The PDF opens. If a new version was just installed, the app reloads once by itself and the PDF works"),
    ("R18", "Import", "Laptop", "Import and export → open 'The columns Chedam reads'", "Table of columns: which are required (Name), needed to sell, optional; with examples"),
    ("R19", "Import", "Laptop", "Download template (Excel), fill in 2 products, import it", "Columns map by themselves (all 'high'); products imported"),
    ("R20", "Import", "Laptop + Google Sheets", "Open the CSV template in Google Sheets, fill in, File → Download → .csv, import", "Same as R19"),
    ("R21", "Export", "Laptop", "Export data: tick only Sales (or Products, People…), choose Excel workbook, download", "Only the chosen data, one sheet per table plus a Dictionary sheet"),
]

# P2 (Sprint 2): one block per build step.
P2_OUT = Path(__file__).resolve().parents[2] / "docs" / "testing" / "Chedam-Manual-Tests-P2.xlsx"
P2_TESTS = [
    # ---- Receipts as PDF (DL-116)
    ("P01", "Receipt PDF", "Laptop / iPhone", "After a sale (or Sales → a sale): Save as PDF", "A PDF of the receipt (same as the printer's: store, lines, discounts, taxes, total, barcode); it opens, saves and prints"),
    ("P02", "Receipt PDF", "Till", "As a cashier, save the PDF a second time", "Asks for a manager (a copy is a reprint); the PDF says COPY"),
    # ---- Step 1: promotions and scheduled prices (DL-117..123)
    ("P10", "Promotions", "Laptop", "Home → Promotions → New promotion: '10% off' on a category; Preview prices", "Each product: regular price, price with the deal, cost and margin; below cost in red"),
    ("P11", "Promotions", "Laptop", "Switch it on", "Listed under 'On now'; its products are on the label batch with 'promotion'"),
    ("P12", "Promotions", "Till", "Ring up a product of that category", "The line shows the deal's name and saving; the total line shows the deal; the receipt shows it under the product"),
    ("P13", "Promotions", "Laptop + till", "Add a 'Sale price' deal on one product of the same category (better than 10%)", "That product gets the sale price only (no stacking); the others keep 10%"),
    ("P14", "Promotions", "Laptop + till", "'X for $Y': 3 for $5.00 on one product; ring up 4", "3 cost exactly $5.00, the 4th the regular price"),
    ("P15", "Promotions", "Laptop + till", "'Buy X, get Y': buy 2 get 1 free; ring up 3 items of the category", "The cheapest of the 3 is free"),
    ("P16", "Promotions", "Laptop + till", "'Spend and save': spend $20, get 10% off; ring up $15, then $25", "Nothing at $15; 10% off at $25"),
    ("P17", "Promotions", "Laptop + till", "A deal 'only on some days or hours' (e.g. now until in 5 minutes)", "Applies now; after the end time it no longer applies"),
    ("P18", "Promotions", "Laptop + till", "A deal with a coupon code; ring up the product, then Coupon → type the code", "No deal without the code; with it, the deal applies; a wrong code says it gives nothing"),
    ("P19", "Promotions", "Laptop", "End now on a running deal", "It moves to Ended; the till no longer applies it; labels queued back at the regular price"),
    ("P20", "Promotions", "Laptop + till", "Scheduled prices → New: a new price from now", "The till sells at the new price (receipt shows 'was'); its label is queued"),
    ("P21", "Promotions", "Laptop", "Labels: print the batch with a product on a deal", "The label shows the deal price big, 'SALE', the deal, 'Reg' price and the end date"),
    ("P22", "Promotions", "Till (hub off)", "Switch the Pi off; ring up a product on a deal", "The offline till applies the same deal; after the Pi is back the sale arrives with the deal"),
    ("P23", "Promotions", "Till", "As a cashier: open Promotions", "Can see the deals but not create, change or end them"),
    # ---- Step 2: near-expiry markdowns and staff discounts (DL-124..127)
    ("P30", "Markdowns", "Laptop", "Promotions → Near-expiry markdowns: switch On (e.g. 3 days → 25%, 1 day → 50%), Save", "'Marked down now' lists perishable lots inside the window with their %"),
    ("P31", "Markdowns", "Till", "Ring up a perishable product with a lot expiring within the window", "The line shows 'Near expiry 25% off' (or 50%) and the saving"),
    ("P32", "Markdowns", "Phone + till", "Receive 2 more of it expiring tomorrow; ring up 3", "2 at 50% (they sell first), 1 at 25%"),
    ("P33", "Markdowns", "Laptop", "A minute later: Labels", "Near-expiry stickers on the batch, one per item, showing the marked-down price"),
    ("P34", "Markdowns", "Till", "A product with both a deal and a markdown", "The customer gets whichever saves more, not both"),
    ("P35", "Staff discount", "Laptop", "Promotions → Staff discount: On, 10%, $100 a month; leave out a category; Save", "Saved; the till shows 'Staff sale'"),
    ("P36", "Staff discount", "Till", "Ring up items, Staff sale → pick a staff member → their PIN", "10% off each eligible item; 'Staff sale: name · $x off · $y left this month'; not on the excluded category or on items with a deal"),
    ("P37", "Staff discount", "Till", "Pay; look at the receipt", "'Staff discount' under the items and 'Staff purchase: name'"),
    ("P38", "Staff discount", "Till", "Staff sale with a wrong PIN", "Refused; no discount"),
    ("P39", "Staff discount", "Till", "Use up the monthly amount, then another staff sale", "The discount stops at the limit; then 'has used this month's staff discount'"),
    ("P40", "Staff discount", "Till (hub off)", "Switch the Pi off; try a staff sale", "Not available offline"),
    # ---- Step 3: customers and loyalty (DL-128..134)
    ("P50", "Loyalty", "Laptop (owner)", "Home → Customers: the programme says Off. Set it up: your points per $1, points for $1 off, fewest points to use; switch On; Save", "Shows your values; only the owner can change them"),
    ("P51", "Loyalty", "Till", "Sell: Customer → type a new phone number → Find → first name, tick 'Customer agreed' → Join", "The customer is on the sale with 0 points and 'Earns N points'"),
    ("P52", "Loyalty", "Till", "Pay; look at the receipt", "'Loyalty: name', points earned and the balance"),
    ("P53", "Loyalty", "Till", "Next sale: Customer → the same phone (any format, e.g. +1 604...)", "Found with the points"),
    ("P54", "Loyalty", "Till", "Use points (at least your minimum)", "Points used come off before tax ('Points used (N)'); points earned on what is paid; receipt shows earned, used, balance"),
    ("P55", "Loyalty", "Till", "Return one item of that sale", "The customer's points: the item's share of earned points taken back, its share of used points given back"),
    ("P56", "Loyalty", "Laptop (manager)", "Customers → Loyalty cards → Make cards (e.g. 30) on a label sheet; print", "A PDF of cards with the store name and a barcode each"),
    ("P57", "Loyalty", "Till", "Scan a new card at Customer → Find", "Asks to join with that card; afterwards the card finds the customer"),
    ("P58", "Loyalty", "Laptop", "A customer → Card lost: block it; then link a new card", "The old card no longer works; the points stay"),
    ("P59", "Loyalty", "Laptop (manager)", "Adjust points with a reason; Merge two records of one person", "Points history shows it; the merged record is gone with its points moved"),
    ("P60", "Loyalty", "Laptop (manager)", "Their data (download); then Delete on request", "A file with everything held; after deleting, the name and phone are gone and the phone no longer finds them"),
    ("P61", "Loyalty", "Till (hub off)", "Switch the Pi off; Customer → a member's phone; sell with points", "Found offline; points earned/used; the sale arrives with them when the Pi is back"),
    ("P62", "Loyalty", "Till", "As a cashier: Customers screen", "Find by phone or card only; no editing, no points adjusting"),
    # ---- Step 4: promotion and loyalty reports (DL-135, 136)
    ("P70", "Reports", "Laptop (manager)", "Home → Reports → Promotions; dates: this week", "Each deal used: times, sales, units, sales $, savings; margin %; 'before' = the week before"),
    ("P71", "Reports", "Laptop (manager)", "Open a deal's card", "Its products listed; 'All sales of its products' now vs before"),
    ("P72", "Reports", "Laptop (manager)", "A sale with a coupon, then the report", "The coupon code counted under 'Coupons used'"),
    ("P73", "Reports", "Laptop (manager)", "Reports → Loyalty", "Members, joined, bought; members' share of sales; points earned/used; points held and what they are worth in $"),
    ("P74", "Reports", "Laptop (manager)", "Top customers; Export", "First names with the last 4 digits only; the export has the same"),
    ("P75", "Reports", "Laptop (owner)", "Change 'points for $1 off' in the programme; Reports → Loyalty again", "'Worth' changes with the new value"),
    ("P76", "Reports", "Laptop (accountant)", "Sign in as Ana Accountant → Reports → Loyalty", "Totals and the liability, but no customer list"),
    # ---- Step 5: customer display (DL-137, 138)
    ("P80", "Display", "Tablet or phone", "Devices → Pair a new device: type 'Customer display'; open the code on the tablet", "After approval it shows the store's name/logo and 'Welcome'; no sign-in"),
    ("P81", "Display", "Laptop (manager)", "Devices → the display → 'Shows the sale of': pick the till", "The till's card says 'Customer display: <name>'"),
    ("P82", "Display", "Till + display", "Scan items, one with a deal; add a customer", "The display shows the items, 'You save', the total and 'Hi <name> · points' within about a second"),
    ("P83", "Display", "Till + display", "Pay cash with change", "Display: 'To pay' while paying, then 'Thank you!', the change and the savings"),
    ("P84", "Display", "Till + display", "Wait 15 s (or New sale)", "The display goes back to the logo and 'Welcome'"),
    ("P85", "Display", "Laptop till", "Sell → 'Customer screen'; drag the window to a second monitor; sell", "The window follows the sale; still works with the Pi switched off"),
    ("P86", "Display", "Display", "Remove a deal line, change quantities, clear the sale", "The display follows every change; nothing is left behind"),
    # ---- Step 6: dashboard and sales insights (DL-139, 140)
    ("P90", "Dashboard", "Laptop (manager)", "Home → Dashboard", "Needs attention first; sales today vs last week; this month vs last month; a 30-day chart; margin by category; this month's P&L; stock health"),
    ("P91", "Dashboard", "Laptop (manager)", "Tap an attention line (e.g. Products out of stock)", "Opens the screen that deals with it"),
    ("P92", "Dashboard", "Phone (staff)", "Home → Dashboard as Sam Staff", "Attention and stock health only; no sales figures or P&L"),
    ("P93", "Dashboard", "Laptop (owner)", "Make a sale, wait a minute", "Today's figures go up by themselves"),
    ("P94", "Insights", "Laptop (manager)", "Reports → Insights; dates: last 30 days", "Totals vs last year; busy-times heatmap (switch Sales $ / Number of sales); best and slowest sellers; categories"),
    ("P95", "Insights", "Laptop (manager)", "Export best sellers to Excel", "Units, sales, margin, on hand and sell-through columns"),
    ("P96", "Insights", "Phone, dark mode", "Open the dashboard and insights in dark mode", "Charts readable in dark colours"),
    # ---- Step 7: tasks, checklists, reminders (DL-141..143)
    ("P100", "Tasks", "Laptop (manager)", "Tasks and checklists → New task: for Cal, due in 1 hour, urgent, linked from a product", "Shown under Everyone's; Cal sees it under Mine"),
    ("P101", "Tasks", "Till (cashier)", "Cal: Done", "Moves to Done with Cal's name and the time; a manager can Reopen"),
    ("P102", "Checklists", "Laptop (manager)", "Set up checklists: change Closing (add an optional item, done by 22:30)", "Saved; shown in Checklists"),
    ("P103", "Checklists", "Till", "Checklists → Opening: tick items; Finish with one required item left", "Refused, names the item; ticking it then Finish works"),
    ("P104", "Checklists", "Phone + till", "Two people tick the same checklist", "Each tick shows who and when"),
    ("P105", "Checklists", "Laptop", "Leave the closing checklist unfinished past its time", "A task 'Closing not finished by …' appears; finishing it closes the task"),
    ("P106", "Handover", "Till → laptop", "Leave a handover note; sign in as someone else", "Dashboard: 'Handover notes you have not read'; Read it; the writer sees who read it"),
    ("P107", "Documents", "Laptop (manager)", "Licences and insurance → add insurance expiring in 5 days with a PDF", "An urgent task 'expires on … (in 5 days)'; Open copy shows the PDF"),
    ("P108", "Documents", "Laptop", "Change the expiry to next year", "The task closes"),
    ("P109", "Storage", "Laptop", "Product form: milk keep 0 to 4 °C; storage area Dry store", "Within 10 minutes an urgent task 'needs 0–4 °C but is kept in Dry store'; back to Cooler closes it"),
    # ---- Step 8: messages and announcements (DL-144..146)
    ("P110", "Messages", "Till + phone", "Messages → Everyone: write 'Truck at 2 pm' on the phone", "The till's 💬 shows 1 within seconds; opening it shows the message"),
    ("P111", "Messages", "Phone", "New conversation → With one person (Cal); type @ and pick Cal; send", "Cal's badge turns orange (mentioned); the message is highlighted for Cal"),
    ("P112", "Messages", "Phone", "Attach a photo of a shelf and link a product (🔗)", "Photo thumbnail and the product link in the message; tapping the link opens the product"),
    ("P113", "Messages", "Till", "Cal opens the conversation; back on the phone", "Your message shows 'Read by Cal'"),
    ("P114", "Messages", "Till", "React 👍; tap 👍 again", "The reaction appears, then goes"),
    ("P115", "Messages", "Laptop (manager)", "New conversation → A group 'Morning shift' with two people", "Only those people see the group; others cannot open it"),
    ("P116", "Messages", "Phone", "Remove your own message", "Shows 'Message removed' for everyone"),
    ("P117", "Messages", "Two devices, same person", "Sign in as the same person on a phone and the laptop", "The same conversations and unread counts on both"),
    ("P118", "Announcements", "Laptop (manager)", "New announcement, 'Everyone must confirm'", "Each person: banner on Home and 📌 in the top bar; 'I have read this' clears it"),
    ("P119", "Announcements", "Laptop (manager)", "Look at the announcement after two people confirmed", "'Read: …' and 'Not yet: …' lists; End removes it for everyone"),
    # ---- Step 9: pings and the till overlay (DL-147..149)
    ("P120", "Pings", "Phone → till", "📣 → To: Till 1 → 'Price check, please'", "The till shows a banner with the text and quick replies, over the Sell screen"),
    ("P121", "Pings", "Till", "With items in the cart: reply 'On my way'", "The banner closes; the cart is still there; the phone shows '✓ Cal: On my way'"),
    ("P122", "Pings", "Phone → all tills", "Urgent: 'Manager to the front' to All tills", "Every till turns red and beeps every 5 s; one till presses I'm on it: closed on all"),
    ("P123", "Pings", "Phone → till", "Urgent ping to a till; nobody answers for 5 minutes", "It appears on the manager's device marked 'nobody answered', and an urgent task opens; confirming closes both"),
    ("P124", "Pings", "Phone", "Send a ping, then Take back", "It disappears from the till"),
    ("P125", "Pings", "Laptop", "Write your own ping to Everyone", "Every device except the customer display and the sender gets it"),
    # ---- Step 10: inbox and end-of-day report (DL-150..152)
    ("P130", "Inbox", "Laptop (owner)", "📥 → Settings: add Mira to the end-of-day report; time 21:00; email by 07:30", "Saved"),
    ("P131", "Inbox", "Laptop (owner)", "Today's report now", "📊 End of day …: sales, count, margin, payments, tills, best sellers, what to look at"),
    ("P132", "Inbox", "Phone (Mira)", "Open the inbox", "The same report (Mira sees margin: managers see costs); the 📥 count goes down when read"),
    ("P133", "Inbox", "Till (Cal)", "Open the inbox", "No report (not chosen)"),
    ("P134", "Inbox", "Laptop", "Cause an urgent problem (milk kept in the dry store)", "An alert ⚠ in the owner's and Mira's inbox"),
    ("P135", "Inbox", "Phone (Mira)", "Settings: switch off Urgent alerts in the app", "No new alerts for Mira; the owner still gets them"),
    ("P136", "Inbox", "Next morning", "Leave the report unread past the email time", "Shows 'email not connected yet' (sending comes with the Gmail/Outlook set-up)"),
    # ---- Step 11: help (DL-153)
    ("P140", "Help", "Till", "On the Sell screen press ?", "Help opens at 'Selling'; Back returns to Sell"),
    ("P141", "Help", "Phone", "Search 'refund'", "Returns and exchanges is found"),
    ("P142", "Help", "Till (hub off)", "Switch the Pi off; press ?", "Help pages still open"),
    ("P143", "Help", "Laptop (manager)", "Add a training video (a short MP4 from a phone) to 'Opening and closing the till'", "It plays from the Help page on a till"),
]

RESULTS = ["Pass", "Fail", "Blocked", "Not tested"]

# P3 (Sprint 3): one block per build step.
P3_OUT = Path(__file__).resolve().parents[2] / "docs" / "testing" / "Chedam-Manual-Tests-P3.xlsx"
P3_TESTS = [
    # ---- Step 1: parties (DL-154..156)
    ("Q01", "Parties", "Laptop (manager)", "Home → Vendors and clients", "The sample vendors and Cafe Luna; search by name or code; filter vendors / clients"),
    ("Q02", "Parties", "Laptop (manager)", "New: a vendor that is also a client, code 'isl bak', currency cad, terms 15 days, GST number, address", "Saved as code ISLBAK, currency CAD; shown with its details"),
    ("Q03", "Parties", "Laptop (manager)", "Add two contacts (one main), a PDF price list", "Contacts listed with ★ on the main one; the PDF opens"),
    ("Q04", "Parties", "Phone (staff)", "Log a call with a follow-up date tomorrow", "In the log with your name; Tasks → Mine shows 'Follow up with …' due tomorrow"),
    ("Q05", "Parties", "Till (cashier)", "Try to open Vendors and clients", "No tile; the address #parties goes back to Home"),
    ("Q06", "Parties", "Laptop (manager)", "Exchange rates → add EUR for 1 January and 1 June", "Listed; documents dated in March use the January rate"),
    # ---- Step 2: vendor products and price lists (DL-157..159)
    ("Q10", "Vendor prices", "Laptop (manager)", "Buying → Vendor prices → Coastal Beverages", "The sample products with unit, code, cost; ★ on preferred ones"),
    ("Q11", "Vendor prices", "Laptop (manager)", "Add a product: chips, comes as the largest unit, cost, preferred", "Saved; any other vendor's ★ for chips goes"),
    ("Q12", "Vendor prices", "Laptop (manager)", "Change its cost", "Shows 'was …' in red (up) or green (down)"),
    ("Q13", "Price list", "Laptop (manager)", "Import price list: an Excel file with Code, Barcode, Description, Price columns (one unknown barcode, one empty price)", "Columns guessed; result: new / changed / same, up and down lists, two rows not matched with the reason"),
    ("Q14", "Compare", "Phone (staff)", "Compare vendors → chips", "Maple (USD) and Coastal with the cost per base unit in CAD; cheapest marked"),
    ("Q15", "Compare", "Laptop (manager)", "Better prices", "Products whose ★ vendor is not the cheapest, with −%"),
    # ---- Step 3: purchase orders and reorder (DL-160..162)
    ("Q20", "Purchase orders", "Laptop (manager)", "Buying → New order: Coastal, two products from 'Add what this vendor sells', change a quantity", "Draft PO-… with the vendor's costs and the total"),
    ("Q21", "Purchase orders", "Laptop (manager)", "Send", "Status Sent; a PDF downloads with the store, vendor, lines and total; Stock shows the quantity as incoming"),
    ("Q22", "Purchase orders", "Phone (staff)", "Open the order → Receive: part of one line", "Partly received; stock goes up; incoming goes down"),
    ("Q23", "Purchase orders", "Phone (staff)", "Receive the rest with a higher cost on one line and one more than ordered", "Received; differences 'different cost', 'more than ordered'; a task for the managers"),
    ("Q24", "Purchase orders", "Laptop (manager)", "Another order: receive part, tick 'The rest will not come'", "Closed; 'short' shown; incoming back down"),
    ("Q25", "Purchase orders", "Laptop (manager)", "Order from Maple Snacks (USD)", "Shows USD, the rate and the CAD total"),
    ("Q26", "Reorder", "Laptop (manager)", "A product: reorder when stock falls to 50, order up to 100 (above its stock)", "Purchase orders lists it; Make the orders makes a draft for its vendor in whole cases up to 100"),
]

def build(OUT=OUT, TESTS=TESTS, intro=None):
    wb = Workbook()
    ws = wb.active
    ws.title = "Tests"
    head = ["ID", "Area", "Device / needs", "What to do", "What should happen", "Result", "Notes (what happened)", "Tester", "Date"]
    ws.append(head)
    for t in TESTS:
        ws.append(list(t) + ["Not tested", "", "", ""])
    widths = [7, 20, 22, 60, 60, 13, 45, 12, 12]
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    thin = Side(style="thin", color="BBBBBB")
    hdr = PatternFill("solid", fgColor="1F6F43")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = hdr
        c.alignment = Alignment(vertical="center", wrap_text=True)
    n = len(TESTS) + 1
    for row in ws.iter_rows(min_row=2, max_row=n):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
            c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        if "NEEDS PRINTER" in row[2].value:
            row[2].font = Font(bold=True, color="B45309")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:I{n}"
    dv = DataValidation(type="list", formula1='"' + ",".join(RESULTS) + '"', allow_blank=True)
    dv.add(f"F2:F{n}")
    ws.add_data_validation(dv)
    colors = {"Pass": "C6EFCE", "Fail": "FFC7CE", "Blocked": "FFEB9C", "Not tested": "EDEDED"}
    for k, v in colors.items():
        ws.conditional_formatting.add(f"F2:F{n}", CellIsRule(operator="equal", formula=[f'"{k}"'], fill=PatternFill("solid", fgColor=v)))

    s = wb.create_sheet("Summary")
    s.append(["Area", "Checks", "Pass", "Fail", "Blocked", "Not tested"])
    areas = []
    for t in TESTS:
        if t[1] not in areas:
            areas.append(t[1])
    for a in areas:
        r = s.max_row + 1
        s.append([a, f'=COUNTIF(Tests!B:B,A{r})'] + [f'=COUNTIFS(Tests!B:B,A{r},Tests!F:F,"{x}")' for x in RESULTS])
    last = s.max_row
    s.append(["All", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})", f"=SUM(D2:D{last})", f"=SUM(E2:E{last})", f"=SUM(F2:F{last})"])
    for c in s[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = hdr
    for c in s[s.max_row]:
        c.font = Font(bold=True)
    s.column_dimensions["A"].width = 24
    for col in "BCDEF":
        s.column_dimensions[col].width = 12

    g = wb.create_sheet("Before you start")
    for line in intro or [
        "Chedam manual tests: P0 + P1 steps 1-10 (sheet made 2026-10-07)",
        "",
        "Address: https://chedam.local on every device (pairing is remembered per address).",
        "Sample people: Demo Owner, Mira Manager, Cal Cashier, Sam Staff (PINs as in the sample data; Demo Owner's PIN was changed).",
        "Temporary business numbers are in use (A09). Replace them before selling for real.",
        "Rows marked NEEDS PRINTER wait for the receipt printer and cash drawer: mark them Blocked for now.",
        "The gate checks (L) are done with Claude: say when the devices are ready.",
        "For each row: do what it says, compare with 'What should happen', choose Pass / Fail / Blocked, and write what happened when it is not a Pass.",
        "A screenshot or photo of any Fail helps: note its file name in Notes.",
    ]:
        g.append([line])
    g.column_dimensions["A"].width = 130
    g["A1"].font = Font(bold=True, size=13)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.move_sheet("Before you start", offset=-2)
    wb.active = 1
    wb.save(OUT)
    print(OUT, len(TESTS), "checks")

if __name__ == "__main__":
    if "--p2" in sys.argv:
        build(P2_OUT, P2_TESTS, [
            "Chedam manual tests: P2 Engage (grows with each build step)",
            "",
            "Test after the update with these changes is on the hub (Claude says when). Laptop and iPhone; Android later.",
            "Sample people: Demo Owner, Mira Manager (manages promotions), Cal Cashier, Sam Staff.",
            "For each row: do what it says, compare with 'What should happen', choose Pass / Fail / Blocked, and write what happened when it is not a Pass.",
        ])
    elif "--p3" in sys.argv:
        build(P3_OUT, P3_TESTS, [
            "Chedam manual tests: P3 Buy and spend (grows with each build step; tested in the P2-P4 test week)",
            "",
            "Laptop and iPhone; Android later. Sample people: Demo Owner, Mira Manager, Ana Accountant, Cal Cashier, Sam Staff.",
            "Sample vendors: Fresh Fields Produce, Coastal Beverages Ltd., Maple Snacks Wholesale (USD); client: Cafe Luna.",
            "For each row: do what it says, compare with 'What should happen', choose Pass / Fail / Blocked, and write what happened when it is not a Pass.",
        ])
    elif "--retest" in sys.argv:
        build(RETEST_OUT, RETEST, [
            "Chedam retest: fixes and changes from testing on 2026-10-09",
            "",
            "Test after the update is deployed to the hub (Claude says when). On the laptop and the iPhone; Android later.",
            "Sample people: Demo Owner, Mira Manager, Cal Cashier, Sam Staff. Reprints by a cashier need a manager's PIN.",
            "For each row: do what it says, compare with 'What should happen', choose Pass / Fail / Blocked, and write what happened when it is not a Pass.",
        ])
    else:
        build()
