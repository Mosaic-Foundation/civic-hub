// IssueContent — renders structured content sections for a civic process.
//
// Displays: core question, content sections, key tradeoff, learn more links,
// and "what happens after this vote" block.
// Only renders when process has `content` field — otherwise the page
// falls back to the plain description.

import React from "react";
import type { ProcessContent } from "../services/api";
import { normalizeSourceLink } from "./SourceLinks";

interface Props {
  content: ProcessContent;
}

function renderBody(body: string | string[]): React.ReactElement {
  if (typeof body === "string") {
    return <p className="issue-body-text">{body}</p>;
  }

  // First item is an intro sentence if it doesn't start with a capital
  // followed by bullet items. Render as intro paragraph + bullet list.
  const items = body;
  const intro: string[] = [];
  const bullets: string[] = [];

  for (const item of items) {
    // Items that end with ":" are intro lines, or if no bullets found yet
    // and the item is a full sentence (ends with period or colon), treat as intro
    if (bullets.length === 0 && (item.endsWith(":") || item.endsWith("."))) {
      intro.push(item);
    } else {
      bullets.push(item);
    }
  }

  return (
    <>
      {intro.map((line, i) => (
        <p key={i} className="issue-body-text">{line}</p>
      ))}
      {bullets.length > 0 && (
        <ul className="issue-bullet-list">
          {bullets.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function IssueContent({ content }: Props) {
  return (
    <div className="issue-content">
      {/* Core question */}
      {content.core_question && (
        <div className="issue-core-question">
          <p>{content.core_question}</p>
        </div>
      )}

      {/* Content sections */}
      {content.sections?.map((section, i) => (
        <div key={i} className="issue-section">
          <h3>{section.title}</h3>
          {renderBody(section.body)}
        </div>
      ))}

      {/* Key tradeoff */}
      {content.key_tradeoff && (
        <div className="issue-tradeoff">
          <h3>Key tradeoff</h3>
          <p className="tradeoff-text">{content.key_tradeoff}</p>
        </div>
      )}

      {/* Learn more links */}
      {content.links && content.links.length > 0 && (
        <div className="issue-links">
          <h3>Learn more</h3>
          <ul className="issue-link-list">
            {content.links.map((link, i) => {
              // Votes stored {url: "Title: https://…", label: same}, so the
              // href was the whole line and resolved relative to the hub.
              const s = normalizeSourceLink(link);
              return (
                <li key={i}>
                  {s ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.label}
                    </a>
                  ) : (
                    link.label || link.url
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* What happens after this vote */}
      {content.after_vote && (
        <div className="issue-after-vote">
          <h3>What happens after this vote?</h3>
          {content.after_vote.recipients.length > 0 && (
            <p className="after-vote-recipients">
              Results from this vote will be shared with{" "}
              <strong>
                {content.after_vote.recipients.length === 1
                  ? content.after_vote.recipients[0]
                  : content.after_vote.recipients.slice(0, -1).join(", ") +
                    " and/or " +
                    content.after_vote.recipients[content.after_vote.recipients.length - 1]}
              </strong>.
            </p>
          )}
          <p className="after-vote-body">{content.after_vote.body}</p>
        </div>
      )}
    </div>
  );
}
