import crypto from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { one, query } from "../config/db.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { getFile, putFile } from "./storage.js";
import { parseCsv, type ParsedCsv } from "./csv.js";
import { rasterizePdf } from "./pdfraster.js";
import type { AuthUser } from "../middleware/auth.js";
import type { Design } from "../shared/design.js";
import type { ImageMap } from "./render.js";

export type AssetKind = "logo" | "artwork" | "csv" | "gallery";

export interface AssetRow {
  id: string;
  owner_id: string | null;
  kind: AssetKind;
  original_name: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  png_path: string | null;
  width_px: number | null;
  height_px: number | null;
  meta: Record<string, any>;
  created_at: string;
}

type Sniffed = "png" | "jpg" | "webp" | "pdf" | "svg" | "csv" | "unknown";

/** Detects the real file type from its bytes — never trust the extension alone. */
function sniff(buf: Buffer, name: string): Sniffed {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  // PDF and PDF-compatible Illustrator (.ai) files start with %PDF (allow a short preamble)
  if (buf.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "pdf";
  const head = buf.subarray(0, 4096).toString("utf8").toLowerCase();
  if (head.includes("<svg")) return "svg";
  if (/\.csv$/i.test(name) || /^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(head)) return "csv";
  return "unknown";
}

const ext = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
const clean = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "file";

async function toPng(buf: Buffer, type: Sniffed, maxPx: number) {
  const img = sharp(buf, { density: type === "svg" ? 300 : undefined, limitInputPixels: 120_000_000 }).rotate();
  const png = await img
    .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, width: meta.width || 0, height: meta.height || 0 };
}

export interface UploadResult {
  asset: AssetRow;
  csv?: ParsedCsv;
}

/**
 * Stores an upload. Logos → PNG for the renderer. Finished artwork (PDF,
 * SVG, AI, PNG, JPG) → validated, PDFs rasterised for previews while the
 * vector original is kept for print. CSV → parsed and summarised.
 */
export async function storeUpload(user: AuthUser | null, kind: AssetKind, file: { buffer: Buffer; originalname: string; size: number }): Promise<UploadResult> {
  const buf = file.buffer;
  if (!buf?.length) throw badRequest("The file is empty.");
  const type = sniff(buf, file.originalname);
  const id = crypto.randomUUID();
  const owner = user?.id ?? null;
  const dir = kind === "gallery" ? `gallery/${id}` : `uploads/${owner}/${id}`;
  const original = clean(file.originalname);
  const meta: Record<string, any> = {};
  let pngPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let mime = "application/octet-stream";

  if (kind === "csv") {
    if (type !== "csv") throw badRequest("Upload a .csv file with a header row.");
    const parsed = parseCsv(buf);
    meta.columns = parsed.columns;
    meta.rowCount = parsed.rows.length;
    meta.preview = parsed.rows.slice(0, 5);
    mime = "text/csv";
    await putFile(`${dir}/${original}`, buf, mime);
    const asset = await insert(id, owner, kind, file, mime, `${dir}/${original}`, null, null, null, meta);
    return { asset, csv: parsed };
  }

  if (kind === "logo" || kind === "gallery") {
    if (!["png", "jpg", "webp", "svg"].includes(type)) throw badRequest("Upload a PNG, JPG, WebP or SVG image.");
  } else if (kind === "artwork") {
    if (!["png", "jpg", "svg", "pdf"].includes(type)) {
      if (ext(file.originalname) === "ai") {
        throw badRequest("This .ai file isn't PDF-compatible. In Illustrator, re-save with 'Create PDF Compatible File' ticked, or export a PDF.");
      }
      throw badRequest("Upload finished artwork as PDF, SVG, AI, PNG or JPG.");
    }
  }

  mime = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" }[type as "png"] || mime;
  const storagePath = `${dir}/${original}`;
  await putFile(storagePath, buf, mime);

  try {
    if (type === "pdf") {
      let doc: PDFDocument;
      try {
        doc = await PDFDocument.load(buf, { updateMetadata: false });
      } catch {
        throw badRequest("That PDF/AI file couldn't be opened. Export it again as a standard PDF.");
      }
      const page = doc.getPage(0);
      const box = page.getMediaBox();
      meta.pdf = true;
      meta.pages = doc.getPageCount();
      meta.widthMm = Math.round((box.width * 25.4) / 72 * 10) / 10;
      meta.heightMm = Math.round((box.height * 25.4) / 72 * 10) / 10;
      const r = await rasterizePdf(buf, 3000);
      pngPath = `${dir}/preview.png`;
      await putFile(pngPath, r.png, "image/png");
      width = r.width;
      height = r.height;
    } else {
      const r = await toPng(buf, type, kind === "gallery" ? 1600 : kind === "logo" ? 3000 : 6000);
      pngPath = `${dir}/render.png`;
      await putFile(pngPath, r.png, "image/png");
      width = r.width;
      height = r.height;
    }
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw badRequest("That image couldn't be processed. Try exporting it again as PNG or PDF.");
  }

  const asset = await insert(id, owner, kind, file, mime, storagePath, pngPath, width, height, meta);
  return { asset };
}

async function insert(
  id: string,
  owner: string | null,
  kind: AssetKind,
  file: { originalname: string; size: number },
  mime: string,
  storagePath: string,
  pngPath: string | null,
  width: number | null,
  height: number | null,
  meta: Record<string, any>,
): Promise<AssetRow> {
  return (await one<AssetRow>(
    `insert into assets (id, owner_id, kind, original_name, mime, size_bytes, storage_path, png_path, width_px, height_px, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [id, owner, kind, file.originalname.slice(0, 200), mime, file.size, storagePath, pngPath, width, height, meta],
  ))!;
}

/** Loads an asset the user may use (own, or any when admin). */
export async function getAssetFor(user: AuthUser, id: string): Promise<AssetRow> {
  const a = await one<AssetRow>("select * from assets where id = $1", [id]);
  if (!a) throw notFound("File not found.");
  if (user.role !== "admin" && a.owner_id !== user.id) throw forbidden();
  return a;
}

/** Loads the parsed CSV rows of an asset. */
export async function loadCsvRows(assetId: string): Promise<ParsedCsv> {
  const a = await one<AssetRow>("select * from assets where id = $1 and kind = 'csv'", [assetId]);
  if (!a) throw notFound("CSV file not found.");
  return parseCsv(await getFile(a.storage_path));
}

/**
 * Collects the raster (and vector PDF) data for every image in a design.
 * `ownerId` restricts to that user's assets (null = no restriction, admin).
 */
export async function loadDesignImages(design: Design | null | undefined, ownerId: string | null): Promise<ImageMap> {
  const map: ImageMap = new Map();
  if (!design) return map;
  const ids = [...new Set(design.elements.filter((e) => e.type === "image").map((e) => (e as { assetId: string }).assetId))];
  if (!ids.length) return map;
  const rows = await query<AssetRow>("select * from assets where id = any($1::uuid[])", [ids]);
  for (const id of ids) {
    const a = rows.find((r) => r.id === id);
    if (!a || !a.png_path) throw badRequest("An image in this design is missing. Remove it and add it again.");
    if (ownerId && a.owner_id !== ownerId) throw forbidden("An image in this design belongs to another account.");
    const png = await getFile(a.png_path);
    map.set(id, {
      png,
      width: a.width_px || 1,
      height: a.height_px || 1,
      pdf: a.meta?.pdf ? await getFile(a.storage_path) : null,
    });
  }
  return map;
}
