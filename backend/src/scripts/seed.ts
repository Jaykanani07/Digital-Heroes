/**
 * npm run db:seed — loads the catalogue: 6 divisions, 10 parameter-driven
 * products, volume-discount tiers, design templates and a gallery of real
 * output rendered by the platform's own print engine.
 *
 * Idempotent: divisions/products are upserted by slug, seeded templates and
 * tiers are replaced, the gallery is only seeded when empty.
 */
import { pool, query, one } from "../config/db.js";
import { designToPng, measureMm } from "../services/render.js";
import { putFile } from "../services/storage.js";
import { validateDesign, type Design, type DesignElement, type FontKey, type ShapeElement, type TextElement } from "../shared/design.js";

// ------------------------------------------------------------ helpers
let idc = 0;
const nid = () => `e${++idc}`;

function txt(x: number, y: number, w: number, h: number, text: string, font: FontKey, fontSize: number, color: string, o: Partial<TextElement> = {}): TextElement {
  return {
    id: nid(), type: "text", x, y, w, h, rotation: 0, text, font, fontSize,
    minFontSize: Math.max(5, Math.round(fontSize * 0.3)), tracking: 0, minTracking: -60, fit: "shrink", color, align: "center", ...o,
  };
}
function rect(x: number, y: number, w: number, h: number, fill: string | null, o: Partial<ShapeElement> = {}): ShapeElement {
  return { id: nid(), type: "rect", x, y, w, h, rotation: 0, fill, stroke: null, strokeWidth: 0, radius: 0, ...o };
}
function ellipse(x: number, y: number, w: number, h: number, fill: string | null, o: Partial<ShapeElement> = {}): ShapeElement {
  return { id: nid(), type: "ellipse", x, y, w, h, rotation: 0, fill, stroke: null, strokeWidth: 0, ...o };
}
const design = (widthMm: number, heightMm: number, background: string, elements: DesignElement[]): Design => ({ version: 1, widthMm, heightMm, background, elements });

// ---------------------------------------------------------- catalogue
const divisions = [
  { slug: "labels-stickers", name: "Labels & Stickers", tagline: "Die-cut, kiss-cut, roll and sheet.", description: "Custom vinyl stickers and product labels in any size — with batch-numbered variable data for food, drink and retail." },
  { slug: "race-event-numbers", name: "Race & Event Numbers", tagline: "Numbered, named, start-line ready.", description: "Tear-proof race bibs and event passes, merged from your entry list CSV — one unique artwork per runner." },
  { slug: "mtb-boards", name: "MTB Boards", tagline: "Plates that survive the descent.", description: "Rigid, weatherproof mountain-bike number boards with rider names and numbers from your start list." },
  { slug: "stamps", name: "Stamps", tagline: "Crisp impressions, every time.", description: "Self-inking office and approval stamps made to your exact text, in standard and premium metal bodies." },
  { slug: "trophies", name: "Trophies", tagline: "Engraved for the moment.", description: "Award and trophy plaques in brass, silver and black-gold — personalised for every winner from one list." },
  { slug: "laser-cut", name: "Laser-Cut Work", tagline: "Cut, etched and finished in-house.", description: "Laser-cut acrylic and wood signage, keyrings and display pieces, from one-offs to batch runs." },
];

interface SeedProduct {
  division: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  supports_csv: boolean;
  sizes: { label: string; w: number; h: number }[];
  size_limits: { allowCustom: boolean; minW: number; maxW: number; minH: number; maxH: number };
  materials: { key: string; label: string; multiplier: number; description?: string }[];
  orientations: ("portrait" | "landscape")[];
  quantity_limits: { min: number; max: number; step: number };
  pricing: { baseUnit: number; perCm2: number; minUnit: number; setupFee: number };
  print_spec: { bleedMm: number; safeMm: number; dpi: number; cornerRadiusMm: number };
  tiers?: { minQty: number; discountPct: number }[];
  templates: { name: string; description: string; design: Design; samples?: { title: string; row?: Record<string, string>; background?: string }[] }[];
}

const products: SeedProduct[] = [
  {
    division: "labels-stickers", slug: "custom-stickers", name: "Custom stickers",
    summary: "Any shape, any size from 20 mm — vinyl, clear or holographic.",
    description: "Weatherproof die-cut stickers printed at 300 dpi. Pick a preset or type your own size; price updates as you go.",
    supports_csv: false,
    sizes: [{ label: "50 × 50 mm", w: 50, h: 50 }, { label: "75 × 75 mm", w: 75, h: 75 }, { label: "100 × 100 mm", w: 100, h: 100 }, { label: "100 × 50 mm", w: 50, h: 100 }],
    size_limits: { allowCustom: true, minW: 20, maxW: 300, minH: 20, maxH: 300 },
    materials: [
      { key: "white-vinyl", label: "White vinyl", multiplier: 1, description: "Outdoor-rated, 3-year life" },
      { key: "clear-vinyl", label: "Clear vinyl", multiplier: 1.15, description: "Transparent background" },
      { key: "holographic", label: "Holographic", multiplier: 1.6, description: "Rainbow foil finish" },
      { key: "gloss-paper", label: "Gloss paper", multiplier: 0.8, description: "Indoor, budget friendly" },
    ],
    orientations: ["portrait", "landscape"],
    quantity_limits: { min: 10, max: 10000, step: 1 },
    pricing: { baseUnit: 0.12, perCm2: 0.006, minUnit: 0.1, setupFee: 0 },
    print_spec: { bleedMm: 2, safeMm: 3, dpi: 300, cornerRadiusMm: 0 },
    templates: [
      {
        name: "Round badge", description: "Circular brand badge.",
        design: design(50, 50, "#FFFFFF", [ellipse(3, 3, 44, 44, "#141414"), txt(8, 15, 34, 9, "YOUR BRAND", "schibsted-700", 13, "#FFFFFF"), txt(12, 26, 26, 6, "EST. 2026", "darker-900", 11, "#F2C230", { tracking: 80 })]),
        samples: [{ title: "Coffee roaster badge stickers", row: undefined }],
      },
      {
        name: "Bold word", description: "One big word on a colour.",
        design: design(50, 50, "#F2C230", [txt(4, 12, 42, 24, "HELLO", "darker-900", 72, "#141414"), txt(6, 37, 38, 6, "digitalheroes.co.in", "inter-400", 7, "#141414")]),
        samples: [{ title: "Bold word stickers, safety yellow" }],
      },
    ],
  },
  {
    division: "labels-stickers", slug: "product-labels", name: "Product & batch labels",
    summary: "Labels with batch numbers and dates merged from a CSV.",
    description: "Food-safe paper and waterproof film labels. Upload a CSV and every label gets its own batch number and best-before date.",
    supports_csv: true,
    sizes: [{ label: "90 × 50 mm", w: 50, h: 90 }, { label: "100 × 70 mm", w: 70, h: 100 }, { label: "60 × 40 mm", w: 40, h: 60 }],
    size_limits: { allowCustom: true, minW: 30, maxW: 200, minH: 20, maxH: 200 },
    materials: [
      { key: "matte-paper", label: "Matte paper", multiplier: 1 },
      { key: "waterproof-film", label: "Waterproof film", multiplier: 1.3 },
      { key: "kraft", label: "Kraft paper", multiplier: 1.1 },
    ],
    orientations: ["landscape", "portrait"],
    quantity_limits: { min: 50, max: 20000, step: 1 },
    pricing: { baseUnit: 0.08, perCm2: 0.004, minUnit: 0.06, setupFee: 0 },
    print_spec: { bleedMm: 2, safeMm: 3, dpi: 300, cornerRadiusMm: 2 },
    templates: [
      {
        name: "Batch label", description: "Product name with CSV batch and date.",
        design: design(90, 50, "#FFFFFF", [
          rect(3, 3, 84, 12, "#141414"),
          txt(6, 4, 78, 10, "SMALL BATCH HOT SAUCE", "schibsted-700", 14, "#F2C230", { tracking: 30 }),
          txt(6, 18, 78, 12, "Ghost Pepper No. 7", "robotoslab-700", 18, "#141414"),
          txt(6, 32, 38, 6, "Batch A-001", "inter-700", 9, "#141414", { align: "left", bindColumn: "batch" }),
          txt(46, 32, 38, 6, "Best before 12/2027", "inter-400", 9, "#141414", { align: "right", bindColumn: "best_before" }),
          txt(6, 40, 78, 5, "250 ml · Made in Leeds", "inter-400", 7, "#5C5F58"),
        ]),
        samples: [{ title: "Hot sauce batch labels", row: { batch: "Batch A-017", best_before: "Best before 03/2027" } }],
      },
    ],
  },
  {
    division: "race-event-numbers", slug: "race-bibs", name: "Race bibs",
    summary: "Tear-proof Tyvek bibs, numbered from your entry list.",
    description: "Upload your entries CSV and every runner gets their own number and name. Tyvek won't tear in the rain.",
    supports_csv: true,
    sizes: [{ label: "A5 (210 × 148 mm)", w: 148, h: 210 }, { label: "A6 (148 × 105 mm)", w: 105, h: 148 }, { label: "Large (240 × 180 mm)", w: 180, h: 240 }],
    size_limits: { allowCustom: true, minW: 100, maxW: 300, minH: 80, maxH: 300 },
    materials: [
      { key: "tyvek", label: "Tyvek", multiplier: 1, description: "Tear-proof, waterproof" },
      { key: "waterproof-paper", label: "Waterproof paper", multiplier: 0.85 },
      { key: "recycled-paper", label: "Recycled paper", multiplier: 0.7, description: "For indoor events" },
    ],
    orientations: ["landscape", "portrait"],
    quantity_limits: { min: 10, max: 20000, step: 1 },
    pricing: { baseUnit: 0.25, perCm2: 0.0025, minUnit: 0.3, setupFee: 0 },
    print_spec: { bleedMm: 3, safeMm: 5, dpi: 300, cornerRadiusMm: 0 },
    templates: [
      {
        name: "Classic bib", description: "Event band, big number, sponsor strip.",
        design: design(210, 148, "#FFFFFF", [
          rect(5, 5, 200, 26, "#141414", { radius: 2 }),
          txt(10, 8, 190, 20, "CITY 10K · 2026", "schibsted-700", 40, "#F2C230", { tracking: 40 }),
          txt(10, 36, 190, 82, "247", "darker-900", 300, "#141414", { bindColumn: "number", minFontSize: 60 }),
          rect(5, 122, 200, 21, "#F2C230"),
          txt(10, 125, 190, 15, "Powered by Digital Heroes", "schibsted-700", 22, "#141414"),
        ]),
        samples: [{ title: "City 10K race bibs", row: { number: "247" } }, { title: "City 10K race bibs — 4-digit numbers", row: { number: "1024" } }],
      },
      {
        name: "Name + number", description: "Number with the runner's name underneath.",
        design: design(210, 148, "#F2C230", [
          txt(10, 10, 190, 70, "101", "darker-900", 260, "#141414", { bindColumn: "number", minFontSize: 60 }),
          rect(5, 86, 200, 2, "#141414"),
          txt(10, 92, 190, 30, "ALEX MORGAN", "oswald-600", 54, "#141414", { bindColumn: "name", tracking: 20 }),
          txt(10, 126, 190, 12, "TRAIL HALF MARATHON", "schibsted-700", 16, "#141414", { tracking: 60 }),
        ]),
        samples: [{ title: "Trail half marathon named bibs", row: { number: "58", name: "PRIYA SHAH" } }],
      },
    ],
  },
  {
    division: "race-event-numbers", slug: "event-passes", name: "Event passes",
    summary: "Named crew and guest passes for lanyards.",
    description: "Card or PVC passes with names and roles merged from your guest list.",
    supports_csv: true,
    sizes: [{ label: "Card 86 × 54 mm", w: 54, h: 86 }, { label: "A6 (148 × 105 mm)", w: 105, h: 148 }],
    size_limits: { allowCustom: false, minW: 50, maxW: 150, minH: 50, maxH: 150 },
    materials: [
      { key: "card-350", label: "350 gsm card", multiplier: 1 },
      { key: "pvc", label: "PVC card", multiplier: 2.2, description: "Durable, credit-card feel" },
    ],
    orientations: ["landscape", "portrait"],
    quantity_limits: { min: 10, max: 10000, step: 1 },
    pricing: { baseUnit: 0.2, perCm2: 0.004, minUnit: 0.25, setupFee: 0 },
    print_spec: { bleedMm: 2, safeMm: 3, dpi: 300, cornerRadiusMm: 3 },
    templates: [
      {
        name: "Crew pass", description: "Name, role and access level.",
        design: design(86, 54, "#141414", [
          txt(5, 5, 76, 8, "FESTIVAL 2026", "schibsted-700", 12, "#F2C230", { align: "left", tracking: 60 }),
          txt(5, 17, 76, 16, "Jordan Lee", "schibsted-700", 26, "#FFFFFF", { align: "left", bindColumn: "name" }),
          rect(5, 38, 30, 10, "#F2C230", { radius: 1 }),
          txt(6, 39, 28, 8, "CREW", "darker-900", 16, "#141414", { bindColumn: "role" }),
          txt(40, 40, 41, 6, "Access: all areas", "inter-400", 8, "#D7D8D3", { align: "right" }),
        ]),
        samples: [{ title: "Festival crew passes", row: { name: "Sam Okafor", role: "STAGE" } }],
      },
    ],
  },
  {
    division: "mtb-boards", slug: "mtb-number-boards", name: "MTB number boards",
    summary: "Rigid, weatherproof plates with rider names and numbers.",
    description: "Polypropylene or PVC handlebar boards with zip-tie safe zones. Merge your start list for unique boards.",
    supports_csv: true,
    sizes: [{ label: "Standard 200 × 160 mm", w: 160, h: 200 }, { label: "XC 180 × 140 mm", w: 140, h: 180 }, { label: "Downhill 250 × 200 mm", w: 200, h: 250 }],
    size_limits: { allowCustom: true, minW: 120, maxW: 300, minH: 100, maxH: 300 },
    materials: [
      { key: "pp-08", label: "Polypropylene 0.8 mm", multiplier: 1, description: "Flexible, shatter-proof" },
      { key: "pvc-15", label: "Rigid PVC 1.5 mm", multiplier: 1.3 },
      { key: "correx-3", label: "Correx 3 mm", multiplier: 1.1 },
    ],
    orientations: ["landscape"],
    quantity_limits: { min: 5, max: 5000, step: 1 },
    pricing: { baseUnit: 1.5, perCm2: 0.006, minUnit: 2, setupFee: 0 },
    print_spec: { bleedMm: 2, safeMm: 8, dpi: 300, cornerRadiusMm: 10 },
    tiers: [{ minQty: 20, discountPct: 5 }, { minQty: 50, discountPct: 10 }, { minQty: 100, discountPct: 15 }, { minQty: 250, discountPct: 20 }],
    templates: [
      {
        name: "Race plate", description: "Series band, big number, rider name.",
        design: design(200, 160, "#F4F4F1", [
          rect(8, 8, 184, 24, "#141414", { radius: 3 }),
          txt(12, 10, 176, 20, "ENDURO SERIES 2026", "schibsted-700", 30, "#F2C230", { tracking: 30 }),
          txt(12, 36, 176, 90, "12", "darker-900", 320, "#141414", { bindColumn: "number", minFontSize: 60 }),
          txt(12, 130, 176, 18, "SAM RIDER", "oswald-600", 34, "#141414", { bindColumn: "name", tracking: 30 }),
        ]),
        samples: [{ title: "Enduro series number boards", row: { number: "7", name: "LEE CHEN" } }, { title: "Enduro boards — downhill class", row: { number: "312", name: "RUBY HALL" }, background: "#F2C230" }],
      },
    ],
  },
  {
    division: "stamps", slug: "self-inking-stamps", name: "Self-inking stamps",
    summary: "Office, address and approval stamps made to your text.",
    description: "Laser-engraved rubber in self-inking bodies. Choose a standard plastic or premium metal body.",
    supports_csv: false,
    sizes: [{ label: "Small 38 × 14 mm", w: 14, h: 38 }, { label: "Medium 47 × 18 mm", w: 18, h: 47 }, { label: "Large 58 × 22 mm", w: 22, h: 58 }, { label: "Square 40 × 40 mm", w: 40, h: 40 }],
    size_limits: { allowCustom: false, minW: 10, maxW: 80, minH: 10, maxH: 80 },
    materials: [
      { key: "standard", label: "Standard body", multiplier: 1 },
      { key: "premium-metal", label: "Premium metal body", multiplier: 1.8 },
    ],
    orientations: ["landscape"],
    quantity_limits: { min: 1, max: 200, step: 1 },
    pricing: { baseUnit: 14, perCm2: 0.15, minUnit: 14, setupFee: 0 },
    print_spec: { bleedMm: 0, safeMm: 1, dpi: 600, cornerRadiusMm: 1 },
    tiers: [{ minQty: 5, discountPct: 5 }, { minQty: 10, discountPct: 10 }, { minQty: 25, discountPct: 15 }],
    templates: [
      {
        name: "Company address", description: "Name, address and GSTIN.",
        design: design(58, 22, "#FFFFFF", [
          txt(2, 2, 54, 7, "DIGITAL HEROES LTD", "schibsted-700", 12, "#141414"),
          txt(2, 10, 54, 5, "12 Print Street, Pune 411001", "inter-400", 8, "#141414"),
          txt(2, 16, 54, 4.5, "GSTIN 27ABCDE1234F1Z5", "inter-400", 7, "#141414"),
        ]),
        samples: [{ title: "Company address stamp" }],
      },
      {
        name: "Approved", description: "Bordered approval stamp with date line.",
        design: design(58, 22, "#FFFFFF", [
          rect(2, 2, 54, 18, null, { stroke: "#B3261E", strokeWidth: 0.8, radius: 1.5 }),
          txt(4, 3.5, 50, 9, "APPROVED", "darker-900", 26, "#B3261E", { tracking: 80 }),
          txt(4, 13, 50, 5.5, "Date: ____ / ____ / ______", "inter-400", 8, "#B3261E"),
        ]),
        samples: [{ title: "Approved stamp, red ink" }],
      },
    ],
  },
  {
    division: "trophies", slug: "engraved-plaques", name: "Award plaques",
    summary: "Engraved plaques for trophies, shields and boards.",
    description: "Brass, silver or black-gold plaques. Upload a winners list and every plaque is personalised.",
    supports_csv: true,
    sizes: [{ label: "60 × 25 mm", w: 25, h: 60 }, { label: "80 × 30 mm", w: 30, h: 80 }, { label: "100 × 40 mm", w: 40, h: 100 }, { label: "150 × 100 mm", w: 100, h: 150 }],
    size_limits: { allowCustom: false, minW: 20, maxW: 200, minH: 20, maxH: 200 },
    materials: [
      { key: "brushed-brass", label: "Brushed brass", multiplier: 1 },
      { key: "silver-aluminium", label: "Silver aluminium", multiplier: 0.9 },
      { key: "black-gold", label: "Black & gold", multiplier: 1.15 },
    ],
    orientations: ["landscape"],
    quantity_limits: { min: 1, max: 2000, step: 1 },
    pricing: { baseUnit: 4.5, perCm2: 0.05, minUnit: 4.5, setupFee: 0 },
    print_spec: { bleedMm: 0, safeMm: 3, dpi: 600, cornerRadiusMm: 1 },
    tiers: [{ minQty: 10, discountPct: 5 }, { minQty: 25, discountPct: 10 }, { minQty: 50, discountPct: 15 }],
    templates: [
      {
        name: "Award plaque", description: "Winner, award and season.",
        design: design(100, 40, "#C9A646", [
          rect(3, 3, 94, 34, null, { stroke: "#3B2F12", strokeWidth: 0.6, radius: 1 }),
          txt(6, 6, 88, 12, "Jamie Patel", "robotoslab-700", 26, "#2B2210", { bindColumn: "name" }),
          txt(6, 19, 88, 8, "Player of the Season", "schibsted-400", 13, "#2B2210"),
          txt(6, 28, 88, 6, "RIVERSIDE FC · 2026", "schibsted-700", 10, "#2B2210", { tracking: 60 }),
        ]),
        samples: [{ title: "Football club award plaques", row: { name: "Jamie Patel" } }, { title: "Black & gold plaque", row: { name: "Aisha Rahman" }, background: "#1D1A14" }],
      },
    ],
  },
  {
    division: "laser-cut", slug: "acrylic-signs", name: "Laser-cut signs",
    summary: "Acrylic, mirror and birch-ply signage cut to size.",
    description: "Office, shop and wayfinding signs laser-cut and UV-printed. Custom sizes up to 1 m.",
    supports_csv: false,
    sizes: [{ label: "300 × 200 mm", w: 200, h: 300 }, { label: "400 × 300 mm", w: 300, h: 400 }, { label: "600 × 400 mm", w: 400, h: 600 }],
    size_limits: { allowCustom: true, minW: 50, maxW: 1000, minH: 50, maxH: 1000 },
    materials: [
      { key: "clear-acrylic", label: "Clear acrylic 3 mm", multiplier: 1 },
      { key: "black-acrylic", label: "Black acrylic 3 mm", multiplier: 1.05 },
      { key: "birch-ply", label: "Birch ply 3 mm", multiplier: 0.8 },
      { key: "gold-mirror", label: "Gold mirror acrylic", multiplier: 1.6 },
    ],
    orientations: ["landscape", "portrait"],
    quantity_limits: { min: 1, max: 500, step: 1 },
    pricing: { baseUnit: 3, perCm2: 0.012, minUnit: 4, setupFee: 0 },
    print_spec: { bleedMm: 0, safeMm: 5, dpi: 300, cornerRadiusMm: 4 },
    tiers: [{ minQty: 5, discountPct: 5 }, { minQty: 10, discountPct: 10 }, { minQty: 25, discountPct: 15 }],
    templates: [
      {
        name: "Office sign", description: "Company name with a tagline.",
        design: design(300, 200, "#141414", [
          txt(15, 40, 270, 70, "Northside Studio", "schibsted-700", 110, "#F4F4F1"),
          rect(120, 118, 60, 3, "#F2C230"),
          txt(15, 130, 270, 25, "Design · Print · Make", "inter-400", 34, "#D7D8D3", { tracking: 40 }),
        ]),
        samples: [{ title: "Studio reception sign, black acrylic" }],
      },
    ],
  },
  {
    division: "laser-cut", slug: "keyrings", name: "Laser-cut keyrings",
    summary: "Personalised acrylic and oak keyrings, one name per row.",
    description: "Great for teams, events and merch. Upload names as a CSV for a personalised batch.",
    supports_csv: true,
    sizes: [{ label: "50 × 30 mm", w: 30, h: 50 }, { label: "60 × 40 mm", w: 40, h: 60 }, { label: "40 × 40 mm", w: 40, h: 40 }],
    size_limits: { allowCustom: false, minW: 20, maxW: 100, minH: 20, maxH: 100 },
    materials: [
      { key: "colour-acrylic", label: "Colour acrylic", multiplier: 1 },
      { key: "oak", label: "Oak veneer", multiplier: 1.2 },
    ],
    orientations: ["landscape"],
    quantity_limits: { min: 10, max: 5000, step: 1 },
    pricing: { baseUnit: 0.9, perCm2: 0.02, minUnit: 0.9, setupFee: 0 },
    print_spec: { bleedMm: 0, safeMm: 3, dpi: 300, cornerRadiusMm: 4 },
    templates: [
      {
        name: "Name keyring", description: "Script name with a hole marker.",
        design: design(50, 30, "#F2C230", [
          ellipse(4, 11, 8, 8, null, { stroke: "#141414", strokeWidth: 0.6 }),
          txt(14, 6, 32, 18, "Maya", "pacifico-400", 30, "#141414", { bindColumn: "name" }),
        ]),
        samples: [{ title: "Personalised name keyrings", row: { name: "Maya" } }, { title: "Team keyrings", row: { name: "Oliver" }, background: "#F4F4F1" }],
      },
    ],
  },
];

const globalTiers = [
  { minQty: 100, discountPct: 10 },
  { minQty: 250, discountPct: 15 },
  { minQty: 500, discountPct: 20 },
  { minQty: 1000, discountPct: 25 },
];

// ---------------------------------------------------------------- main
async function main() {
  console.log("Seeding divisions …");
  const divisionIds = new Map<string, string>();
  for (const [i, d] of divisions.entries()) {
    const row = await one<{ id: string }>(
      `insert into divisions (slug, name, tagline, description, sort_order) values ($1,$2,$3,$4,$5)
       on conflict (slug) do update set name = excluded.name, tagline = excluded.tagline, description = excluded.description, sort_order = excluded.sort_order
       returning id`,
      [d.slug, d.name, d.tagline, d.description, i + 1],
    );
    divisionIds.set(d.slug, row!.id);
  }

  console.log("Seeding global volume discounts …");
  await query("delete from discount_tiers where product_id is null");
  for (const t of globalTiers) await query("insert into discount_tiers (product_id, min_qty, discount_pct) values (null, $1, $2)", [t.minQty, t.discountPct]);

  console.log("Seeding products and templates …");
  const galleryEmpty = !(await one("select 1 from gallery_items limit 1"));
  let galleryCount = 0;
  for (const [i, p] of products.entries()) {
    const row = await one<{ id: string }>(
      `insert into products (division_id, slug, name, summary, description, supports_csv, sizes, size_limits, materials, orientations, quantity_limits, pricing, print_spec, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (slug) do update set division_id = excluded.division_id, name = excluded.name, summary = excluded.summary,
         description = excluded.description, supports_csv = excluded.supports_csv, sizes = excluded.sizes, size_limits = excluded.size_limits,
         materials = excluded.materials, orientations = excluded.orientations, quantity_limits = excluded.quantity_limits,
         pricing = excluded.pricing, print_spec = excluded.print_spec, sort_order = excluded.sort_order
       returning id`,
      [
        divisionIds.get(p.division), p.slug, p.name, p.summary, p.description, p.supports_csv, JSON.stringify(p.sizes), p.size_limits,
        JSON.stringify(p.materials), JSON.stringify(p.orientations), p.quantity_limits, p.pricing, p.print_spec, i + 1,
      ],
    );
    const productId = row!.id;

    await query("delete from discount_tiers where product_id = $1", [productId]);
    for (const t of p.tiers || []) await query("insert into discount_tiers (product_id, min_qty, discount_pct) values ($1,$2,$3)", [productId, t.minQty, t.discountPct]);

    await query("delete from templates where product_id = $1 and created_by is null", [productId]);
    for (const [ti, t] of p.templates.entries()) {
      const issues = validateDesign(t.design, p.print_spec, measureMm);
      if (issues.length) throw new Error(`Template "${t.name}" (${p.slug}) is invalid: ${issues.map((x) => x.message).join("; ")}`);
      await query("insert into templates (product_id, name, description, design, sort_order) values ($1,$2,$3,$4,$5)", [productId, t.name, t.description, t.design, ti]);

      if (galleryEmpty) {
        for (const s of t.samples || []) {
          const d = s.background ? { ...t.design, background: s.background, elements: t.design.elements.map((e) => (s.background === "#1D1A14" && e.type === "text" ? { ...e, color: "#D9B65A" } : e.type === "rect" && s.background === "#1D1A14" ? { ...e, stroke: "#D9B65A" } : e)) } : t.design;
          const png = await designToPng(d, p.print_spec, { images: new Map(), row: s.row ?? null, bleed: false, dpi: 200, maxPx: 1100 });
          const pth = await putFile(`gallery/seed/${p.slug}-${ti}-${galleryCount}.png`, png, "image/png");
          await query("insert into gallery_items (division_id, title, description, image_path, sort_order) values ($1,$2,$3,$4,$5)", [
            divisionIds.get(p.division), s.title, `${p.name} — ${t.name} template`, pth, galleryCount,
          ]);
          galleryCount++;
        }
      }
    }
  }
  console.log(galleryEmpty ? `Gallery: ${galleryCount} items rendered by the print engine.` : "Gallery already has items — left unchanged.");
  console.log(`Done: ${divisions.length} divisions, ${products.length} products.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
