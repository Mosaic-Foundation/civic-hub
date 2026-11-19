// civic.project: a community project with updates, comments and sentiment
// (manifest: packages/civic.projects/manifest.ts). Its pages are its own
// (./ui/), built from the SDK's UI entry alone, and load when first opened.

import { lazy } from "react";
import type { FeedKindUi, ProcessUi } from "@civic-social/plugin-sdk/ui";
import { getProjectDetail } from "./ui/api";

const Projects = lazy(() => import("./ui/Projects"));
const NewProject = lazy(() => import("./ui/NewProject"));
const ProjectDetail = lazy(() => import("./ui/ProjectDetail"));

// Phase 3 fix — projects previously fell through to getAnnouncement(id)
// and 404'd; fetch the real project detail (title + banner image).
const projectMeta: FeedKindUi["meta"] = (id) =>
  getProjectDetail(id).then((p) => ({
    title: p.title,
    description: p.description,
    imageUrl: p.banner_image_url ?? null,
    imageAlt: p.banner_image_alt ?? null,
  }));

const projectUi: ProcessUi = {
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

export default projectUi;
