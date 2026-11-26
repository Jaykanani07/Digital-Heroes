import type { ProductConfig, MaterialOption } from "@/shared/pricing";

export { formatMoney, formatUnit } from "@/shared/pricing";

export const formatDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const mm = (n: number) => `${Math.round(n * 10) / 10}`;

export function describeConfig(c: ProductConfig, materials?: MaterialOption[]) {
  const material = materials?.find((m) => m.key === c.material)?.label ?? c.material;
  return `${mm(c.widthMm)} × ${mm(c.heightMm)} mm · ${material}`;
}

export const formatBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
