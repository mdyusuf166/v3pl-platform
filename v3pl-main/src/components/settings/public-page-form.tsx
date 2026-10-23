"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/common/form-field";
import { PUBLIC_PAGE_LABELS, publicPageSchema, type PublicPageSlug, type PublicPageValues } from "@/lib/validation/pages";
import { savePublicPageAction } from "@/server/actions/public-pages";

/** One editor per public page (PUB-01): title + plain-text content, saved = published. */
export function PublicPageForm({ slug, initial, customised }: { slug: PublicPageSlug; initial: PublicPageValues; customised: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [errors, setErrors] = useState<{ title?: string; content?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  function save() {
    const parsed = publicPageSchema.safeParse({ title, content });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await savePublicPageAction(slug, parsed.data);
      if (!res.ok) {
        setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
        return;
      }
      toast.success(`${PUBLIC_PAGE_LABELS[slug]} page published`);
      router.refresh();
    });
  }

  return (
    <Card data-slot={`public-page-${slug}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>
            {PUBLIC_PAGE_LABELS[slug]} page text <span className="font-mono text-xs font-normal text-muted-foreground">/{slug}</span>
          </span>
          <Button variant="ghost" size="sm" render={<a href={`/${slug}`} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink /> View
          </Button>
        </CardTitle>
        <CardDescription>
          {customised ? "Showing your published text." : "Showing the built-in default text — edit and save to publish your own."} Plain text only: start a line with <code>## </code> for a heading, <code>- </code> for a bullet, and leave a blank line between paragraphs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField id={`${slug}-title`} label="Title" error={errors.title} required>
          <Input id={`${slug}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={pending} />
        </FormField>
        <FormField id={`${slug}-content`} label="Content" error={errors.content} hint={`${content.length.toLocaleString()} / 20 000 characters`} required>
          <Textarea id={`${slug}-content`} value={content} onChange={(e) => setContent(e.target.value)} rows={18} className="font-mono text-xs leading-5" disabled={pending} />
        </FormField>
        {errors.form && (
          <Alert variant="destructive">
            <AlertDescription>{errors.form}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save and publish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
