import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  getDeliberation,
  type DeliberationReadModel,
} from "../services/api";
import DeliberationPanel from "../components/deliberation/DeliberationPanel";
import CompletedDeliberation from "../components/deliberation/CompletedDeliberation";
import ShareButton from "../components/ShareButton";
import RelatedProcesses from "../components/RelatedProcesses";
import "./DeliberationDetail.css";

export default function DeliberationDetail() {
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<DeliberationReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await getDeliberation(id);
      setProcess(detail);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="section">Loading...</div>;
  if (error) return <div className="section error">Error: {error}</div>;
  if (!process) return <div className="section">Conversation not found</div>;

  const isActive = process.lifecycle === "active";
  const isCompleted = process.lifecycle === "closed" || process.lifecycle === "finalized";

  return (
    <div className="page deliberation-detail-page">
      <div className="process-share-row">
        <ShareButton
          title={process.topic}
          shareText={`Join the conversation: ${process.topic}`}
        />
      </div>

      {isActive && <DeliberationPanel processId={process.process_id} />}
      {isCompleted && <CompletedDeliberation process={process} />}

      {!isActive && !isCompleted && (
        <div className="deliberation-detail-draft">
          <h2>{process.topic}</h2>
          <p className="deliberation-framing">{process.framing}</p>
          <p className="deliberation-detail-status">
            This conversation hasn't started yet.
          </p>
        </div>
      )}

      <RelatedProcesses
        processId={process.process_id}
        title={process.topic}
        description={process.framing}
      />
    </div>
  );
}
