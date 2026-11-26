"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Design } from "@/shared/design";
import type { ProductConfig } from "@/shared/pricing";
import type { CsvInfo } from "./types";

/**
 * The job a customer is building, per product. Persisted to localStorage so
 * nothing is lost when they're sent to sign in halfway through.
 */
export interface Draft {
  productId: string;
  config: ProductConfig;
  design: Design | null;
  csv: CsvInfo | null;
  /** Saved design being edited (save updates it instead of creating a new one). */
  designId: string | null;
  designName: string | null;
  updatedAt: number;
}

interface DraftStore {
  drafts: Record<string, Draft>;
  setDraft: (slug: string, draft: Partial<Draft> & { productId: string; config: ProductConfig }) => void;
  patchDraft: (slug: string, patch: Partial<Draft>) => void;
  clearDraft: (slug: string) => void;
}

export const useDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (slug, d) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [slug]: { design: null, csv: null, designId: null, designName: null, ...d, updatedAt: Date.now() },
          },
        })),
      patchDraft: (slug, patch) =>
        set((s) => (s.drafts[slug] ? { drafts: { ...s.drafts, [slug]: { ...s.drafts[slug], ...patch, updatedAt: Date.now() } } } : s)),
      clearDraft: (slug) =>
        set((s) => {
          const next = { ...s.drafts };
          delete next[slug];
          return { drafts: next };
        }),
    }),
    {
      name: "dh_drafts",
      storage: createJSONStorage(() => {
        try {
          return window.localStorage;
        } catch {
          return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
        }
      }),
    },
  ),
);
