"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { SUPPORT_METHODS, SUPPORT_METHOD_LABELS, supportDestination, supportSettingsSchema, type SupportSettings, type SupportSettingsInput } from "@/lib/validation/support";
import { saveSupportSettingsAction } from "@/server/actions/support";

export function SupportSettingsForm({ initial }: { initial: SupportSettings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<SupportSettingsInput, unknown, SupportSettings>({ resolver: zodResolver(supportSettingsSchema), defaultValues: initial });
  const { errors } = form.formState;
  const values = useWatch({ control: form.control });
  const enabled = values.enabled ?? initial.enabled;
  const method = values.method ?? initial.method;
  const preview = supportDestination(supportSettingsSchema.safeParse(values).data ?? null);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await saveSupportSettingsAction(form.getValues());
      if (!res.ok) {
        setError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof SupportSettingsInput, { message: v });
        return;
      }
      toast.success("Support settings saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Support button</CardTitle>
          <CardDescription>Shown bottom-right on the vendor, 3PL, salesman, warehouse and sales screens — never on the admin dashboard. Opens the user&apos;s own e-mail or WhatsApp app; V3PL sends nothing itself.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="support-enabled">Show the support button</Label>
              <p className="text-xs text-muted-foreground">When off, or when the selected method is not configured, the button is hidden.</p>
            </div>
            <Switch id="support-enabled" checked={enabled} onCheckedChange={(v) => form.setValue("enabled", v, { shouldDirty: true })} />
          </div>
          <FormField id="support-method" label="Support method" error={errors.method?.message}>
            <NativeSelect id="support-method" {...form.register("method")}>
              {SUPPORT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {SUPPORT_METHOD_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {method === "EMAIL" ? (
            <FormField id="support-email" label="Support e-mail address" error={errors.email?.message} required={enabled}>
              <Input id="support-email" type="email" placeholder="support@example.com" {...form.register("email")} />
            </FormField>
          ) : (
            <FormField id="support-whatsapp" label="WhatsApp number" error={errors.whatsapp?.message} hint="International format, e.g. +8801XXXXXXXXX. A local Bangladeshi mobile (017…) is accepted." required={enabled}>
              <Input id="support-whatsapp" inputMode="tel" placeholder="+8801XXXXXXXXX" {...form.register("whatsapp")} />
            </FormField>
          )}
          <p className="text-xs text-muted-foreground" data-slot="support-preview">
            {preview ? (
              <>
                Button opens: <span className="break-all font-mono">{preview.href}</span>
              </>
            ) : (
              "Button hidden until support is enabled and the selected method is configured."
            )}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
