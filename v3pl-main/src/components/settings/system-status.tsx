import { CheckCircle2, Database, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkDatabaseConnection } from "@/lib/prisma";

/** Live deployment checks — moved from the dashboard to Settings → System (D-076). */
export async function SystemStatusCard() {
  const db = await checkDatabaseConnection();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          System status
        </CardTitle>
        <CardDescription>Live checks for this deployment.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span>Database</span>
          {db.ok ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="size-3.5" /> Unavailable
            </Badge>
          )}
        </div>
        {!db.ok && <p className="text-xs text-muted-foreground break-all">{db.error}</p>}
        <div className="flex items-center justify-between">
          <span>Authentication</span>
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-600" /> Firebase session active
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Environment</span>
          <Badge variant="outline">{process.env.VERCEL_ENV ?? process.env.NODE_ENV}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Runtime</span>
          <Badge variant="outline">Node {process.version}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
