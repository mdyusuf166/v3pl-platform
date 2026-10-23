import Link from "next/link";
import { Button } from "@/components/ui/button";
import { contactActions, pageBlocks, type PublicPageSlug } from "@/lib/validation/pages";
import { getContactSettings, getPublicPage } from "@/server/services/public-pages";

/**
 * Public, unauthenticated page frame (PUB-01). Renders the ADMIN-published plain text as headings, lists and
 * paragraphs (text only, never HTML) plus the ADMIN-managed contact box when it is enabled and has at least one
 * configured method. No session, no internal settings.
 */
export async function PublicPage({ slug }: { slug: PublicPageSlug }) {
  const [page, contact] = await Promise.all([getPublicPage(slug), getContactSettings()]);
  const actions = contactActions(contact);
  return (
    <main className="flex flex-1 flex-col bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">V3</span>
            V3PL
          </Link>
          <nav className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/admin/login" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
        {page.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Last updated {page.updatedAt.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>}
        <div className="mt-8 space-y-4 text-[15px] leading-7 text-foreground/90" data-slot="public-page-content">
          {pageBlocks(page.content).map((b, i) => {
            if (b.kind === "heading") return <h2 key={i} className="mt-8 text-xl font-semibold tracking-tight text-foreground">{b.text}</h2>;
            if (b.kind === "list")
              return (
                <ul key={i} className="list-disc space-y-1 pl-6">
                  {b.items.map((it, j) => (
                    <li key={j}>{it}</li>
                  ))}
                </ul>
              );
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {l}
                  </span>
                ))}
              </p>
            );
          })}
        </div>
        {actions.length > 0 && (
          <section className="mt-10 rounded-lg border bg-background p-5" data-slot="public-page-contact">
            <p className="font-medium">{contact.heading}</p>
            {contact.message && <p className="mt-1 text-sm text-muted-foreground">{contact.message}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button key={a.kind} variant={a.kind === "email" ? "default" : "outline"} size="sm" render={<a href={a.href} target="_blank" rel="noopener noreferrer" />} data-slot={`contact-${a.kind}`}>
                  {a.label}
                </Button>
              ))}
            </div>
          </section>
        )}
      </article>
      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-4 px-4 py-4 text-xs text-muted-foreground">
          <span>V3PL</span>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <span className="ml-auto">Private, invite-only platform</span>
        </div>
      </footer>
    </main>
  );
}
