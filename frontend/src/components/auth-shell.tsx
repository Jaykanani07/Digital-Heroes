"use client";

/** Only follow same-site relative redirects. */
export function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="grid-lines min-h-[calc(100dvh-4rem)] px-4 py-12">
      <div className="mx-auto max-w-md border-[1.5px] border-ink bg-paper shadow-[8px_8px_0_0_var(--color-ink)]">
        <div className="hazard h-2" aria-hidden />
        <div className="space-y-6 p-6 sm:p-8">
          <div className="space-y-2">
            <h1 className="font-display text-6xl">{title}</h1>
            <p className="text-steel">{sub}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
