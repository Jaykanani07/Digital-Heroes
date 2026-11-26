"use client";

import Link from "next/link";
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { cx } from "@/lib/format";
import { PIPELINE, STATUS_LABEL, type OrderStatus } from "@/lib/types";

// ---------------------------------------------------------------- Button

type Variant = "primary" | "secondary" | "dark" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-signal text-ink border-ink hover:bg-signal-dark",
  secondary: "bg-paper text-ink border-ink hover:bg-white",
  dark: "bg-ink text-paper border-ink hover:bg-ink-soft",
  ghost: "bg-transparent text-ink border-transparent hover:bg-ink/5",
  danger: "bg-paper text-danger border-danger hover:bg-danger-bg",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 border-[1.5px] font-bold whitespace-nowrap select-none",
    "transition-[transform,background-color] duration-150 ease-[var(--ease-snap)] active:translate-y-px",
    "disabled:opacity-50 disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    extra,
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} aria-busy={busy || undefined} {...rest} disabled={rest.disabled || busy}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = "secondary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Fields

const controlBase =
  "w-full border-[1.5px] border-ink bg-white px-3 text-[15px] text-ink placeholder:text-steel-light outline-none focus:ring-2 focus:ring-signal focus:ring-offset-0 disabled:bg-paper disabled:text-steel";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="label-caps text-steel">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-steel">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(controlBase, "h-10", invalid && "border-danger", className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx(controlBase, "h-10 pr-8", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(controlBase, "min-h-24 py-2", invalid && "border-danger", className)} {...rest} />;
});

export function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
      <span className={cx("grid size-5 place-items-center border-[1.5px] border-ink", checked ? "bg-signal" : "bg-white")}>
        {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ------------------------------------------------------- Feedback pieces

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse bg-ink/10", className)} aria-hidden />;
}

export function CardGridSkeleton({ count = 6, cols = "sm:grid-cols-2 lg:grid-cols-3" }: { count?: number; cols?: string }) {
  return (
    <div className={cx("grid grid-cols-1 gap-3", cols)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col justify-between gap-5 border-[1.5px] border-ink/25 bg-paper p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="size-11" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex items-center justify-between border-t border-ink/10 pt-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="border-[1.5px] border-ink/25 bg-paper" role="status" aria-label="Loading">
      <div className="grid gap-3 border-b-[1.5px] border-ink/20 bg-concrete-dark/50 px-4 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      <div className="divide-y divide-ink/10">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid gap-3 px-4 py-3.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={cx("h-4", c === 0 ? "w-24" : c === cols - 1 ? "ml-auto w-16" : "w-3/4")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2 text-sm text-steel", className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-10" role="status" aria-label={label}>
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 border-[1.5px] border-ink/25 bg-paper p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}

const alertTone = {
  error: { cls: "border-danger bg-danger-bg text-danger", Icon: AlertTriangle },
  warning: { cls: "border-ink bg-signal/40 text-ink", Icon: AlertTriangle },
  success: { cls: "border-ok bg-ok-bg text-ok", Icon: CheckCircle2 },
  info: { cls: "border-info bg-info-bg text-info", Icon: Info },
};

export function Alert({ tone = "info", title, children, action, className }: { tone?: keyof typeof alertTone; title?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const { cls, Icon } = alertTone[tone];
  return (
    <div className={cx("flex gap-3 border-[1.5px] p-3 text-sm", cls, className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1 space-y-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="error" title="That didn't load" action={onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}>
      {message}
    </Alert>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 border-[1.5px] border-dashed border-steel bg-paper/60 px-6 py-12 text-center">
      {icon}
      <p className="font-display text-3xl">{title}</p>
      {body && <p className="max-w-md text-sm text-steel">{body}</p>}
      {action}
    </div>
  );
}

// ------------------------------------------------------------ Badges

const statusTone: Record<string, string> = {
  quote: "bg-white text-steel border-steel",
  order: "bg-info-bg text-info border-info",
  artwork: "bg-signal/40 text-ink border-ink",
  proof: "bg-signal text-ink border-ink",
  production: "bg-ink text-signal border-ink",
  completed: "bg-ok-bg text-ok border-ok",
  pending: "bg-signal text-ink border-ink",
  approved: "bg-ok-bg text-ok border-ok",
  changes_requested: "bg-danger-bg text-danger border-danger",
  superseded: "bg-white text-steel border-steel",
  paid: "bg-ok-bg text-ok border-ok",
  unpaid: "bg-white text-steel border-steel",
  active: "bg-ok-bg text-ok border-ok",
  inactive: "bg-white text-steel border-steel",
  admin: "bg-ink text-signal border-ink",
  customer: "bg-white text-ink border-ink",
};

const badgeLabel: Record<string, string> = {
  ...STATUS_LABEL,
  pending: "Awaiting approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  superseded: "Superseded",
  paid: "Paid",
  unpaid: "Unpaid",
};

export function Badge({ status, children, className }: { status: string; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center border px-2 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap", statusTone[status] || statusTone.quote, className)}>
      {children ?? badgeLabel[status] ?? status}
    </span>
  );
}

/** QUOTE → ORDER → ARTWORK → PROOF → PRODUCTION → COMPLETED */
export function Pipeline({ status, compact }: { status: OrderStatus; compact?: boolean }) {
  const idx = PIPELINE.indexOf(status);
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label={`Status: ${STATUS_LABEL[status]}`}>
      {PIPELINE.map((s, i) => (
        <li key={s} className="flex flex-col gap-1" aria-current={i === idx ? "step" : undefined}>
          <span className={cx("h-2", i < idx ? "bg-ink" : i === idx ? "bg-signal outline outline-[1.5px] outline-ink" : "bg-ink/15")} />
          {!compact && (
            <span className={cx("label-caps truncate !text-[10px] sm:!text-[11px]", i === idx ? "text-ink" : i < idx ? "text-ink/70" : "text-steel-light")}>
              {STATUS_LABEL[s]}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------- Layout

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        {eyebrow && <p className="label-caps text-steel">{eyebrow}</p>}
        <h1 className="font-display text-5xl sm:text-6xl">{title}</h1>
        {children && <div className="max-w-2xl text-steel">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("border-[1.5px] border-ink bg-paper", className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b-[1.5px] border-ink bg-ink px-4 py-2 text-paper">
          <h2 className="label-caps !text-[12px] text-paper">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 border-[1.5px] border-ink bg-paper p-4">
      <p className="label-caps text-steel">{label}</p>
      <p className="mt-2 break-words font-display text-[clamp(1.75rem,8vw,3rem)] leading-none sm:text-5xl">{value}</p>
      {hint && <p className="mt-1 text-[13px] text-steel">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------- Modal

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  // Unmounts immediately on close (no exit animation) so closing never waits on animation frames.
  if (!open) return null;
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("flex max-h-[90vh] w-full flex-col border-[1.5px] border-ink bg-paper", wide ? "max-w-4xl" : "max-w-lg")}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.18 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b-[1.5px] border-ink bg-ink px-4 py-3 text-paper">
          <h2 className="font-bold">{title}</h2>
          <button className="grid size-8 place-items-center hover:bg-white/10" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </header>
        <div className="overflow-auto p-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ------------------------------------------------------------- Toasts

interface ToastItem {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}
const ToastContext = createContext<(text: string, tone?: ToastItem["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cx(
                "pointer-events-auto flex max-w-md items-center gap-2 border-[1.5px] px-4 py-3 text-sm font-semibold",
                t.tone === "error" ? "border-danger bg-danger-bg text-danger" : t.tone === "info" ? "border-ink bg-paper text-ink" : "border-ink bg-ink text-signal",
              )}
            >
              {t.tone === "error" ? <AlertTriangle className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {t.text}
            </motion.div>
          ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ------------------------------------------------------------- Tables

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto border-[1.5px] border-ink bg-paper", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cx("border-b-[1.5px] border-ink bg-ink px-3 py-2 text-left label-caps text-paper", className)}>{children}</th>
);
export const Td = ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx("border-b border-ink/15 px-3 py-2.5 align-middle", className)}>
    {children}
  </td>
);
