"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { placeDropdown, type DropdownPlacement } from "@/lib/dropdown-position";
import { cn } from "@/lib/utils";
import { browseCatalogAction } from "@/server/actions/products";

export type PickedVariant = {
  id: string;
  sku: string;
  label: string;
  ownerId: string;
  ownerName: string;
  /** Saved catalogue price (decimal string) and currency, so forms can default their unit price. */
  price: string | null;
  currency: string;
  barcode: string | null;
  /** Available = on hand − reserved across warehouses (existing inventory figure), when known. */
  available?: number;
};

type Props = {
  value: PickedVariant | null;
  onChange: (v: PickedVariant | null) => void;
  /** Restrict results to one owner (e.g. the receipt's vendor). Portal users are scoped server-side regardless. */
  ownerId?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
};

type CatalogProduct = { id: string; name: string; options: string[]; ownerId: string; ownerName: string; variants: CatalogVariant[] };
type CatalogVariant = { id: string; sku: string; name: string | null; optionValues: string[]; price: string | null; currency: string; barcode: string | null; available: number; matches: boolean };

/**
 * Shared Product → Variant picker (D-072), used by every workflow that chooses a SKU (orders for admin /
 * vendor / 3PL / affiliate, receiving, adjustments, moves, transfers, affiliate assignments). Focusing the
 * field browses the first page of the (session-scoped) catalogue; typing searches product name, variant
 * option label, SKU or barcode server-side. A product with one variant selects directly; otherwise it
 * expands to its variants (options · SKU · available). The result list is a document-level portal with
 * `position: fixed`, so it is never clipped by table wrappers (QA UI-07) and never leaves the page (UI-06).
 * The selection contract (`PickedVariant`) is unchanged, so downstream business logic is untouched.
 */
export function VariantPicker({ value, onChange, ownerId, disabled, placeholder = "Browse products or search name, option, SKU, barcode…", id, invalid }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = open;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await browseCatalogAction(query, ownerId);
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setProducts(res.data.products);
        setTotal(res.data.total);
        setError(null);
        // Auto-open products whose variants matched the search (SKU / option), so "TS-BLK-M" lands on the variant.
        setExpanded(new Set(res.data.products.filter((p) => p.variants.some((v) => v.matches)).map((p) => p.id)));
      } else {
        setProducts([]);
        setTotal(0);
        setError(res.error);
      }
    }, query.trim() ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, active, ownerId]);

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPlacement(placeDropdown({ top: r.top, bottom: r.bottom, left: r.left, width: Math.max(r.width, 360) }, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true); // capture: scrollable containers too
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [active, reposition, products.length, loading, expanded]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (p: CatalogProduct, v: CatalogVariant) => {
    onChange({ id: v.id, sku: v.sku, label: [p.name, v.name].filter(Boolean).join(" · "), ownerId: p.ownerId, ownerName: p.ownerName, price: v.price, currency: v.currency, barcode: v.barcode, available: v.available });
    setQuery("");
    setOpen(false);
  };
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (value) {
    return (
      <div className={cn("flex h-8 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-sm", invalid && "border-destructive")} data-slot="variant-picker-value">
        <span className="font-mono text-xs">{value.sku}</span>
        <span className="truncate text-muted-foreground">{value.label}</span>
        <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label="Clear SKU" disabled={disabled} onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }

  const multiOwner = new Set(products.map((p) => p.ownerId)).size > 1;
  const q = query.trim();

  const list =
    active && placement ? (
      <div
        ref={listRef}
        data-slot="variant-picker-results"
        role="listbox"
        aria-busy={loading}
        style={{ position: "fixed", top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}
        className="z-50 overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
      >
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" /> {q ? "Searching…" : "Loading products…"}
          </div>
        )}
        {!loading && error && <div className="px-2 py-1.5 text-destructive">{error}</div>}
        {!loading && !error && products.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">{q ? "No product, option or SKU matches" : "No products available"}</div>}
        {!loading &&
          products.map((p) => {
            const single = p.variants.length === 1 && p.options.length === 0;
            const isOpen = expanded.has(p.id);
            const shown = isOpen ? (q && p.variants.some((v) => v.matches) ? p.variants.filter((v) => v.matches) : p.variants) : [];
            const hidden = isOpen ? p.variants.length - shown.length : 0;
            return (
              <div key={p.id} className="rounded-md" data-product-id={p.id}>
                <button
                  type="button"
                  role={single ? "option" : undefined}
                  aria-selected={false}
                  aria-expanded={single ? undefined : isOpen}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => (single ? pick(p, p.variants[0]) : toggle(p.id))}
                >
                  {single ? <span className="inline-block size-4 shrink-0" /> : isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate font-medium">{p.name}</span>
                  {single ? (
                    <>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.variants[0].sku}</span>
                      <span className={cn("ml-auto shrink-0 text-xs tabular-nums", p.variants[0].available > 0 ? "text-muted-foreground" : "text-amber-700")}>{p.variants[0].available} avail.</span>
                    </>
                  ) : (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {p.variants.length} variant{p.variants.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {multiOwner && <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">{p.ownerName}</span>}
                </button>
                {shown.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-left hover:bg-accent"
                    onClick={() => pick(p, v)}
                  >
                    <span className="truncate">{v.optionValues.length ? v.optionValues.join(" / ") : v.name ?? "Default"}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{v.sku}</span>
                    {v.barcode && q && v.barcode.toLowerCase().includes(q.toLowerCase()) && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{v.barcode}</span>}
                    <span className={cn("ml-auto shrink-0 text-xs tabular-nums", v.available > 0 ? "text-muted-foreground" : "text-amber-700")}>{v.available} avail.</span>
                    {v.price !== null && <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{v.price}</span>}
                  </button>
                ))}
                {hidden > 0 && (
                  <button type="button" className="w-full rounded-md py-1 pl-8 text-left text-xs text-muted-foreground hover:bg-accent" onClick={() => setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, variants: x.variants.map((v) => ({ ...v, matches: false })) } : x)))}>
                    Show all {p.variants.length} variants
                  </button>
                )}
              </div>
            );
          })}
        {!loading && total > products.length && <div className="px-2 py-1 text-xs text-muted-foreground">{total - products.length} more products — refine the search.</div>}
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={query}
        disabled={disabled}
        aria-invalid={invalid}
        aria-expanded={active}
        placeholder={placeholder}
        className="pl-8"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setError(null);
        }}
        onFocus={() => setOpen(true)}
      />
      {loading && active && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {list && typeof document !== "undefined" ? createPortal(list, document.body) : null}
    </div>
  );
}
