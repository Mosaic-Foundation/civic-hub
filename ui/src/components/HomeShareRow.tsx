import { useState } from "react";
import SharePanel from "./SharePanel";
import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import { featureHomeBlocks } from "../features";
import "./HomeShareRow.css";

/**
 * The row under Home's tagline (members and invites slice, Adam's design
 * 2026-10-10): a feature's block (the Members plugin's count and faces;
 * ui/src/features.ts), then "Share this hub", which is the space's own and
 * there for every member whatever is switched on.
 */
export default function HomeShareRow() {
  const hub = useHub();
  const { user } = useAuth();
  const [sharing, setSharing] = useState(false);
  const joined = !!user?.is_resident;
  const blocks = featureHomeBlocks(hub.plugins.enabled);
  if (blocks.length === 0 && !joined) return null;

  return (
    <div className="member-stack-row">
      {blocks.map(({ feature, Block }) => (
        <Block key={feature} />
      ))}
      {joined && (
        <button type="button" className="member-share-btn" onClick={() => setSharing(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          Share this hub
        </button>
      )}
      {sharing && <SharePanel onClose={() => setSharing(false)} />}
    </div>
  );
}
