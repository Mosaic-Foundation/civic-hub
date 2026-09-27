// The "Sample" badge (Phase 7): on every card, page header and feed item of a
// process seeded as sample content, so no one mistakes illustrative content
// for a real community decision. The demo banner says what it means.

import "./SampleBadge.css";

export default function SampleBadge() {
  return (
    <span className="sample-badge" title="Sample content: illustrative, not public record">
      Sample
    </span>
  );
}
