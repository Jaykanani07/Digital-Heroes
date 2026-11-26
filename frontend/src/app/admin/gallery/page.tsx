"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { API_URL, api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Alert, Badge, Button, ErrorState, Field, Input, PageHeader, PageLoader, Panel, Select, useToast } from "@/components/ui";

interface Item {
  id: string;
  title: string;
  description: string;
  is_published: boolean;
  division_id: string;
  division_name: string;
}

export default function AdminGallery() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Item[]>("/admin/gallery");
  const divisions = useApi<{ id: string; name: string }[]>("/admin/divisions");
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: "", description: "", divisionId: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const divisionId = form.divisionId || divisions.data?.[0]?.id;
    if (!file) return setErr("Choose an image.");
    if (form.title.trim().length < 2) return setErr("Add a title.");
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("divisionId", divisionId || "");
      fd.append("title", form.title.trim());
      fd.append("description", form.description.trim());
      fd.append("file", file);
      await api("/admin/gallery", { form: fd });
      setForm({ title: "", description: "", divisionId: form.divisionId });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast("Added to the gallery");
      reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (g: Item, body: object) => {
    try {
      await api(`/admin/gallery/${g.id}`, { method: "PATCH", body });
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async (g: Item) => {
    if (!window.confirm(`Remove “${g.title}” from the gallery?`)) return;
    try {
      await api(`/admin/gallery/${g.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Live work gallery" title="Gallery">Photos of real jobs, organised by product family. Unpublished items stay hidden from the site.</PageHeader>
      <Panel title="Add work">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <Field label="Title">{(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Club championship plaques" />}</Field>
          <Field label="Product family">
            {(id) => (
              <Select id={id} value={form.divisionId || divisions.data?.[0]?.id || ""} onChange={(e) => setForm({ ...form, divisionId: e.target.value })}>
                {divisions.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Image (PNG, JPG, WebP)">{(id) => <Input id={id} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="pt-1.5" onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
          <Button type="submit" variant="primary" busy={busy}><Upload className="size-4" aria-hidden /> Add</Button>
          <Field label="Description (optional)" className="md:col-span-3">{(id) => <Input id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
        </form>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      </Panel>
      {loading && <PageLoader />}
      {error && <ErrorState message={error} onRetry={reload} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data?.map((g) => (
          <article key={g.id} className="flex flex-col border-[1.5px] border-ink bg-paper">
            <div className="grid aspect-[4/3] place-items-center bg-concrete-dark p-3">
              {g.is_published ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_URL}/api/gallery/${g.id}/image`} alt={g.title} className="max-h-full max-w-full object-contain" loading="lazy" />
              ) : (
                <span className="text-sm text-steel">Hidden — publish to preview</span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 border-t-[1.5px] border-ink p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{g.title}</p>
                  <p className="text-[12px] text-steel">{g.division_name}</p>
                </div>
                <Badge status={g.is_published ? "active" : "inactive"}>{g.is_published ? "Live" : "Hidden"}</Badge>
              </div>
              <div className="mt-auto flex gap-1.5">
                <Button size="sm" onClick={() => patch(g, { isPublished: !g.is_published })}>{g.is_published ? "Hide" : "Publish"}</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${g.title}`} onClick={() => remove(g)}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
