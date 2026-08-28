import { useNavigate } from "react-router-dom";
import DraftShell from "../components/DraftShell";
import HostDeliberationForm from "../components/deliberation/HostDeliberationForm";

/**
 * Conversation creation mounted in the shared DraftShell so every process
 * type gets the same pattern (form-first, CoC disclosure). The deliberation
 * handler declares no assistant config, so no assistant affordance renders
 * — a future config would light it up with no changes here. Creation is
 * admin-gated by the /deliberations page today; that's that page's concern.
 */
export default function ConversationDraft() {
  const navigate = useNavigate();

  return (
    <DraftShell
      backTo="/deliberations"
      backLabel="Conversations"
      title="Start a conversation"
      assistant={null}
      layout="page"
    >
      <HostDeliberationForm
        onCreated={() => navigate("/deliberations")}
        onCancel={() => navigate(-1)}
        onSubmittedForReview={(reviewId) => navigate(`/my-submissions/${reviewId}`, { state: { submitted: true } })}
      />
    </DraftShell>
  );
}
