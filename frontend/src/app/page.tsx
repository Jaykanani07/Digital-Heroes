"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, FileCheck2, PenTool, Printer, SlidersHorizontal } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { Division } from "@/lib/types";
import { API_URL } from "@/lib/api";
import { DivisionIcon } from "@/components/site";
import { CardGridSkeleton, ErrorState, LinkButton } from "@/components/ui";
import { QuickQuote } from "@/components/quick-quote";

const fade = { initial: { opacity: 0, y: 14 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.4, ease: [0.2, 0.8, 0.2, 1] as const } };

export default function Home() {
  const { data: divisions, error, loading, reload } = useApi<Division[]>("/catalog/divisions");
  const { data: gallery } = useApi<{ id: string; title: string; division_name: string; division_slug: string }[]>("/gallery");

  return (
    <div>
      {/* ------------------------------------------------------------- hero */}
      <section className="grid-lines border-b-[1.5px] border-ink">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 md:grid-cols-[1.15fr_1fr] md:py-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="space-y-6">
            <p className="label-caps inline-flex items-center gap-2 border-[1.5px] border-ink bg-paper px-2.5 py-1">
              <span className="size-2 bg-signal outline outline-[1.5px] outline-ink" aria-hidden /> Bays 01–06 · six divisions, one press
            </p>
            <h1 className="font-display text-[64px] sm:text-[92px] lg:text-[112px]">
              Built for the start line and the shop floor.
            </h1>
            <p className="max-w-xl text-lg text-ink/80">
              Configure any print job, get the price instantly, design it in your browser and approve a real proof. We run it from quote to dispatch — and you can reorder in one click.
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/products" variant="primary" size="lg">
                Start a print job <ArrowRight className="size-5" aria-hidden />
              </LinkButton>
              <LinkButton href="/calculator" size="lg">
                Get an instant price
              </LinkButton>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, rotate: -2, y: 20 }} animate={{ opacity: 1, rotate: -2, y: 0 }} transition={{ duration: 0.55, delay: 0.1 }} className="relative mx-auto w-full max-w-md" aria-hidden>
            <div className="border-[1.5px] border-ink bg-paper p-3 shadow-[10px_10px_0_0_var(--color-ink)]">
              <div className="flex items-center justify-between bg-ink px-3 py-2 text-signal">
                <span className="font-display text-2xl">CITY 10K · 2026</span>
                <span className="label-caps text-paper/70">Proof v2</span>
              </div>
              <div className="grid place-items-center bg-signal py-6">
                <span className="font-display text-[150px] leading-[0.75] sm:text-[180px]">247</span>
              </div>
              <div className="flex items-center justify-between border-t-[1.5px] border-ink px-3 py-2 text-[13px]">
                <span className="font-bold">A5 · Tyvek · CSV × 1,200</span>
                <span className="inline-flex items-center gap-1 font-bold text-ok">
                  <CheckCircle2 className="size-4" /> Approved
                </span>
              </div>
            </div>
            <div className="absolute -bottom-6 -left-4 rotate-3 border-[1.5px] border-ink bg-ink px-3 py-2 text-paper shadow-[4px_4px_0_0_var(--color-signal)]">
              <p className="label-caps text-signal">Instant price</p>
              <p className="font-display text-4xl">₹0.74 each</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------ product hub */}
      <section className="mx-auto max-w-7xl px-4 py-16" aria-labelledby="hub-title">
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <h2 id="hub-title" className="font-display text-6xl">
            Pick a bay.
          </h2>
          <p className="max-w-md text-steel">Every product is configured, not catalogued — choose your size, material and quantity and the price follows.</p>
        </div>
        {loading && <CardGridSkeleton count={6} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {divisions && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {divisions.map((d, i) => {
              const from = d.products.map((p) => p.fromPrice).filter((x): x is number => x !== null);
              return (
                <motion.div key={d.id} {...fade} transition={{ ...fade.transition, delay: i * 0.04 }}>
                  <Link
                    href={`/products/${d.slug}`}
                    className="group flex h-full flex-col justify-between gap-6 border-[1.5px] border-ink bg-paper p-5 transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-1 hover:bg-white hover:shadow-[6px_6px_0_0_var(--color-ink)]"
                  >
                    <div className="flex items-start justify-between">
                      <span className="label-caps text-steel">Bay {String(i + 1).padStart(2, "0")}</span>
                      <span className="grid size-12 place-items-center border-[1.5px] border-ink bg-signal transition-transform group-hover:-rotate-6">
                        <DivisionIcon slug={d.slug} className="size-6" />
                      </span>
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-display text-[44px]">{d.name}</h3>
                      <p className="text-sm text-steel">{d.tagline}</p>
                    </div>
                    <div className="flex items-center justify-between border-t-[1.5px] border-ink/15 pt-3 text-sm">
                      <span className="font-bold">{d.products.length} product{d.products.length === 1 ? "" : "s"}{from.length ? ` · from ₹${Math.min(...from).toFixed(2)}` : ""}</span>
                      <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- instant price */}
      <section className="border-y-[1.5px] border-ink bg-paper">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-[1fr_1.1fr] md:items-center">
          <motion.div {...fade} className="space-y-4">
            <p className="label-caps text-steel">No quote forms. No waiting.</p>
            <h2 className="font-display text-6xl">Your price, before you&apos;ve finished deciding.</h2>
            <p className="text-steel">Per-unit pricing by product, size and quantity. Volume discounts apply automatically from 100 units, and every total you see already includes GST.</p>
            <LinkButton href="/calculator">Open the full calculator</LinkButton>
          </motion.div>
          <motion.div {...fade}>{divisions && <QuickQuote divisions={divisions} />}</motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section className="mx-auto max-w-7xl px-4 py-16" aria-labelledby="how-title">
        <h2 id="how-title" className="mb-8 font-display text-6xl">
          Quote to done, in four moves.
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: SlidersHorizontal, t: "Configure", b: "Size, material, orientation and quantity. Price updates live." },
            { Icon: PenTool, t: "Design", b: "Edit text, fonts and logos inside the printable zone — or upload finished artwork." },
            { Icon: FileCheck2, t: "Approve the proof", b: "We render the exact print file. Approve it or ask for changes; every version is kept." },
            { Icon: Printer, t: "We print", b: "Files unlock for production the moment you approve. Track it, then reorder in one click." },
          ].map(({ Icon, t, b }, i) => (
            <motion.li key={t} {...fade} transition={{ ...fade.transition, delay: i * 0.06 }} className="border-[1.5px] border-ink bg-paper p-5">
              <div className="mb-6 flex items-center justify-between">
                <span className="font-display text-5xl text-ink/25">0{i + 1}</span>
                <Icon className="size-7" aria-hidden strokeWidth={1.75} />
              </div>
              <h3 className="font-display text-3xl">{t}</h3>
              <p className="mt-2 text-sm text-steel">{b}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* ----------------------------------------------------------- gallery */}
      {gallery && gallery.length > 0 && (
        <section className="mx-auto max-w-7xl px-4" aria-labelledby="gallery-title">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 id="gallery-title" className="font-display text-6xl">
              Off the press.
            </h2>
            <Link href="/gallery" className="inline-flex items-center gap-1 font-bold hover:underline">
              Full gallery <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {gallery.slice(0, 8).map((g) => (
              <Link key={g.id} href={`/gallery?division=${g.division_slug}`} className="group border-[1.5px] border-ink bg-paper">
                <div className="grid aspect-[4/3] place-items-center overflow-hidden bg-concrete-dark p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API_URL}/api/gallery/${g.id}/image`} alt={g.title} loading="lazy" className="max-h-full max-w-full object-contain shadow-[3px_3px_0_0_rgb(20_20_20/0.25)] transition-transform duration-300 group-hover:scale-[1.03]" />
                </div>
                <div className="border-t-[1.5px] border-ink px-3 py-2">
                  <p className="truncate text-sm font-bold">{g.title}</p>
                  <p className="label-caps text-steel">{g.division_name}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
