"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/common/form-field";
import { contactActions, contactSettingsSchema, type ContactSettings } from "@/lib/validation/pages";
import { saveContactSettingsAction } from "@/server/actions/public-pages";

type Errors = Partial<Record<keyof ContactSettings | "form", string>>;

/** Contact box on the public Privacy page (PUB-01): independent of the in-app support button. */
export function ContactSettingsForm({ initial }: { initial: ContactSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<ContactSettings>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ContactSettings>(k: K, v: ContactSettings[K]) => setValues((s) => ({ ...s, [k]: v }));
  const preview = contactSettingsSchema.safeParse(values);
  const actions = preview.success ? contactActions(preview.data) : [];

  function save() {
    const parsed = contactSettingsSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) as Errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveContactSettingsAction(parsed.data);
      if (!res.ok) {
        setErrors({ ...(res.fieldErrors ?? {}), form: res.error } as Errors);
        return;
      }
      toast.success("Contact section saved");
      router.refresh();
    });
  }

  return (
    <Card data-slot="contact-settings">
      <CardHeader>
        <CardTitle>Contact section</CardTitle>
        <CardDescription>Shown at the foot of the public Privacy page. Only configured methods become buttons; when disabled, or when neither method is set, the section is hidden.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <Label htmlFor="contact-enabled">Show the contact section</Label>
          <Switch id="contact-enabled" checked={values.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={pending} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="contact-heading" label="Heading" error={errors.heading} required>
            <Input id="contact-heading" value={values.heading} onChange={(e) => set("heading", e.target.value)} maxLength={80} disabled={pending} />
          </FormField>
          <FormField id="contact-button" label="Button label (optional)" error={errors.buttonLabel} hint="Used for the first button; defaults to the address or number.">
            <Input id="contact-button" value={values.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} maxLength={40} placeholder="e.g. Get in touch" disabled={pending} />
          </FormField>
          <FormField id="contact-message" label="Message (optional)" error={errors.message} className="sm:col-span-2">
            <Textarea id="contact-message" value={values.message} onChange={(e) => set("message", e.target.value)} rows={3} maxLength={600} disabled={pending} />
          </FormField>
          <FormField id="contact-email" label="Contact e-mail" error={errors.email}>
            <Input id="contact-email" type="email" value={values.email} onChange={(e) => set("email", e.target.value)} placeholder="hello@example.com" disabled={pending} />
          </FormField>
          <FormField id="contact-phone" label="WhatsApp / phone" error={errors.phone} hint="International format, e.g. +8801XXXXXXXXX.">
            <Input id="contact-phone" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+8801XXXXXXXXX" disabled={pending} />
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground" data-slot="contact-preview">
          {actions.length ? `Buttons shown: ${actions.map((a) => `${a.label} → ${a.href}`).join(" · ")}` : "Section hidden on the public page."}
        </p>
        {errors.form && (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
