"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: { client_id: string; callback: (res: { credential?: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** Renders Google Identity Services sign-in button when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set. */
export function GoogleSignInButton({ onCredential, disabled }: { onCredential: (credential: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !ref.current || !window.google?.accounts?.id) return;
      ref.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (res) => {
          if (res.credential) cbRef.current(res.credential);
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        width: ref.current.offsetWidth || 360,
        text: "continue_with",
        shape: "rectangular",
      });
    };

    if (window.google?.accounts?.id) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-gsi="1"]');
    if (existing) {
      existing.addEventListener("load", render);
      return () => {
        cancelled = true;
        existing.removeEventListener("load", render);
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.gsi = "1";
    script.onload = render;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!CLIENT_ID) return null;

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
      <div className="my-4 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-steel">
        <span className="h-px flex-1 bg-ink/15" />
        or
        <span className="h-px flex-1 bg-ink/15" />
      </div>
      <div ref={ref} className="flex min-h-[44px] justify-center" />
    </div>
  );
}

