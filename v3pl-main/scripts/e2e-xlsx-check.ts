/**
 * Excel export for Reports (REP-09). Pure + static + light service checks (reads existing data only; nothing is written).
 *
 * Usage: npm run e2e:xlsx -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

loadEnv({ path: ".env.local" });
loadEnv();

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Tiny ZIP reader for the test: returns entry name → inflated content using the central directory. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("ascii");
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Cells of a sheet row → array of text values (inline strings or numbers). */
function rowValues(sheet: string, r: number): string[] {
  const row = sheet.match(new RegExp(`<row r="${r}">(.*?)</row>`))?.[1] ?? "";
  return [...row.matchAll(/<c r="[A-Z]+\d+"(?: t="(\w+)")?>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)<\/c>/g)].map((m) => m[2] ?? m[3] ?? "");
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const xlsx = await import("../src/lib/xlsx");
  const { toCsv, parseCsv } = await import("../src/lib/csv");
  const rep = await import("../src/server/services/reports");
  const val = await import("../src/lib/validation/reports");

  // 1. Valid XLSX package + MIME
  const sample = [{ SKU: "A-1", Qty: 3, Note: 'He said "hi" <b>&</b>' }, { SKU: "B-2", Qty: 0, Note: "" }];
  const buf = xlsx.toXlsx(["SKU", "Qty", "Note"], sample, "Test");
  const parts = unzip(buf);
  const sheet = parts["xl/worksheets/sheet1.xml"]?.toString("utf8") ?? "";
  const names = Object.keys(parts).sort().join(",");
  check("1. XLSX is a valid ZIP package with the five OOXML parts; MIME is the spreadsheet content type; strings are XML-escaped, numbers numeric, zero kept, empty cells omitted", buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && names === "[Content_Types].xml,_rels/.rels,xl/_rels/workbook.xml.rels,xl/workbook.xml,xl/worksheets/sheet1.xml" && xlsx.XLSX_MIME === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && rowValues(sheet, 1).join("|") === "SKU|Qty|Note" && rowValues(sheet, 2).join("|") === "A-1|3|He said &quot;hi&quot; &lt;b&gt;&amp;&lt;/b&gt;" && rowValues(sheet, 3).join("|") === "B-2|0" && sheet.includes('<c r="B2"><v>3</v></c>') && parts["xl/workbook.xml"].toString().includes('name="Test"') && xlsx.crc32(Buffer.from("123456789")) === 0xcbf43926 && xlsx.columnLetter(0) === "A" && xlsx.columnLetter(26) === "AA", names);

  // 2. Report columns: every table builder feeds both formats with identical headers
  const salesRow = { ownerId: "o", owner: "Own", ownerCode: "OWN", ownerType: "VENDOR" as const, source: "MANUAL", currency: "USD", units: 2, unitsWithCost: 2, sales: new (await import("../src/generated/prisma/client")).Prisma.Decimal("20.00"), cost: new (await import("../src/generated/prisma/client")).Prisma.Decimal("12.00"), grossMargin: new (await import("../src/generated/prisma/client")).Prisma.Decimal("8.00") };
  const tSales = rep.salesTable([salesRow], true);
  const tSalesPortal = rep.salesTable([salesRow], false);
  const tFul = rep.fulfillmentTable([{ warehouseId: "w", warehouse: "W1", warehouseName: "Main", shipped: 2, delivered: 1, returned: 0, cancelled: 1, medianPlacedToShippedH: 1, medianShippedToDeliveredH: null }]);
  const tAct = rep.skuActivityTable([], true);
  const tOwn = rep.ownerActivityTable([]);
  const sheetSales = unzip(xlsx.toXlsx(tSales.headers, tSales.rows, "sales"))["xl/worksheets/sheet1.xml"].toString();
  check("2. Report columns preserved in Excel: Sales (admin incl. Owner columns; portal without), Fulfilment, SKU activity, Owner activity headers match the CSV headers; Sales values keep the currency column and 2-decimal money", tSales.headers.join(",") === "Owner,Owner Code,Owner Type,Source,Currency,Units,Units With Cost,Sales Value,Wholesale Cost,Gross Margin" && tSalesPortal.headers[0] === "Source" && rowValues(sheetSales, 1).join(",") === tSales.headers.join(",") && rowValues(sheetSales, 2).join("|") === "Own|OWN|VENDOR|MANUAL|USD|2|2|20.00|12.00|8.00" && tFul.headers.join(",") === "Warehouse,Warehouse Name,Shipped,Delivered,Returned,Cancelled,Median Hours Placed To Shipped,Median Hours Shipped To Delivered" && tFul.rows[0]["Median Hours Shipped To Delivered"] === "" && tAct.headers[0] === "Owner" && tAct.headers.includes("Available") && tOwn.headers.join(",") === "Owner,Owner Code,Type,Status,Units Received,Units Shipped,Units Returned,Units Damaged,Units Missing,Charges,Payable Balance,Receivable Balance");

  // 3 + 4. Filters and scope: one table per request, built once and serialised in either format
  const route = readFileSync("src/app/api/reports/[report]/route.ts", "utf8");
  const view = readFileSync("src/components/reports/report-view.tsx", "utf8");
  const filters = readFileSync("src/components/reports/report-filters.tsx", "utf8");
  const tableBranches = (route.match(/table = /g) ?? []).length;
  check("3. Filters respected: the Excel link carries the same query as the CSV link plus format=xlsx; the route builds ONE table from the parsed query (from / to / warehouse / status / q / owner) and only then picks CSV or XLSX", view.includes('xlsxHref={csvHrefFor(query, isStaff, "xlsx")}') && view.includes('if (format === "xlsx") p.set("format", "xlsx");') && tableBranches === 9 && route.includes('if (q.format === "xlsx")') && route.indexOf("let table: ReportTable") < route.indexOf('if (q.format === "xlsx")') && val.reportQuerySchema.parse({}).format === "csv" && val.reportQuerySchema.parse({ format: "xlsx" }).format === "xlsx" && !val.reportQuerySchema.safeParse({ format: "pdf" }).success, `branches=${tableBranches}`);
  const ownerScopeLine = route.includes('const ownerId = staff ? q.ownerId || undefined : user.ownerId!;');
  const owners = await prisma.owner.findMany({ select: { id: true }, take: 2 });
  let scopeOk = true;
  if (owners.length >= 1) {
    const rowsA = await rep.salesReport({ ownerId: owners[0].id });
    scopeOk = rowsA.every((r) => r.ownerId === owners[0].id) && rep.salesTable(rowsA, false).rows.length === rowsA.length && !rep.salesTable(rowsA, false).headers.includes("Owner");
  }
  check("4. Vendor / 3PL scope isolation: the portal owner comes from the session before any table is built (same line for both formats); portal tables carry no Owner column; a scoped salesReport only yields that owner's rows", ownerScopeLine && route.indexOf("const ownerId = staff") < route.indexOf("let table: ReportTable") && scopeOk);

  // 5. Owner activity ADMIN-only in both formats
  check("5. Owner activity stays ADMIN-only for CSV and Excel: the 403 check runs before the table is built and before the format branch", route.includes('ADMIN_ONLY_REPORT_TYPES.includes(type) && user.role !== "ADMIN"') && route.indexOf("ADMIN_ONLY_REPORT_TYPES.includes(type)") < route.indexOf("let table: ReportTable"));

  // 6. CSV unchanged
  const csvSales = rep.salesCsv([salesRow], true);
  const csvFul = rep.fulfillmentCsv(tFul.rows.length ? [{ warehouseId: "w", warehouse: "W1", warehouseName: "Main", shipped: 2, delivered: 1, returned: 0, cancelled: 1, medianPlacedToShippedH: 1, medianShippedToDeliveredH: null }] : []);
  const p = parseCsv(csvSales.replace(/^﻿/, ""));
  check("6. Existing CSV unchanged: csv builders are thin wrappers over the same tables (BOM + CRLF + identical header line), CSV remains the default format and keeps its filename; the CSV button is still present beside the new Excel button", csvSales === toCsv(tSales.headers, tSales.rows) && csvSales.startsWith("﻿Owner,Owner Code,Owner Type,Source,Currency,Units,Units With Cost,Sales Value,Wholesale Cost,Gross Margin\r\n") && p.rows[0]["Gross Margin"] === "8.00" && csvFul.includes("W1,Main,2,1,0,1,1,\r\n") && route.includes('filename="v3pl-${type}-${stamp}.csv"') && route.includes('if (q.format === "csv") return csvResponse(csv, type);') && filters.includes("Download CSV") && filters.includes("Download Excel") && route.includes('filename="v3pl-${type}-${period}-'));

  await prisma.$disconnect();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
