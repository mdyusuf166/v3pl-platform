/**
 * Shopify outbound phone normalisation (D-074) + production wording check. Pure; no database, no network.
 *
 * Usage: npm run e2e:phone
 */
import { readFileSync } from "node:fs";

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const { toE164Phone } = await import("../src/lib/phone");
  check("1. Valid international phones pass through unchanged (+, spaces / dashes removed, 00 prefix → +)", toE164Phone("+8801712345678") === "+8801712345678" && toE164Phone("+1 (212) 555-0123") === "+12125550123" && toE164Phone("0044 20 7946 0958") === "+442079460958");
  check("2. Bangladesh local mobile 017XXXXXXXX → +88017XXXXXXXX (also 013–019 and the 880… form without plus)", toE164Phone("01712345678") === "+8801712345678" && toE164Phone("017-1234 5678") === "+8801712345678" && toE164Phone("01912345678") === "+8801912345678" && toE164Phone("8801712345678") === "+8801712345678");
  check("3. Unusable phones → null (omitted from the payload, never guessed): short, letters, bare digits without a known country, empty", toE164Phone("12345") === null && toE164Phone("call me") === null && toE164Phone("2125550123") === null && toE164Phone("") === null && toE164Phone(null) === null && toE164Phone("+0123456789") === null);
  const contract = readFileSync("src/server/services/shopify-order-request.ts", "utf8");
  check("4. The outbound contract builder sends normalised phones only (customer + shipping address) and never the raw V3PL value", contract.includes("toE164Phone(order.customerPhone) ?? toE164Phone(order.shipPhone)") && contract.includes("phone: toE164Phone(order.shipPhone)") && !/phone: order\.(customerPhone|shipPhone)/.test(contract));
  const runner = readFileSync("src/server/services/shopify/order-out.ts", "utf8");
  check("5. The outbound job stores no payload; the runner rebuilds the contract on every attempt, so retrying a previously failed job picks up the normalised phone", !/shopifyOutboundJob\.create\([^;]*payload/.test(contract) && runner.includes("buildShopifyOrderRequest("));
  const form = readFileSync("src/components/orders/order-form.tsx", "utf8");
  check("6. Admin order form has no hardcoded 'Test' store wording; it shows the connected store's real name and domain", !/[">]Test[<"]/.test(form) && form.includes("Connected Shopify store:") && form.includes("storeHint.shopDomain") && !form.includes("all lines map to"));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
