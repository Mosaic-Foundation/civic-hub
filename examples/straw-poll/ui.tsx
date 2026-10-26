// The straw poll's UI module: one page, its own React component, using the
// React the hub runs. It reads the poll and answers through the hub's own
// routes for every process (GET /process/:id/state, POST /process/:id/action).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { ProcessUi } from "@civic-social/plugin-sdk/ui";

interface Poll {
  title: string;
  question: string;
  options: string[];
  status: string;
  closes_at: string;
  has_answered: boolean;
  result: Record<string, number> | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("civic_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function StrawPollPage() {
  const { id } = useParams();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/process/${id}/state`, { headers: authHeaders() })
      .then((r) => r.json())
      .then(setPoll, () => setMessage("The poll could not be loaded."));
  useEffect(() => {
    void load();
  }, [id]);

  async function answer(choice: string) {
    const r = await fetch(`/api/process/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ type: "answer", payload: { choice } }),
    });
    const body = await r.json();
    setMessage(r.ok ? "Thank you, your answer is in." : (body.error ?? "Your answer could not be recorded."));
    void load();
  }

  if (!poll) return <p>{message ?? "Loading…"}</p>;
  return (
    <main>
      <h1>{poll.title}</h1>
      <p>{poll.question}</p>
      {poll.status === "active" && !poll.has_answered && (
        <ul>
          {poll.options.map((o) => (
            <li key={o}>
              <button type="button" onClick={() => answer(o)}>
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
      {poll.result && (
        <ul>
          {poll.options.map((o) => (
            <li key={o}>
              {o}: {poll.result![o] ?? 0}
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}

const strawPollUi: ProcessUi = {
  type: "example.straw_poll",
  routes: [{ path: "/straw-poll/:id", element: <StrawPollPage /> }],
};

export default strawPollUi;
