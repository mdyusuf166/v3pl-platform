import type { Metadata } from "next";
import { PublicPage } from "@/components/public/public-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy", robots: { index: true, follow: true } };

/** Public: no session required (the proxy only guards /admin and /portal). */
export default function PrivacyPage() {
  return <PublicPage slug="privacy" />;
}
