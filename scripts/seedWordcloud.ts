// Seed a word cloud process with sample submissions for testing.
// Run: node --env-file=.env --import tsx scripts/seedWordcloud.ts

import { createProcess, executeAction } from "../src/services/processService.js";
import {
  SEED_WORDCLOUD_TITLE,
  SEED_WORDCLOUD_DESCRIPTION,
  SEED_WORDCLOUD_PROMPT_TEXT,
  SEED_WORDCLOUD_SAMPLES,
} from "../tests/fixtures/samples/seedWordcloud.js";

const PROCESS_ID = "proc-wordcloud-test";

async function seed() {
  console.log("Creating word cloud process...");

  const process = await createProcess({
    id: PROCESS_ID,
    definition: { type: "civic.wordcloud", version: "0.1" },
    title: SEED_WORDCLOUD_TITLE,
    description: SEED_WORDCLOUD_DESCRIPTION,
    createdBy: "admin",
    state: {
      prompts: [
        { id: "p1", text: SEED_WORDCLOUD_PROMPT_TEXT },
      ],
      lifecycle_mode: "evergreen",
    },
  });

  console.log(`Created: ${process.id} (${process.status})`);

  // Activate it
  console.log("Activating...");
  await executeAction(process.id, {
    type: "process.activate",
    actor: "admin",
    payload: {},
  });
  console.log("Active!");

  // Submit sample responses
  const samples = SEED_WORDCLOUD_SAMPLES;

  for (const s of samples) {
    try {
      await executeAction(process.id, {
        type: "process.submit",
        actor: s.actor,
        payload: { prompt_id: "p1", text: s.text },
      });
      console.log(`  Submitted: "${s.text}" (${s.actor})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Failed: "${s.text}" — ${msg}`);
    }
  }

  console.log(`\nDone! View at: http://localhost:5173/wordcloud/${PROCESS_ID}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
