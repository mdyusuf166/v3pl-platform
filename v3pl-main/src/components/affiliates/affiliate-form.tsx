"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/common/form-field";
import { NativeSelect } from "@/components/common/native-select";
import { COMMISSION_TYPES, COMMISSION_TYPE_LABELS, affiliateFormSchema, type AffiliateFormInput, type AffiliateFormValues } from "@/lib/validation/affiliates";
import { createAffiliateAction, updateAffiliateAction } from "@/server/actions/affiliates";

type Props = { mode: "create" } | { mode: "edit"; id: string; initial: AffiliateFormInput };

/** Admin form for an affiliate (D-070): identity, status and the default commission rule. */
export function AffiliateForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AffiliateFormInput, unknown, AffiliateFormValues>({
    resolver: zodResolver(affiliateFormSchema),
    defaultValues: props.mode === "edit" ? props.initial : { code: "", name: "", email: "", phone: "", status: "ACTIVE", commissionType: "", commissionValue: "", notes: "" },
  });
  const { errors } = form.formState;
  const type = form.watch("commissionType");
  const reg = (name: keyof AffiliateFormInput) => ({ id: `af-${name}`, "aria-invalid": !!errors[name], disabled: pending, ...form.register(name) });

  function onSubmit() {
    setFormError(null);
    const values = form.getValues();
    startTransition(async () => {
      const res = props.mode === "create" ? await createAffiliateAction(values) : await updateAffiliateAction(props.id, values);
      if (!res.ok) {
        setFormError(res.fieldErrors ? null : res.error);
        for (const [f, m] of Object.entries(res.fieldErrors ?? {})) form.setError(f as keyof AffiliateFormInput, { message: m });
        return;
      }
      toast.success(props.mode === "create" ? "Salesman created" : "Salesman updated");
      router.push(`/admin/affiliates/${res.data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6" data-slot="affiliate-form">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Salesman</CardTitle>
            <CardDescription>An external sales partner. Not a vendor, 3PL client or staff member: they sell only the products you assign and earn the commission set here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <FormField id="af-code" label="Code" required error={errors.code?.message} hint="Short unique code, e.g. AFF-01.">
              <Input {...reg("code")} className="uppercase" />
            </FormField>
            <FormField id="af-status" label="Status" error={errors.status?.message}>
              <NativeSelect {...reg("status")}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive (users locked out, no new sales)</option>
              </NativeSelect>
            </FormField>
            <FormField id="af-name" label="Name" required error={errors.name?.message} className="sm:col-span-2">
              <Input {...reg("name")} />
            </FormField>
            <FormField id="af-email" label="Contact e-mail" error={errors.email?.message} hint="Informational — sign-in accounts are added on the salesman page.">
              <Input {...reg("email")} type="email" />
            </FormField>
            <FormField id="af-phone" label="Phone" error={errors.phone?.message}>
              <Input {...reg("phone")} type="tel" />
            </FormField>
            <FormField id="af-notes" label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
              <Textarea {...reg("notes")} rows={3} />
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Default commission</CardTitle>
            <CardDescription>Applied to every sale unless a product has its own rule. Changing it later never alters commissions already recorded — each order keeps the rule in force when it was placed.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <FormField id="af-commissionType" label="Commission type" error={errors.commissionType?.message}>
              <NativeSelect {...reg("commissionType")}>
                <option value="">No commission</option>
                {COMMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMMISSION_TYPE_LABELS[t].label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="af-commissionValue" label={type ? `Value (${COMMISSION_TYPE_LABELS[type as keyof typeof COMMISSION_TYPE_LABELS]?.unit ?? ""})` : "Value"} error={errors.commissionValue?.message} hint={type ? COMMISSION_TYPE_LABELS[type as keyof typeof COMMISSION_TYPE_LABELS]?.hint : undefined}>
              <Input {...reg("commissionValue")} inputMode="decimal" placeholder={type === "PERCENTAGE_OF_SALE" ? "10" : "5.00"} />
            </FormField>
          </CardContent>
        </Card>
      </div>
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {props.mode === "create" ? "Create salesman" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} render={<Link href={props.mode === "edit" ? `/admin/affiliates/${props.id}` : "/admin/affiliates"} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
