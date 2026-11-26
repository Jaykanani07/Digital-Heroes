import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isProd } from "../config/env.js";

/**
 * File storage. Production: a PRIVATE Supabase Storage bucket — files are
 * never public; the API streams them only to users allowed to see them.
 * Local development without Supabase keys: ./storage on disk.
 */
const LOCAL_ROOT = path.resolve(process.cwd(), "storage");

let supabase: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else if (isProd) {
  console.warn("[storage] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — using local disk (not persistent on serverless).");
}

export const storageDriver = supabase ? "supabase" : "local";

async function ensureBucket() {
  if (!supabase) return;
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await supabase!.storage.getBucket(env.STORAGE_BUCKET);
      if (!data) {
        const { error } = await supabase!.storage.createBucket(env.STORAGE_BUCKET, { public: false });
        if (error && !/already exists/i.test(error.message)) throw error;
      }
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

function safe(p: string) {
  const clean = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.split("/").some((seg) => seg === ".." || seg === "")) throw new Error(`Invalid storage path: ${p}`);
  return clean;
}

export async function putFile(p: string, data: Buffer, contentType: string): Promise<string> {
  const key = safe(p);
  if (supabase) {
    await ensureBucket();
    const { error } = await supabase.storage.from(env.STORAGE_BUCKET).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  } else {
    const full = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  return key;
}

export async function getFile(p: string): Promise<Buffer> {
  const key = safe(p);
  if (supabase) {
    await ensureBucket();
    const { data, error } = await supabase.storage.from(env.STORAGE_BUCKET).download(key);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message || "missing"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return fs.readFile(path.join(LOCAL_ROOT, key));
}

export async function removeFiles(paths: string[]): Promise<void> {
  const keys = paths.filter(Boolean).map(safe);
  if (!keys.length) return;
  if (supabase) {
    await supabase.storage.from(env.STORAGE_BUCKET).remove(keys);
  } else {
    await Promise.all(keys.map((k) => fs.rm(path.join(LOCAL_ROOT, k), { force: true })));
  }
}
