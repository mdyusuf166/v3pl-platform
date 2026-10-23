/**
 * UI polish: subtle motion (UI-15). Static + pure-function checks; no database or HTTP server needed.
 *
 * Usage: npm run e2e:motion
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

async function main() {
  const tile = read("src/components/dashboard/stat-tile.tsx");
  const { countUpValue, COUNT_UP_MS } = await import("../src/components/dashboard/stat-tile");

  check("1. Dashboard tiles enter with a short fade + rise, staggered but capped, without layout shift (fill-mode-both) and disabled under prefers-reduced-motion", tile.includes("animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none") && tile.includes("Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS") && /MAX_STAGGER_INDEX = 6/.test(tile) && /STAGGER_MS = 60/.test(tile));

  const seq = [0, 0.25, 0.5, 0.75, 1].map((p) => countUpValue(p, 1234));
  const monotonic = seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  check("2. Count-up is a pure ease-out from 0 to the exact displayed value (monotonic, integer, clamped), runs once on mount via requestAnimationFrame, skips reduced-motion / zero, and is cancelled on unmount", seq[0] === 0 && seq[4] === 1234 && monotonic && countUpValue(2, 77) === 77 && countUpValue(-1, 77) === 0 && COUNT_UP_MS <= 800 && tile.includes("requestAnimationFrame(tick)") && tile.includes("cancelAnimationFrame(frame)") && tile.includes("prefers-reduced-motion: reduce") && !tile.includes("setInterval"), seq.join(","));

  const stats = ["order-stats", "stock-stats", "partner-stats", "finance-stats"].map((n) => [n, read(`src/components/dashboard/${n}.tsx`)] as const);
  const sources = { "order-stats": "orderCounters()", "stock-stats": "stockTotals()", "partner-stats": "prisma.$transaction([", "finance-stats": "allOwnerBalances()" } as Record<string, string>;
  check("3. All four dashboard metric groups use the shared tile and keep their original data sources; money tiles are shown pre-formatted (no count-up)", stats.every(([n, s]) => s.includes("<StatTile") && s.includes(sources[n])) && read("src/components/dashboard/finance-stats.tsx").includes("display={t.value}") && !read("src/components/dashboard/finance-stats.tsx").includes("value={t.value}"));

  const settings = read("src/app/admin/(dashboard)/settings/page.tsx");
  const links = (settings.match(/className="group rounded-xl outline-none focus-visible:ring-2/g) ?? []).length;
  const lifts = (settings.match(/group-hover:-translate-y-0\.5/g) ?? []).length;
  check("4. Interactive cards (dashboard tiles, Settings cards) get a small lift + ring on hover, a visible keyboard focus ring, and no movement under reduced motion", links === 6 && lifts === 6 && settings.includes("motion-reduce:group-hover:translate-y-0") && tile.includes("focus-visible:ring-2") && tile.includes("group-hover:-translate-y-0.5") && tile.includes("motion-reduce:group-hover:translate-y-0"), `settings links=${links} lifts=${lifts}`);

  const empty = read("src/components/common/empty-state.tsx");
  const skeleton = read("src/components/ui/skeleton.tsx");
  check("5. Existing empty state fades in (structure unchanged) and skeletons stop pulsing under reduced motion", empty.includes("animate-in fade-in duration-300 fill-mode-both motion-reduce:animate-none") && empty.includes("border-dashed px-6 py-14 text-center") && skeleton.includes("animate-pulse rounded-md bg-muted motion-reduce:animate-none"));

  const tableFiles = walk("src/components").filter((f) => read(f).includes("<TableRow"));
  const animatedRows = tableFiles.filter((f) => /<TableRow[^>]*animate-in/.test(read(f)));
  const continuous = walk("src/components").filter((f) => /animate-(spin|pulse|bounce|ping)/.test(read(f)) && !/Loader2|Skeleton|animate-spin/.test(read(f)));
  check("6. No animation on table rows and no new continuous animations (spinners on pending buttons and skeletons excepted)", animatedRows.length === 0 && continuous.length === 0, `tables=${tableFiles.length}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
