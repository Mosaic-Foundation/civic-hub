// GET /news/:id: one News item, for its page. Public; an archived one is not
// found, as for every type.

import { NotFoundError, processesOf, route } from "@civic-social/plugin-sdk";
import { newsReadModel } from "./state.js";
import type { NewsProcessState } from "./models.js";

export const handleGetNews = route(async (req, res) => {
  const id = req.params.id as string;
  const record = await processesOf("civic.news").get(id);
  if (!record || record.definition.type !== "civic.news" || record.status === "archived") {
    throw new NotFoundError("News item not found");
  }
  const model = newsReadModel(record.state as unknown as NewsProcessState, { id: record.id, createdAt: record.createdAt });
  if (record.isSample) model.is_sample = true;
  res.json(model);
});
