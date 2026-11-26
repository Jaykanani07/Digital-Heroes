"use client";

import { useEffect, useState } from "react";
import { apiBlob } from "./api";

/** Caches object URLs for uploaded assets (logos / artwork) by asset id. */
const cache = new Map<string, Promise<string>>();

export function assetUrl(assetId: string): Promise<string> {
  let p = cache.get(assetId);
  if (!p) {
    p = apiBlob(`/assets/${assetId}/file`).then(({ blob }) => URL.createObjectURL(blob));
    p.catch(() => cache.delete(assetId));
    cache.set(assetId, p);
  }
  return p;
}

export function useAssetUrl(assetId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    setFailed(false);
    assetUrl(assetId)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return { url, failed };
}

/** Natural pixel size of an uploaded image (for keeping logos undistorted). */
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}
