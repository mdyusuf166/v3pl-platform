"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseClientAuth } from "@/lib/firebase/client";
import { hardResetPlatformAction } from "@/server/actions/platform-reset";

/**
 * Settings → Danger Zone → Hard Reset Platform (D-076).
 * Three gates, all re-checked server-side: (1) the admin re-enters their password — the browser signs in to
 * Firebase again exactly like the login form (the password goes to Firebase only, never to V3PL) and the fresh
 * ID token is sent to the action; (2) the exact phrase; (3) a final confirmation dialog.
 */
export function DangerZone({ adminEmail, phrase, scope }: { adminEmail: string; phrase: string; scope: readonly string[] }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = password.length > 0 && confirmation.trim() === phrase;

  function run() {
    setError(null);
    startTransition(async () => {
      let idToken: string;
      try {
        const auth = await firebaseClientAuth();
        const cred = await signInWithEmailAndPassword(auth, adminEmail, password);
        idToken = await cred.user.getIdToken();
        await signOut(auth); // the httpOnly cookie stays the only session, as at login
      } catch (err) {
        setError(err instanceof FirebaseError && err.code === "auth/too-many-requests" ? "Too many attempts. Wait a moment and try again." : "Incorrect password. Re-authentication failed; nothing was changed.");
        return;
      }
      const res = await hardResetPlatformAction({ idToken, confirmation });
      setPassword("");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmation("");
      toast.success(`Platform reset complete — ${res.data.removed} record${res.data.removed === 1 ? "" : "s"} removed. Your admin account is intact.`);
      router.push("/admin");
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/50" id="danger-zone">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4" /> Hard Reset Platform
        </CardTitle>
        <CardDescription>This permanently removes V3PL business and test data. Your Admin account and application configuration will remain.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">What gets removed</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">Kept: database schema and migrations, Firebase authentication, staff accounts including yours, the audit log, environment configuration. Data inside connected Shopify stores is not touched — only the local connection records are removed.</p>
        </details>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reset-email">Admin account</Label>
            <Input id="reset-email" value={adminEmail} readOnly disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Re-enter your password</Label>
            <Input id="reset-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="reset-phrase">
              Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to confirm
            </Label>
            <Input id="reset-phrase" autoComplete="off" spellCheck={false} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={pending} data-slot="reset-phrase" />
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Reset not performed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" disabled={!ready || pending} data-slot="reset-open" />}>
            {pending ? <Loader2 className="animate-spin" /> : <AlertTriangle />} Hard Reset Platform
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently reset V3PL?</AlertDialogTitle>
              <AlertDialogDescription>
                Every product, order, customer, warehouse, vendor, 3PL client, salesman, finance record, Shopify connection and notification will be deleted. This cannot be undone. Your admin account, settings and the application stay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={run} data-slot="reset-confirm">
                Yes, reset everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
