import type { ClusterState, Statement } from "../adapter/types.js";

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

export function buildUserPrompt(
  clusterState: ClusterState,
  statements: Statement[],
  topic: string,
): string {
  const statementTexts = new Map(statements.map((s) => [s.id, s.text]));
  const sections: string[] = [];

  sections.push(
    `## Topic\n${topic}`,
  );

  sections.push(
    `## Participation\n- ${clusterState.participant_count} participants\n- ${clusterState.statement_count} statements\n- ${clusterState.groups.length} opinion groups identified`,
  );

  if (clusterState.consensus.agree.length > 0) {
    sections.push("## Consensus Statements (broad agreement)");
    for (const item of clusterState.consensus.agree) {
      const text = statementTexts.get(item.statement_id) ?? item.text;
      sections.push(
        `- "${text}" — ${Math.round(item.agree_rate * 100)}% agreement (${item.vote_count} votes)`,
      );
    }
  }

  if (clusterState.consensus.disagree.length > 0) {
    sections.push("## Consensus Statements (broad disagreement)");
    for (const item of clusterState.consensus.disagree) {
      const text = statementTexts.get(item.statement_id) ?? item.text;
      sections.push(
        `- "${text}" — ${Math.round(item.agree_rate * 100)}% disagreement (${item.vote_count} votes)`,
      );
    }
  }

  for (const group of clusterState.groups) {
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
