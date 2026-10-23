"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/common/form-field";
import { partnerRecipientAction, sendPartnerEmailAction } from "@/server/actions/email";
import type { PartnerKind } from "@/server/services/email";

/**
 * Admin → partner e-mail composer (D-073). "To" is read-only and resolved server-side from the account; the
 * server resolves it again when sending, so the browser never chooses the recipient. Double-submit is
 * blocked while a send is in flight.
 */
export function SendEmailDialog({ kind, id, accountName, email }: { kind: PartnerKind; id: string; accountName: string; /** E-mail on record (server-rendered); null disables the button. */ email: string | null }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string | null>(email);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    setErrors({});
    void partnerRecipientAction(kind, id).then((r) => {
      if (r.ok) {
        setTo(r.data.email);
        setConfigured(r.data.configured);
      }
    });
  }

  function send() {
    if (pending) return;
    setErrors({});
    startTransition(async () => {
      const res = await sendPartnerEmailAction(kind, id, { subject, message });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) toast.error(res.error);
        return;
      }
      toast.success(`E-mail sent to ${res.data.to}`);
      setOpen(false);
      setSubject("");
      setMessage("");
    });
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog} disabled={!email} title={email ? undefined : "No e-mail address on record for this account"} data-slot="send-email">
        <Mail /> Send email
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send e-mail to {accountName}</DialogTitle>
            <DialogDescription>Sent from V3PL to the address on this account. The message is recorded in the audit log (subject and recipient only).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3" data-slot="send-email-form">
            <FormField id="se-to" label="To">
              <Input id="se-to" value={to ?? ""} readOnly className="bg-muted/40" />
            </FormField>
            <FormField id="se-subject" label="Subject" required error={errors.subject}>
              <Input id="se-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={pending} maxLength={150} aria-invalid={!!errors.subject} />
            </FormField>
            <FormField id="se-message" label="Message" required error={errors.message}>
              <Textarea id="se-message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={pending} rows={8} maxLength={5000} aria-invalid={!!errors.message} />
            </FormField>
            {configured === false && <p className="text-sm text-amber-700">E-mail is not configured on this server yet (EMAILJS_* environment variables). Sending will fail until it is.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={pending || !to}>
              {pending && <Loader2 className="animate-spin" />} Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
