// civic.project: a community project with updates, comments and sentiment
// (manifest: src/modules/civic.projects/manifest.ts).

import { NewProject, ProjectDetail, Projects } from "../lazyPages";
import { getProjectDetail } from "../services/api";
import type { FeedKindUi, ProcessUi } from "./types";

// Phase 3 fix — projects previously fell through to getAnnouncement(id)
// and 404'd; fetch the real project detail (title + banner image).
const projectMeta: FeedKindUi["meta"] = (id) =>
  getProjectDetail(id).then((p) => ({
    title: p.title,
    description: p.description,
    imageUrl: p.banner_image_url ?? null,
    imageAlt: p.banner_image_alt ?? null,
  }));

export const projectUi: ProcessUi = {
  type: "civic.project",
  routes: [
    { path: "/projects", element: <Projects /> },
    { path: "/projects/new", element: <NewProject /> },
    { path: "/project/:id", element: <ProjectDetail /> },
  ],
  feed: {
    "project-created": {
      card: ({ id, data, getTitle, descSummary }) => {
        const proj = data.project as { title?: string } | undefined;
        return {
          title: proj?.title ?? getTitle(id) ?? "New project",
          summary: descSummary,
        };
      },
      meta: projectMeta,
    },
    "project-updated": {
      card: ({ id, getTitle }) => ({ title: getTitle(id) ?? "Project update", summary: "" }),
      meta: projectMeta,
      titleNeedsMeta: true,
    },
  },
  linkRelation: "implements",
};
