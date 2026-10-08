"""Builds the manual test sheet for Sreya: docs/testing/Chedam-Manual-Tests-P1-1-7.xlsx

One row per check: what to do and what should happen, with a Pass / Fail / Blocked / Not tested choice,
notes, tester and date. A Summary tab counts the results per area. Rerun after adding checks; it
overwrites the sheet, so fill in a copy (or rename it) once testing starts.
Usage: python tools/testing/build_test_sheet.py
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parents[2] / "docs" / "testing" / "Chedam-Manual-Tests-P1-1-8.xlsx"

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
    # ---- I. Reliability
    ("I01", "Reliability", "Pi", "Pull the Pi's power while nothing is happening; plug back in", "Back within ~2 minutes; tills reconnect by themselves"),
    ("I02", "Reliability", "Pi + till", "Pull the Pi's power during a sale", "Till finishes offline; uploads after the Pi is back; nothing lost or doubled"),
    ("I03", "Reliability", "Router", "Restart the Wi-Fi router", "Hub comes back on the network by itself"),
    ("I04", "Reliability", "Laptop", "Next morning: Backups", "Last night's backup listed as verified"),
]

RESULTS = ["Pass", "Fail", "Blocked", "Not tested"]

def build():
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
    for line in [
        "Chedam manual tests: P0 + P1 steps 1-8 (sheet made 2026-10-07)",
        "",
        "Address: https://chedam.local on every device (pairing is remembered per address).",
        "Sample people: Demo Owner, Mira Manager, Cal Cashier, Sam Staff (PINs as in the sample data; Demo Owner's PIN was changed).",
        "Temporary business numbers are in use (A09). Replace them before selling for real.",
        "Rows marked NEEDS PRINTER wait for the receipt printer and cash drawer: mark them Blocked for now.",
        "Import and export (J) needs step 8 on the Pi.",
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
    build()
