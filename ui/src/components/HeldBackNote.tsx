// Who a published brief or result was NOT emailed to, and why (review #34).
// A hub in demo or beta mode holds mail to anyone off its admin roster and
// allow list, and sample content is never delivered. That is a decision, not
// a failure: the item published; this says so in plain words.

export interface HeldBackRecipient {
  email: string;
  reason: string;
}

export function HeldBackNote({ heldBack }: { heldBack: HeldBackRecipient[] | undefined }) {
  if (!heldBack || heldBack.length === 0) return null;
  const reasons = [...new Set(heldBack.map((h) => h.reason))];
  return (
    <section className="admin-detail-section" data-testid="held-back">
      <h3>Not emailed</h3>
      <p className="form-hint">
        Published, but not emailed to {heldBack.length === 1 ? "this recipient" : "these recipients"}{" "}
        because {reasons.join(" and ")}.
      </p>
      <ul>
        {heldBack.map((h) => (
          <li key={h.email}>{h.email}</li>
        ))}
      </ul>
    </section>
  );
}
