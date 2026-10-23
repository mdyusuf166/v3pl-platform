import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/client";

export type ActivityRow = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  metadata: unknown;
  user: { name: string; email: string; role: UserRole } | null;
};

function actionLabel(action: string) {
  const [, verb = action] = action.split(".");
  return verb.replace(/_/g, " ");
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** "field: old → new" for keys present in both, "field: value" otherwise; capped so a row stays one glance. */
function changeLines(row: ActivityRow): string[] {
  const oldV = (row.oldValues ?? {}) as Record<string, unknown>;
  const newV = (row.newValues ?? {}) as Record<string, unknown>;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const keys = new Set([...Object.keys(typeof oldV === "object" ? oldV : {}), ...Object.keys(typeof newV === "object" ? newV : {})]);
  for (const k of keys) {
    if (k in oldV && k in newV) {
      if (scalar(oldV[k]) !== scalar(newV[k])) out.push(`${k}: ${scalar(oldV[k])} → ${scalar(newV[k])}`);
    } else out.push(`${k}: ${scalar(k in newV ? newV[k] : oldV[k])}`);
  }
  if (typeof meta === "object" && meta) for (const [k, v] of Object.entries(meta)) out.push(`${k}: ${scalar(v)}`);
  return out.map((l) => (l.length > 160 ? `${l.slice(0, 157)}…` : l)).slice(0, 6);
}

/** Read-only view of the append-only audit log (D-076 batch 2). Renders no edit or delete controls by design. */
export function ActivityLogTable({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
        <ScrollText className="size-8 text-muted-foreground" />
        <p className="font-medium">No activity yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Actions such as creating products, orders, accounts or changing settings are recorded here as they happen.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[170px]">When</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="hidden md:table-cell">Area</TableHead>
            <TableHead className="hidden lg:table-cell">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const lines = changeLines(r);
            return (
              <TableRow key={r.id} data-slot="activity-row">
                <TableCell className="whitespace-nowrap align-top text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                <TableCell className="align-top">
                  {r.user ? (
                    <div className="min-w-0">
                      <div className="font-medium">{r.user.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.user.email} · {ROLE_LABELS[r.user.role]}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">System</span>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <div className="capitalize">{actionLabel(r.action)}</div>
                  <div className="text-xs text-muted-foreground md:hidden">
                    {r.entityType}
                    {r.entityId ? ` · ${r.entityId.slice(-8)}` : ""}
                  </div>
                  {lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground lg:hidden">
                      {lines.slice(0, 2).map((l) => (
                        <li key={l} className="truncate">{l}</li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="hidden align-top md:table-cell">
                  <Badge variant="outline">{r.entityType}</Badge>
                  {r.entityId && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{r.entityId}</div>}
                </TableCell>
                <TableCell className="hidden max-w-[420px] align-top lg:table-cell">
                  {lines.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {lines.map((l) => (
                        <li key={l} className="break-words">{l}</li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
