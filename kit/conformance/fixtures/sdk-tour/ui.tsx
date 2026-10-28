// The SDK tour's UI module: its page and its draft form, drawn with the hub's
// UI kit (@civic-social/plugin-sdk/ui) and no CSS of its own.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, DraftShell, Field, TextInput, type ProcessUi } from "@civic-social/plugin-sdk/ui";

function authHeaders(): Record<string, string> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("civic_auth_token");
  } catch {
    token = null;
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : "Something went wrong. Try again.");
  return body as T;
}

interface Tour {
  title: string;
  description: string;
  status: string;
  place: string;
  joined_count: number;
  mark_count: number;
  has_joined: boolean;
  is_creator: boolean;
  type_status?: { id: string; label: string };
}

function TourPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tour, setTour] = useState<Tour | null>(null);
  const [joined, setJoined] = useState<{ count: number; names: string[] | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    api<Tour>(`/process/${id}/state`).then(setTour, (e: Error) => setMessage(e.message));
    api<{ count: number; names: string[] | null }>(`/sdk-tour/${id}/joined`).then(setJoined, () => setJoined(null));
  };
  useEffect(load, [id]);

  async function act(type: string, payload: Record<string, unknown> = {}) {
    setMessage(null);
    try {
      await api(`/process/${id}/action`, { method: "POST", body: { type, payload } });
    } catch (e) {
      setMessage((e as Error).message);
    }
    load();
  }

  // "Edit": the hub's edit path opens the form on a draft of the tour as published.
  async function edit() {
    try {
      const r = await api<{ draft_path: string }>(`/process/${id}/edit`, { method: "POST", body: {} });
      navigate(r.draft_path);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  if (!tour) return <main>{message ? <p role="alert">{message}</p> : <p>Loading…</p>}</main>;
  const open = tour.status === "active";
  return (
    <main>
      <p>{tour.type_status?.label ?? tour.status}</p>
      <h1>{tour.title}</h1>
      <p>{tour.description}</p>
      <p>Place: {tour.place}</p>
      <p>
        {joined?.count ?? tour.joined_count} joined
        {joined?.names ? `: ${joined.names.join(", ")}` : ""}. {tour.mark_count} marked.
      </p>
      {open && (
        <p>
          <Button variant="primary" disabled={tour.has_joined} onClick={() => void act("join")}>
            Join
          </Button>{" "}
          <Button onClick={() => void act("mark")}>Mark</Button> <Button onClick={() => void act("endorse", { note: "Endorsed." })}>Endorse</Button>{" "}
          <Button onClick={() => void edit()}>Edit</Button>
        </p>
      )}
      {message && <p role="alert">{message}</p>}
    </main>
  );
}

function TourFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get("edit");
  const pageTitle = editId ? "Edit tour" : "New tour";
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    const id = params.get("draft");
    if (!id) return;
    api<{ title: string; place: string | null }>(`/sdk-tour/drafts/${encodeURIComponent(id)}`).then(
      (d) => {
        setTitle(d.title);
        setPlace(d.place ?? "");
      },
      (e: Error) => setError(e.message),
    );
  }, [params]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = draftId ?? (await api<{ id: string }>("/sdk-tour/drafts", { method: "POST", body: {} })).id;
      setDraftId(id);
      await api(`/sdk-tour/drafts/${id}`, { method: "PATCH", body: { title, place } });
      const result = await api<{ process_id?: string; auto_approved?: boolean }>(`/sdk-tour/drafts/${id}/submit`, {
        method: "POST",
        body: editId ? { edit_process_id: editId } : {},
      });
      if (editId) navigate(`/sdk-tour/${editId}`);
      else if (result.auto_approved && result.process_id) navigate(`/sdk-tour/${result.process_id}`);
      else setQueued(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = (body: ReactNode) => (
    <DraftShell backTo={editId ? `/sdk-tour/${editId}` : "/"} backLabel="Back" title={pageTitle} phoneTitle={pageTitle} assistant={null} layout="page" error={error}>
      {body}
    </DraftShell>
  );

  if (queued) return shell(<p role="status">Thank you. Your tour is with the hub's admins.</p>);
  return shell(
    <form onSubmit={submit}>
      <Field label="Name" required htmlFor="st-title">
        <TextInput id="st-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Place" required htmlFor="st-place">
        <TextInput id="st-place" required maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        {editId ? "Save changes" : "Submit"}
      </Button>
    </form>,
  );
}

const sdkTourUi: ProcessUi = {
  type: "example.sdk_tour",
  routes: [
    { path: "/sdk-tour/new", element: <TourFormPage /> },
    { path: "/sdk-tour/:id", element: <TourPage /> },
  ],
};

export default sdkTourUi;
