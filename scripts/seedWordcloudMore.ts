// Add more submissions to the existing word cloud process for stress-testing.
// Run: node --env-file=.env --import tsx scripts/seedWordcloudMore.ts --hub <slug>

import { executeAction } from "../src/services/processService.js";
import type { Hub } from "../src/models/hub.js";
import { withScriptHub } from "./lib/hubScope.js";

const PROCESS_ID = "proc-wordcloud-test";

const samples = [
  { actor: "user-16", text: "Creek swimming and wildflowers" },
  { actor: "user-17", text: "Artisan crafts and pottery" },
  { actor: "user-18", text: "Sunrise over the valley" },
  { actor: "user-19", text: "Farmers market Saturday mornings" },
  { actor: "user-20", text: "Bluegrass music everywhere" },
  { actor: "user-21", text: "Old country store charm" },
  { actor: "user-22", text: "Community garden projects" },
  { actor: "user-23", text: "Covered bridges and history" },
  { actor: "user-24", text: "Peaceful mountain sunsets" },
  { actor: "user-25", text: "Neighbors helping neighbors" },
  { actor: "user-26", text: "Fresh air and clean water" },
  { actor: "user-27", text: "Winding country roads" },
  { actor: "user-28", text: "Handmade music and dancing" },
  { actor: "user-29", text: "Apple orchards in autumn" },
  { actor: "user-30", text: "Historic downtown buildings" },
  { actor: "user-31", text: "Mountain biking trails" },
  { actor: "user-32", text: "Quiet countryside living" },
  { actor: "user-33", text: "Volunteer spirit and kindness" },
  { actor: "user-34", text: "Beautiful waterfalls nearby" },
  { actor: "user-35", text: "Organic farming community" },
  { actor: "user-36", text: "Wildlife and bird watching" },
  { actor: "user-37", text: "Festival weekends and crafts" },
  { actor: "user-38", text: "Safe place to raise children" },
  { actor: "user-39", text: "Scenic parkway drives" },
  { actor: "user-40", text: "Local music venues" },
  { actor: "user-41", text: "River kayaking and fishing" },
  { actor: "user-42", text: "Family farms and heritage" },
  { actor: "user-43", text: "Mountain views every morning" },
  { actor: "user-44", text: "Creative artists everywhere" },
  { actor: "user-45", text: "Dark skies and stargazing" },
  { actor: "user-46", text: "Slow pace of life" },
  { actor: "user-47", text: "Community potluck dinners" },
  { actor: "user-48", text: "Wildflower meadows and beauty" },
  { actor: "user-49", text: "Fresh garden vegetables" },
  { actor: "user-50", text: "Genuine caring people" },
  { actor: "user-51", text: "Campfire nights with friends" },
  { actor: "user-52", text: "Rolling green hills" },
  { actor: "user-53", text: "Affordable mountain living" },
  { actor: "user-54", text: "Preservation of traditions" },
  { actor: "user-55", text: "Church and fellowship" },
  { actor: "user-56", text: "Swimming holes and creeks" },
  { actor: "user-57", text: "Blackberry picking summer" },
  { actor: "user-58", text: "Independence and freedom" },
  { actor: "user-59", text: "Barn dances and laughter" },
  { actor: "user-60", text: "Small business community" },
];

async function seed(_hub: Hub) {
  let success = 0;
  for (const s of samples) {
    try {
      await executeAction(PROCESS_ID, {
        type: "process.submit",
        actor: s.actor,
        payload: { prompt_id: "p1", text: s.text },
      });
      success++;
      console.log(`  ${success}/${samples.length}: "${s.text}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Failed: "${s.text}" — ${msg}`);
    }
  }
  console.log(`\nDone! ${success}/${samples.length} added.`);
  console.log(`View at: http://localhost:5173/wordcloud/${PROCESS_ID}`);
}

withScriptHub(seed).catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
