import { z } from "zod";
import { FONT_KEYS, type Design } from "../shared/design.js";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be hex like #141414");
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

const base = {
  id: z.string().min(1).max(40),
  x: num(-5000, 5000),
  y: num(-5000, 5000),
  w: num(0.1, 5000),
  h: num(0.1, 5000),
  rotation: num(-360, 360),
  name: z.string().max(60).optional(),
  locked: z.boolean().optional(),
};

const textEl = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(500),
  font: z.enum(FONT_KEYS as [string, ...string[]]),
  fontSize: num(2, 1000),
  minFontSize: num(2, 1000),
  tracking: num(-200, 1000),
  minTracking: num(-200, 1000),
  fit: z.enum(["shrink", "none"]),
  color: hex,
  align: z.enum(["left", "center", "right"]),
  bindColumn: z.string().max(60).nullable().optional(),
});

const imageEl = z.object({
  ...base,
  type: z.literal("image"),
  assetId: z.string().uuid(),
  fit: z.enum(["contain", "cover"]),
  isArtwork: z.boolean().optional(),
});

const shapeEl = z.object({
  ...base,
  type: z.enum(["rect", "ellipse"]),
  fill: hex.nullable(),
  stroke: hex.nullable(),
  strokeWidth: num(0, 50),
  radius: num(0, 1000).optional(),
});

export const designSchema = z.object({
  version: z.literal(1),
  widthMm: num(5, 5000),
  heightMm: num(5, 5000),
  background: hex,
  elements: z.array(z.discriminatedUnion("type", [textEl, imageEl, shapeEl.extend({ type: z.literal("rect") }), shapeEl.extend({ type: z.literal("ellipse") })])).max(60),
}) as unknown as z.ZodType<Design>;

export const configSchema = z.object({
  widthMm: num(1, 5000),
  heightMm: num(1, 5000),
  material: z.string().min(1).max(60),
  orientation: z.enum(["portrait", "landscape"]),
  quantity: z.number().int().min(1).max(1_000_000),
  sizeLabel: z.string().max(60).nullable().optional(),
});

export const uuid = z.string().uuid("Invalid id");
