// The conversation summary's prompt (moved here from the conversation package
// in plugin session 2: the brief owns the AI). The text is unchanged; it reads
// the deliberation result the conversation handed its brief.

import type { DeliberationResult } from "@civic-social/plugin-sdk/first-party";

export const PROMPT_VERSION = "polis-summarization-v1";

export const SYSTEM_PROMPT = `You are a civic deliberation summarizer. You receive structured data from a Polis conversation — opinion clusters, consensus statements, representative comments per group, and vote tallies — and produce a neutral, factual summary that a public official or candidate must respond to.

Your output must be:
1. Neutral — you do not advocate for any position
2. Faithful — every claim is grounded in the data provided
3. Actionable — you produce specific directed questions that require a substantive response
4. Transparent — you cite vote tallies and group sizes

You must NOT:
- Editorialize or add opinions
- Speculate about motives or causes
- Use partisan framing
- Soften or hedge the consensus findings

Respond with valid JSON matching this schema:
{
  "summary_text": "2-3 paragraph narrative summary",
  "directed_questions": ["question 1", "question 2"],
  "top_consensus_statements": [
    {
      "statement_text": "the statement",
      "agree_rate": 0.85,
      "vote_count": 120
    }
  ]
}`;

export function buildUserPrompt(result: DeliberationResult): string {
  const statementTexts = new Map(result.statements.map((s) => [s.id, s.text]));
  const sections: string[] = [];

  sections.push(
    `## Topic\n${result.topic}`,
  );

  sections.push(
    `## Participation\n- ${result.participant_count} participants\n- ${result.statement_count} statements\n- ${result.groups.length} opinion groups identified`,
  );

  if (result.consensus.agree.length > 0) {
    sections.push("## Consensus Statements (broad agreement)");
    for (const item of result.consensus.agree) {
      const text = statementTexts.get(item.statement_id) ?? item.text;
      sections.push(
        `- "${text}" — ${Math.round(item.agree_rate * 100)}% agreement (${item.vote_count} votes)`,
      );
    }
  }

  if (result.consensus.disagree.length > 0) {
    sections.push("## Consensus Statements (broad disagreement)");
    for (const item of result.consensus.disagree) {
      const text = statementTexts.get(item.statement_id) ?? item.text;
      sections.push(
        `- "${text}" — ${Math.round(item.agree_rate * 100)}% disagreement (${item.vote_count} votes)`,
      );
    }
  }

  for (const group of result.groups) {
    sections.push(
      `## Opinion Group ${group.id} (${group.size} participants)`,
    );
    for (const rep of group.representative_statements) {
      sections.push(
        `- ${rep.direction === "agree" ? "Agrees" : "Disagrees"} with: "${rep.text}" (repness: ${rep.repness.toFixed(2)})`,
      );
    }
  }

  return `Analyze the following Polis conversation data and produce the structured JSON output.\n\n${sections.join("\n\n")}`;
}
