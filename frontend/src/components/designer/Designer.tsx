"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  FileSpreadsheet,
  ImagePlus,
  Lock,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import {
  FONTS,
  FONT_KEYS,
  PT_TO_MM,
  LINE_HEIGHT,
  allowedArea,
  clampPosition,
  elementBounds,
  fitText,
  isInside,
  newId,
  printArea,
  validateDesign,
  type Design,
  type DesignElement,
  type DesignIssue,
  type FontKey,
  type ImageElement,
  type ShapeElement,
} from "@/shared/design";
import { errorMessage, upload } from "@/lib/api";
import { measureMm } from "@/lib/measure";
import { cx } from "@/lib/format";
import type { CsvInfo, Product } from "@/lib/types";
import { ElementView, useFontsReady } from "./render";
import { Alert, Button, Field, Input, Select, Spinner, Textarea, useToast } from "../ui";

const SWATCHES = ["#141414", "#FFFFFF", "#F2C230", "#B3261E", "#1F4F8A", "#2E6B3A", "#E4007C", "#00A0E3", "#C9A646", "#5C5F58"];

interface History {
  past: Design[];
  present: Design;
  future: Design[];
}

type Drag =
  | { mode: "move"; id: string; start: { x: number; y: number }; el: DesignElement; before: Design; moved: boolean }
  | { mode: "resize"; id: string; el: DesignElement; sx: 1 | -1; sy: 1 | -1; keepRatio: boolean; before: Design; moved: boolean }
  | { mode: "rotate"; id: string; el: DesignElement; before: Design; moved: boolean };

export interface DesignerProps {
  product: Product;
  initial: Design;
  onChange?: (d: Design) => void;
  /** Show the CSV variable-data panel. */
  csv?: CsvInfo | null;
  onCsvChange?: (csv: CsvInfo | null) => void;
  /** Lets admins type a column name for templates without a CSV. */
  allowFreeBinding?: boolean;
  /** Toolbar actions rendered on the right, given the current design and issues. */
  actions: (design: Design, issues: DesignIssue[], row: Record<string, string> | null) => React.ReactNode;
  /** Templates can't carry customer images. */
  allowImages?: boolean;
}

export function Designer({ product, initial, onChange, csv, onCsvChange, allowFreeBinding, actions, allowImages = true }: DesignerProps) {
  const spec = product.print_spec;
  const fontsReady = useFontsReady();
  const toast = useToast();
  const [h, setH] = useState<History>({ past: [], present: initial, future: [] });
  const design = h.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  const selected = design.elements.find((e) => e.id === selectedId) || null;
  const row = csv?.rows[Math.min(rowIndex, csv.rows.length - 1)] ?? null;
  const area = printArea(design, spec);

  useEffect(() => {
    onChange?.(design);
  }, [design, onChange]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 3500);
      return () => clearTimeout(t);
    }
  }, [notice]);

  // ------------------------------------------------------------ history
  const commit = useCallback((next: Design, before?: Design) => {
    setH((s) => ({ past: [...s.past.slice(-80), before ?? s.present], present: next, future: [] }));
  }, []);
  const live = useCallback((next: Design) => setH((s) => ({ ...s, present: next })), []);
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);

  const replaceEl = (d: Design, el: DesignElement): Design => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? el : e)) });

  /** Applies a property change; geometry changes must stay inside the printable zone. */
  const updateEl = (patch: Partial<DesignElement>, opts: { geometry?: boolean } = {}) => {
    if (!selected) return;
    let next = { ...selected, ...patch } as DesignElement;
    if (opts.geometry) {
      const allowed = allowedArea(next, design, spec);
      if (!isInside(elementBounds(next), allowed)) next = clampPosition(next, allowed);
      if (!isInside(elementBounds(next), allowed)) {
        setNotice("That would go outside the printable zone.");
        return;
      }
    }
    commit(replaceEl(design, next));
  };

  // ------------------------------------------------------------ adding
  const addElement = (el: DesignElement) => {
    commit({ ...design, elements: [...design.elements, el] });
    setSelectedId(el.id);
  };

  const addText = () => {
    const w = area.w * 0.8;
    const hh = Math.max(4, area.h * 0.22);
    const pt = Math.max(6, Math.round((hh * 0.7) / PT_TO_MM / LINE_HEIGHT));
    addElement({
      id: newId(), type: "text", x: area.x + (area.w - w) / 2, y: area.y + (area.h - hh) / 2, w, h: hh, rotation: 0,
      text: "Your text", font: "schibsted-700", fontSize: pt, minFontSize: Math.max(5, Math.round(pt * 0.3)), tracking: 0, minTracking: -60,
      fit: "shrink", color: "#141414", align: "center", bindColumn: null,
    });
  };

  const addShape = (type: "rect" | "ellipse") => {
    const s = Math.min(area.w, area.h) * 0.4;
    addElement({ id: newId(), type, x: area.x + (area.w - s) / 2, y: area.y + (area.h - s) / 2, w: s, h: s, rotation: 0, fill: "#F2C230", stroke: null, strokeWidth: Math.max(0.3, s / 40), radius: 0 } as ShapeElement);
  };

  const logoInput = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const addLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const a = await upload("logo", file);
      const ratio = a.width / a.height || 1;
      let w = area.w * 0.45;
      let hh = w / ratio;
      if (hh > area.h * 0.45) {
        hh = area.h * 0.45;
        w = hh * ratio;
      }
      addElement({ id: newId(), type: "image", assetId: a.id, fit: "contain", x: area.x + (area.w - w) / 2, y: area.y + (area.h - hh) / 2, w, h: hh, rotation: 0, name: file.name.slice(0, 40) });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit({ ...design, elements: design.elements.filter((e) => e.id !== selectedId) });
    setSelectedId(null);
  }, [selectedId, design, commit]);

  const duplicate = useCallback(() => {
    if (!selected) return;
    const off = Math.min(area.w, area.h) * 0.04;
    let copy = { ...selected, id: newId(), x: selected.x + off, y: selected.y + off, locked: false } as DesignElement;
    copy = clampPosition(copy, allowedArea(copy, design, spec));
    if (!isInside(elementBounds(copy), allowedArea(copy, design, spec))) copy = { ...copy, x: selected.x, y: selected.y };
    addElement(copy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, design]);

  const reorder = (dir: 1 | -1) => {
    if (!selected) return;
    const els = [...design.elements];
    const i = els.findIndex((e) => e.id === selected.id);
    const j = Math.max(0, Math.min(els.length - 1, i + dir));
    if (i === j) return;
    [els[i], els[j]] = [els[j], els[i]];
    commit({ ...design, elements: els });
  };

  // ------------------------------------------------------- pointer → mm
  const toMm = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const startMove = (e: React.PointerEvent, el: DesignElement) => {
    e.stopPropagation();
    setSelectedId(el.id);
    if (el.locked) return;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = { mode: "move", id: el.id, start: toMm(e), el, before: design, moved: false };
  };
  const startResize = (e: React.PointerEvent, el: DesignElement, sx: 1 | -1, sy: 1 | -1) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = { mode: "resize", id: el.id, el, sx, sy, keepRatio: el.type === "image" || e.shiftKey, before: design, moved: false };
  };
  const startRotate = (e: React.PointerEvent, el: DesignElement) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = { mode: "rotate", id: el.id, el, before: design, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toMm(e);
    const el = d.el;
    let cand: DesignElement;
    if (d.mode === "move") {
      cand = { ...el, x: el.x + (p.x - d.start.x), y: el.y + (p.y - d.start.y) } as DesignElement;
      cand = clampPosition(cand, allowedArea(cand, design, spec));
    } else if (d.mode === "resize") {
      const r = (el.rotation * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      // fixed corner = opposite of the dragged handle
      const ox = (-d.sx * el.w) / 2;
      const oy = (-d.sy * el.h) / 2;
      const F = { x: c.x + ox * cos - oy * sin, y: c.y + ox * sin + oy * cos };
      const vx = p.x - F.x;
      const vy = p.y - F.y;
      const lx = vx * cos + vy * sin;
      const ly = -vx * sin + vy * cos;
      const min = 2;
      let w = Math.max(min, d.sx * lx);
      let hh = Math.max(min, d.sy * ly);
      if (d.keepRatio) {
        const ratio = el.w / el.h;
        if (w / hh > ratio) w = hh * ratio;
        else hh = w / ratio;
      }
      const hx = (d.sx * w) / 2;
      const hy = (d.sy * hh) / 2;
      const nc = { x: F.x + hx * cos - hy * sin, y: F.y + hx * sin + hy * cos };
      cand = { ...el, w, h: hh, x: nc.x - w / 2, y: nc.y - hh / 2 } as DesignElement;
    } else {
      const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      let ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      ang = e.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
      for (const snap of [0, 90, 180, -90, 270, -180]) if (Math.abs(ang - snap) < 3) ang = snap;
      if (ang > 180) ang -= 360;
      cand = { ...el, rotation: ang } as DesignElement;
      cand = clampPosition(cand, allowedArea(cand, design, spec));
    }
    // Print-area constraint: anything that would leave the printable zone is refused.
    if (!isInside(elementBounds(cand), allowedArea(cand, design, spec))) return;
    d.moved = true;
    live(replaceEl(h.present, cand));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) commit(h.present, d.before);
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (!selected) return;
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") setSelectedId(null);
      else if (e.key.startsWith("Arrow") && !selected.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const moved = clampPosition({ ...selected, x: selected.x + dx, y: selected.y + dy } as DesignElement, allowedArea(selected, design, spec));
        commit(replaceEl(design, moved));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, design, spec, undo, redo, duplicate, removeSelected, commit]);

  // ----------------------------------------------------------- validation
  const issues = useMemo(
    () => (fontsReady ? validateDesign(design, spec, measureMm, csv?.rows?.length ? csv.rows : null) : []),
    [design, spec, csv, fontsReady],
  );
  const issueIds = new Set(issues.map((i) => i.elementId));

  // ----------------------------------------------------------------- view
  const b = spec.bleedMm;
  const margin = Math.max(design.widthMm, design.heightMm) * 0.05;
  const vb = { x: -b - margin, y: -b - margin, w: design.widthMm + 2 * (b + margin), h: design.heightMm + 2 * (b + margin) };
  const hs = Math.max(vb.w, vb.h) / 55; // handle size in mm
  const line = Math.max(vb.w, vb.h) / 500;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-3">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-[1.5px] border-ink bg-paper p-1.5">
          <ToolButton onClick={addText} label="Add text">
            <Type className="size-4" />
            <span className="hidden sm:inline">Text</span>
          </ToolButton>
          <ToolButton onClick={() => addShape("rect")} label="Add rectangle">
            <Square className="size-4" />
          </ToolButton>
          <ToolButton onClick={() => addShape("ellipse")} label="Add ellipse">
            <Circle className="size-4" />
          </ToolButton>
          {allowImages && (
            <ToolButton onClick={() => logoInput.current?.click()} label="Upload logo or image" busy={uploadingLogo}>
              <ImagePlus className="size-4" />
              <span className="hidden sm:inline">Logo</span>
            </ToolButton>
          )}
          <input ref={logoInput} type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" className="sr-only" onChange={(e) => addLogo(e.target.files?.[0])} />
          <span className="mx-1 h-6 w-px bg-ink/20" aria-hidden />
          <ToolButton onClick={undo} label="Undo (Ctrl+Z)" disabled={!h.past.length}>
            <Undo2 className="size-4" />
          </ToolButton>
          <ToolButton onClick={redo} label="Redo (Ctrl+Shift+Z)" disabled={!h.future.length}>
            <Redo2 className="size-4" />
          </ToolButton>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions(design, issues, row)}</div>
        </div>

        {/* canvas */}
        <div className="relative border-[1.5px] border-ink bg-[#e6e7e2]">
          {!fontsReady && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-paper/70">
              <Spinner label="Loading fonts…" />
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="block max-h-[70vh] w-full touch-none select-none"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerDown={() => setSelectedId(null)}
            role="application"
            aria-label="Design canvas. Select an element to edit it; arrow keys move it."
          >
            <defs>
              <pattern id="dh-grid" width={10} height={10} patternUnits="userSpaceOnUse">
                <path d="M10 0H0V10" fill="none" stroke="rgba(20,20,20,0.06)" strokeWidth={line} />
              </pattern>
            </defs>
            <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#dh-grid)" />
            <rect x={-b} y={-b} width={design.widthMm + 2 * b} height={design.heightMm + 2 * b} fill={design.background} />
            {design.elements.map((el) => (
              <ElementView key={el.id} el={el} row={row} />
            ))}
            {/* bleed that gets trimmed */}
            {b > 0 && (
              <path
                fillRule="evenodd"
                fill="rgba(255,255,255,0.55)"
                d={`M${-b} ${-b}H${design.widthMm + b}V${design.heightMm + b}H${-b}Z M0 0V${design.heightMm}H${design.widthMm}V0Z`}
                pointerEvents="none"
              />
            )}
            <rect x={0} y={0} width={design.widthMm} height={design.heightMm} rx={spec.cornerRadiusMm || 0} fill="none" stroke="#E4007C" strokeWidth={line * 1.5} pointerEvents="none" />
            <rect x={area.x} y={area.y} width={area.w} height={area.h} fill="none" stroke="#00A0E3" strokeWidth={line * 1.5} strokeDasharray={`${line * 6} ${line * 4}`} pointerEvents="none" />

            {/* hit areas */}
            {design.elements.map((el) => (
              <rect
                key={`hit-${el.id}`}
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                transform={`rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})`}
                fill="transparent"
                stroke={issueIds.has(el.id) && el.id !== selectedId ? "#B3261E" : "none"}
                strokeWidth={line * 2}
                strokeDasharray={`${line * 4} ${line * 3}`}
                className={el.locked ? "cursor-default" : "cursor-move"}
                onPointerDown={(e) => startMove(e, el)}
              />
            ))}

            {/* selection */}
            {selected && (
              <g transform={`rotate(${selected.rotation} ${selected.x + selected.w / 2} ${selected.y + selected.h / 2})`}>
                <rect x={selected.x} y={selected.y} width={selected.w} height={selected.h} fill="none" stroke="#141414" strokeWidth={line * 2} pointerEvents="none" />
                {!selected.locked && (
                  <>
                    <line x1={selected.x + selected.w / 2} y1={selected.y} x2={selected.x + selected.w / 2} y2={selected.y - hs * 1.6} stroke="#141414" strokeWidth={line * 2} pointerEvents="none" />
                    <circle
                      cx={selected.x + selected.w / 2}
                      cy={selected.y - hs * 1.6}
                      r={hs * 0.55}
                      fill="#F2C230"
                      stroke="#141414"
                      strokeWidth={line * 2}
                      pointerEvents="none"
                    />
                    <circle
                      cx={selected.x + selected.w / 2}
                      cy={selected.y - hs * 1.6}
                      r={hs * 1.4}
                      fill="transparent"
                      className="cursor-grab touch-none"
                      onPointerDown={(e) => startRotate(e, selected)}
                    />
                    {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
                      const hx = selected.x + (sx > 0 ? selected.w : 0);
                      const hy = selected.y + (sy > 0 ? selected.h : 0);
                      return (
                        <g key={`${sx}${sy}`}>
                          <rect
                            x={hx - hs / 2}
                            y={hy - hs / 2}
                            width={hs}
                            height={hs}
                            fill="#FFFFFF"
                            stroke="#141414"
                            strokeWidth={line * 2}
                            pointerEvents="none"
                          />
                          <rect
                            x={hx - hs * 1.4}
                            y={hy - hs * 1.4}
                            width={hs * 2.8}
                            height={hs * 2.8}
                            fill="transparent"
                            className={cx(sx === sy ? "cursor-nwse-resize" : "cursor-nesw-resize", "touch-none")}
                            onPointerDown={(e) => startResize(e, selected, sx, sy)}
                          />
                        </g>
                      );
                    })}
                  </>
                )}
              </g>
            )}
          </svg>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-[1.5px] border-ink bg-paper px-3 py-1.5 text-[12px] text-steel">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-trim" aria-hidden /> Trim {Math.round(design.widthMm * 10) / 10} × {Math.round(design.heightMm * 10) / 10} mm
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-safe" aria-hidden /> Printable zone ({spec.safeMm} mm inset)
            </span>
            {b > 0 && <span>Pale edge = {b} mm bleed, trimmed off</span>}
          </div>
          {notice && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 border-[1.5px] border-ink bg-signal px-3 py-1.5 text-[13px] font-bold" role="status">
              {notice}
            </div>
          )}
        </div>

        {issues.length > 0 ? (
          <Alert tone="error" title={`${issues.length} thing${issues.length > 1 ? "s" : ""} to fix before ordering`}>
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.slice(0, 5).map((i, k) => (
                <li key={k}>
                  {i.elementId ? (
                    <button className="underline" onClick={() => setSelectedId(i.elementId)}>
                      {i.message}
                    </button>
                  ) : (
                    i.message
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <p className="text-[13px] text-steel">Everything fits inside the printable zone. Tip: arrow keys nudge 1 mm (Shift = 5 mm), Shift while resizing keeps proportions.</p>
        )}
      </div>

      {/* properties */}
      <aside className="space-y-4">
        {selected ? (
          <Inspector
            el={selected}
            design={design}
            fontsReady={fontsReady}
            row={row}
            columns={csv?.columns ?? null}
            allowFreeBinding={Boolean(allowFreeBinding || product.supports_csv)}
            onChange={updateEl}
            onDelete={removeSelected}
            onDuplicate={duplicate}
            onLayer={reorder}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <DocumentPanel design={design} onBackground={(c) => commit({ ...design, background: c })} onSelect={setSelectedId} />
        )}
        {onCsvChange && product.supports_csv && (
          <CsvPanel csv={csv ?? null} onChange={onCsvChange} rowIndex={rowIndex} setRowIndex={setRowIndex} hasBinding={design.elements.some((e) => e.type === "text" && e.bindColumn)} />
        )}
      </aside>
    </div>
  );
}

function ToolButton({ onClick, label, children, disabled, busy }: { onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 border-[1.5px] border-ink bg-white px-2 text-sm font-bold hover:bg-signal disabled:opacity-35"
    >
      {busy ? <Spinner label="" /> : children}
    </button>
  );
}

// ------------------------------------------------------------- panels

function ColorField({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <div className="space-y-1.5">
      <span className="label-caps text-steel">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} colour picker`} value={value ?? "#ffffff"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-11 cursor-pointer border-[1.5px] border-ink bg-white p-0.5" />
        <Input
          aria-label={`${label} hex`}
          value={text}
          placeholder={allowNone ? "None" : "#141414"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim().toUpperCase();
            if (/^#[0-9A-F]{6}$/.test(v)) onChange(v);
            else if (allowNone && v === "") onChange(null);
            else setText(value ?? "");
          }}
          className="h-9 font-mono text-sm"
        />
        {allowNone && value && (
          <button type="button" className="text-[12px] font-bold underline" onClick={() => onChange(null)}>
            None
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => onChange(c)} className={cx("size-6 border-[1.5px]", value === c ? "border-ink ring-2 ring-signal" : "border-ink/30")} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, onCommit, step = 0.5, suffix }: { label: string; value: number; onCommit: (v: number) => void; step?: number; suffix?: string }) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(Math.round(value * 100) / 100));
  };
  return (
    <Field label={suffix ? `${label} (${suffix})` : label}>
      {(id) => (
        <Input id={id} type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-9" />
      )}
    </Field>
  );
}

function Inspector({
  el,
  design,
  fontsReady,
  row,
  columns,
  allowFreeBinding,
  onChange,
  onDelete,
  onDuplicate,
  onLayer,
  onClose,
}: {
  el: DesignElement;
  design: Design;
  fontsReady: boolean;
  row: Record<string, string> | null;
  columns: string[] | null;
  allowFreeBinding: boolean;
  onChange: (p: Partial<DesignElement>, o?: { geometry?: boolean }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onLayer: (d: 1 | -1) => void;
  onClose: () => void;
}) {
  const kind = el.type === "text" ? "Text" : el.type === "image" ? (el.isArtwork ? "Artwork" : "Image") : el.type === "rect" ? "Rectangle" : "Ellipse";
  const fit = el.type === "text" && fontsReady ? fitText(el, measureMm, row) : null;
  return (
    <div className="border-[1.5px] border-ink bg-paper">
      <header className="flex items-center justify-between bg-ink px-3 py-2 text-paper">
        <span className="label-caps text-signal">{kind}</span>
        <div className="flex items-center gap-1">
          <IconBtn label={el.locked ? "Unlock" : "Lock position"} onClick={() => onChange({ locked: !el.locked })}>
            {el.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
          </IconBtn>
          <IconBtn label="Bring forward" onClick={() => onLayer(1)}>
            <ArrowUpToLine className="size-4" />
          </IconBtn>
          <IconBtn label="Send backward" onClick={() => onLayer(-1)}>
            <ArrowDownToLine className="size-4" />
          </IconBtn>
          <IconBtn label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
            <Copy className="size-4" />
          </IconBtn>
          <IconBtn label="Delete" onClick={onDelete}>
            <Trash2 className="size-4" />
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconBtn>
        </div>
      </header>
      <div className="space-y-4 p-3">
        {el.type === "text" && (
          <>
            <Field label={el.bindColumn ? `Text (replaced by "${el.bindColumn}" per CSV row)` : "Text"}>
              {(id) => <Textarea id={id} value={el.text} rows={2} className="min-h-16" onChange={(e) => onChange({ text: e.target.value })} />}
            </Field>
            <Field label="Font">
              {(id) => (
                <Select id={id} value={el.font} onChange={(e) => onChange({ font: e.target.value as FontKey })} style={{ fontFamily: FONTS[el.font].family }}>
                  {FONT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {FONTS[k].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Max size" suffix="pt" value={el.fontSize} step={1} onCommit={(v) => onChange({ fontSize: Math.max(2, Math.min(1000, v)), minFontSize: Math.min(el.minFontSize, Math.max(2, v)) })} />
              <NumberField label="Min size" suffix="pt" value={el.minFontSize} step={1} onCommit={(v) => onChange({ minFontSize: Math.max(2, Math.min(v, el.fontSize)) })} />
              <NumberField label="Tracking" value={el.tracking} step={5} onCommit={(v) => onChange({ tracking: Math.max(-200, Math.min(1000, v)), minTracking: Math.min(el.minTracking, v) })} />
              <NumberField label="Min tracking" value={el.minTracking} step={5} onCommit={(v) => onChange({ minTracking: Math.max(-200, Math.min(v, el.tracking)) })} />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Field label="Fitting">
                {(id) => (
                  <Select id={id} value={el.fit} onChange={(e) => onChange({ fit: e.target.value as "shrink" | "none" })} className="h-9 w-40">
                    <option value="shrink">Shrink to fit</option>
                    <option value="none">Fixed size</option>
                  </Select>
                )}
              </Field>
              <div className="flex" role="radiogroup" aria-label="Alignment">
                {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
                  <button key={a} type="button" role="radio" aria-checked={el.align === a} aria-label={`Align ${a}`} onClick={() => onChange({ align: a })} className={cx("grid size-9 place-items-center border-[1.5px] border-ink [&:not(:first-child)]:-ml-[1.5px]", el.align === a ? "bg-signal" : "bg-white")}>
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
            {fit && (
              <p className={cx("text-[12px]", fit.overflow ? "font-bold text-danger" : "text-steel")}>
                {fit.overflow
                  ? "Doesn't fit even at the minimum size — enlarge the box, shorten the text or lower the minimum."
                  : fit.fontSize < el.fontSize || fit.tracking < el.tracking
                    ? `Shrunk to fit: ${fit.fontSize} pt, tracking ${fit.tracking}.`
                    : `Set at ${fit.fontSize} pt.`}
              </p>
            )}
            <ColorField label="Colour" value={el.color} onChange={(c) => c && onChange({ color: c })} />
            {(columns || allowFreeBinding) && (
              <Field label="Variable data (CSV column)" hint="Each CSV row prints this box with that column's value.">
                {(id) =>
                  columns ? (
                    <Select id={id} value={el.bindColumn || ""} onChange={(e) => onChange({ bindColumn: e.target.value || null })}>
                      <option value="">Same on every item</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} placeholder="e.g. number" value={el.bindColumn || ""} onChange={(e) => onChange({ bindColumn: e.target.value.trim() || null })} />
                  )
                }
              </Field>
            )}
          </>
        )}
        {(el.type === "rect" || el.type === "ellipse") && (
          <>
            <ColorField label="Fill" value={el.fill} allowNone onChange={(c) => onChange({ fill: c })} />
            <ColorField label="Outline" value={el.stroke} allowNone onChange={(c) => onChange({ stroke: c })} />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Outline width" suffix="mm" value={el.strokeWidth} step={0.1} onCommit={(v) => onChange({ strokeWidth: Math.max(0, Math.min(50, v)) })} />
              {el.type === "rect" && <NumberField label="Corner radius" suffix="mm" value={el.radius || 0} step={0.5} onCommit={(v) => onChange({ radius: Math.max(0, v) })} />}
            </div>
          </>
        )}
        {el.type === "image" && (
          <Field label="Image fit">
            {(id) => (
              <Select id={id} value={el.fit} onChange={(e) => onChange({ fit: e.target.value as ImageElement["fit"] })}>
                <option value="contain">Fit inside box</option>
                <option value="cover">Fill box (crop)</option>
              </Select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2 border-t-[1.5px] border-ink/15 pt-3">
          <NumberField label="X" suffix="mm" value={el.x} onCommit={(v) => onChange({ x: v }, { geometry: true })} />
          <NumberField label="Y" suffix="mm" value={el.y} onCommit={(v) => onChange({ y: v }, { geometry: true })} />
          <NumberField label="Width" suffix="mm" value={el.w} onCommit={(v) => onChange({ w: Math.max(1, v) }, { geometry: true })} />
          <NumberField label="Height" suffix="mm" value={el.h} onCommit={(v) => onChange({ h: Math.max(1, v) }, { geometry: true })} />
          <NumberField label="Rotation" suffix="°" value={el.rotation} step={1} onCommit={(v) => onChange({ rotation: ((((v + 180) % 360) + 360) % 360) - 180 }, { geometry: true })} />
        </div>
        <p className="text-[12px] text-steel">Design size {Math.round(design.widthMm)} × {Math.round(design.heightMm)} mm.</p>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid size-7 place-items-center hover:bg-white/15">
      {children}
    </button>
  );
}

function DocumentPanel({ design, onBackground, onSelect }: { design: Design; onBackground: (c: string) => void; onSelect: (id: string) => void }) {
  return (
    <div className="border-[1.5px] border-ink bg-paper">
      <header className="bg-ink px-3 py-2">
        <span className="label-caps text-signal">Design</span>
      </header>
      <div className="space-y-4 p-3">
        <ColorField label="Background (fills the bleed)" value={design.background} onChange={(c) => c && onBackground(c)} />
        <div className="space-y-1.5">
          <span className="label-caps text-steel">Layers (top first)</span>
          {design.elements.length === 0 ? (
            <p className="text-sm text-steel">Empty. Add text, a shape or a logo from the toolbar.</p>
          ) : (
            <ul className="divide-y divide-ink/10 border-[1.5px] border-ink bg-white">
              {[...design.elements].reverse().map((el) => (
                <li key={el.id}>
                  <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-signal/40" onClick={() => onSelect(el.id)}>
                    {el.type === "text" ? <Type className="size-4 shrink-0" /> : el.type === "image" ? <ImagePlus className="size-4 shrink-0" /> : el.type === "rect" ? <Square className="size-4 shrink-0" /> : <Circle className="size-4 shrink-0" />}
                    <span className="truncate">{el.name || (el.type === "text" ? el.text || "Text" : el.type)}</span>
                    {el.type === "text" && el.bindColumn && <span className="ml-auto shrink-0 bg-ink px-1.5 text-[11px] font-bold text-signal">{el.bindColumn}</span>}
                    {el.locked && <Lock className="ml-auto size-3.5 shrink-0 text-steel" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CsvPanel({ csv, onChange, rowIndex, setRowIndex, hasBinding }: { csv: CsvInfo | null; onChange: (c: CsvInfo | null) => void; rowIndex: number; setRowIndex: (i: number) => void; hasBinding: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const r = await upload("csv", f);
      onChange({ assetId: r.id, name: r.originalName, columns: r.csv.columns, rowCount: r.csv.rowCount, rows: r.csv.rows });
      setRowIndex(0);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const i = Math.min(rowIndex, (csv?.rows.length || 1) - 1);
  return (
    <div className="border-[1.5px] border-ink bg-paper">
      <header className="flex items-center gap-2 bg-ink px-3 py-2">
        <FileSpreadsheet className="size-4 text-signal" aria-hidden />
        <span className="label-caps text-signal">Variable data (CSV)</span>
      </header>
      <div className="space-y-3 p-3 text-sm">
        {!csv ? (
          <>
            <p className="text-steel">Upload a CSV with a header row (e.g. <code className="bg-white px-1">number,name</code>). Every row becomes its own printed item.</p>
            <Button size="sm" onClick={() => input.current?.click()} busy={busy}>
              Upload CSV
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">{csv.name}</p>
                <p className="text-steel">
                  {csv.rowCount} rows · columns: {csv.columns.join(", ")}
                </p>
              </div>
              <button className="text-[12px] font-bold underline" onClick={() => onChange(null)}>
                Remove
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 border-[1.5px] border-ink bg-white px-2 py-1.5">
              <button aria-label="Previous row" className="grid size-7 place-items-center hover:bg-signal disabled:opacity-30" disabled={i <= 0} onClick={() => setRowIndex(i - 1)}>
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-[13px]">
                Previewing row <b>{i + 1}</b> of {csv.rows.length}
                {csv.rows.length < csv.rowCount ? ` (first ${csv.rows.length})` : ""}
              </span>
              <button aria-label="Next row" className="grid size-7 place-items-center hover:bg-signal disabled:opacity-30" disabled={i >= csv.rows.length - 1} onClick={() => setRowIndex(i + 1)}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            {!hasBinding && <Alert tone="warning">Select a text box and choose a column under “Variable data”.</Alert>}
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} busy={busy}>
              Replace CSV
            </Button>
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
