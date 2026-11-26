"use client";

import { memo, useEffect, useId, useState } from "react";
import {
  LINE_HEIGHT,
  PT_TO_MM,
  FONTS,
  fitText,
  printArea,
  type Design,
  type DesignElement,
  type PrintSpec,
  type TextElement,
} from "@/shared/design";
import { fontMetrics, loadDesignerFonts, measureMm } from "@/lib/measure";
import { useAssetUrl } from "@/lib/assets";

/** Re-render once web fonts have loaded so measurements are correct. */
export function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadDesignerFonts().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

const n = (v: number) => Math.round(v * 1000) / 1000;

function TextView({ el, row }: { el: TextElement; row?: Record<string, string> | null }) {
  const fit = fitText(el, measureMm, row);
  const sizeMm = fit.fontSize * PT_TO_MM;
  const lineH = sizeMm * LINE_HEIGHT;
  const top = (el.h - fit.lines.length * lineH) / 2;
  const m = fontMetrics(el.font);
  const glyphH = (m.ascent + m.descent) * sizeMm;
  const f = FONTS[el.font];
  return (
    <g>
      {fit.lines.map((line, i) => {
        const w = measureMm(el.font, line, fit.fontSize, fit.tracking);
        const x = el.align === "center" ? (el.w - w) / 2 : el.align === "right" ? el.w - w : 0;
        const y = top + i * lineH + (lineH - glyphH) / 2 + m.ascent * sizeMm;
        return (
          <text
            key={i}
            x={n(x)}
            y={n(y)}
            fontFamily={`"${f.family}"`}
            fontWeight={f.weight}
            fontSize={n(sizeMm)}
            letterSpacing={n((fit.tracking / 1000) * sizeMm)}
            fill={el.color}
            style={{ whiteSpace: "pre", fontKerning: "normal" }}
          >
            {line}
          </text>
        );
      })}
      {fit.overflow && <rect width={el.w} height={el.h} fill="none" stroke="#B3261E" strokeWidth={0.6} strokeDasharray="1.5 1" />}
    </g>
  );
}

function ImageView({ el }: { el: Extract<DesignElement, { type: "image" }> }) {
  const { url, failed } = useAssetUrl(el.assetId);
  if (!url) {
    return (
      <g>
        <rect width={el.w} height={el.h} fill="#EEEEEE" stroke="#8A8D85" strokeWidth={0.3} strokeDasharray="1 1" />
        {failed && (
          <text x={el.w / 2} y={el.h / 2} fontSize={Math.min(el.w, el.h) / 6} textAnchor="middle" fill="#8A8D85">
            missing
          </text>
        )}
      </g>
    );
  }
  return (
    <image
      href={url}
      width={n(el.w)}
      height={n(el.h)}
      preserveAspectRatio={el.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
    />
  );
}

export const ElementView = memo(function ElementView({ el, row }: { el: DesignElement; row?: Record<string, string> | null }) {
  const t = `translate(${n(el.x + el.w / 2)} ${n(el.y + el.h / 2)}) rotate(${n(el.rotation)}) translate(${n(-el.w / 2)} ${n(-el.h / 2)})`;
  let inner: React.ReactNode = null;
  if (el.type === "text") inner = <TextView el={el} row={row} />;
  else if (el.type === "image") inner = <ImageView el={el} />;
  else {
    const sw = el.stroke ? el.strokeWidth : 0;
    inner =
      el.type === "rect" ? (
        <rect x={sw / 2} y={sw / 2} width={Math.max(0, el.w - sw)} height={Math.max(0, el.h - sw)} rx={el.radius || 0} fill={el.fill || "none"} stroke={el.stroke || "none"} strokeWidth={sw} />
      ) : (
        <ellipse cx={el.w / 2} cy={el.h / 2} rx={Math.max(0, el.w / 2 - sw / 2)} ry={Math.max(0, el.h / 2 - sw / 2)} fill={el.fill || "none"} stroke={el.stroke || "none"} strokeWidth={sw} />
      );
  }
  return <g transform={t}>{inner}</g>;
});

/** Static rendering of a design (thumbnails, template pickers). */
export function DesignSvg({
  design,
  spec,
  row,
  guides = false,
  bleed = false,
  className,
  title,
}: {
  design: Design;
  spec: PrintSpec;
  row?: Record<string, string> | null;
  guides?: boolean;
  bleed?: boolean;
  className?: string;
  title?: string;
}) {
  useFontsReady();
  const clipId = `trim-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const b = bleed ? spec.bleedMm : 0;
  const area = printArea(design, spec);
  return (
    <svg viewBox={`${-b} ${-b} ${design.widthMm + 2 * b} ${design.heightMm + 2 * b}`} className={className} role="img" aria-label={title || "Design preview"}>
      <defs>
        <clipPath id={clipId}>
          <rect x={-b} y={-b} width={design.widthMm + 2 * b} height={design.heightMm + 2 * b} rx={bleed ? 0 : spec.cornerRadiusMm || 0} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x={-b} y={-b} width={design.widthMm + 2 * b} height={design.heightMm + 2 * b} fill={design.background} />
        {design.elements.map((el) => (
          <ElementView key={el.id} el={el} row={row} />
        ))}
      </g>
      {guides && (
        <>
          <rect x={0} y={0} width={design.widthMm} height={design.heightMm} fill="none" stroke="#E4007C" strokeWidth={Math.max(0.2, design.widthMm / 400)} />
          <rect x={area.x} y={area.y} width={area.w} height={area.h} fill="none" stroke="#00A0E3" strokeWidth={Math.max(0.2, design.widthMm / 400)} strokeDasharray="2 1.5" />
        </>
      )}
    </svg>
  );
}
