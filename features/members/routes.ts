// The Members plugin's routes (members and invites slice, 2026-10-14; a
// plugin since kernel step 4, 2026-11-19). Each behind the plugin's switch
// (the host mounts them so). No answer here carries an email address.
//
//   GET /members/summary    "N members" and the faces: everyone
//   GET /members            the Members page: signed-in members only
//   GET /admin/hub/members  the members who hid themselves, and the count (admins)
//
// "Share this hub" (POST /members/invites) is the kernel's and stays on
// either way.

import { Router, type Request } from "express";
import { getAuthUser, getSettingSync, membership, NotFoundError, requireResident, resolveCallerIsAdmin, route } from "../../src/sdk/index.js";
import { MIN_COUNT_KEY, PAGE_BEFORE_THRESHOLD_KEY, visibilityOf, type MemberVisibility } from "./rules.js";

/** What residents may see of the space in scope's members now. */
export async function memberVisibility(knownCount?: number): Promise<MemberVisibility> {
  const count = knownCount ?? (await membership.count());
  return visibilityOf(count, getSettingSync(MIN_COUNT_KEY), getSettingSync(PAGE_BEFORE_THRESHOLD_KEY));
}

export function memberRoutes(): Router {
  const r = Router();
  // Below the threshold a resident gets no number and no faces (`count:
  // null`), so the page cannot show what the server withheld; an admin gets
  // both, with the threshold, to see where the space stands.
  r.get(
    "/summary",
    route(async (req: Request, res) => {
      const summary = await membership.summary();
      const seen = await memberVisibility(summary.count);
      const admin = await resolveCallerIsAdmin(req);
      if (seen.countShown || admin) {
        res.json({ ...summary, shown: seen.countShown, page: seen.pageShown, threshold: admin ? seen.threshold : undefined });
        return;
      }
      res.json({ count: null, stack: [], shown: false, page: seen.pageShown });
    }),
  );
  r.get(
    "/",
    requireResident,
    route(async (req: Request, res) => {
      const user = getAuthUser(res);
      // Before the threshold the page is not there for residents, unless the
      // space shows it anyway (page_before_threshold); an admin always sees it.
      if (!(await memberVisibility()).pageShown && !(await resolveCallerIsAdmin(req))) throw new NotFoundError("Not found");
      const offset = Number(req.query.offset ?? 0);
      res.json({
        ...(await membership.list(Number.isFinite(offset) ? offset : 0)),
        you_are_hidden: user.hidden_from_members,
      });
    }),
  );
  return r;
}

export function adminMemberRoutes(): Router {
  const r = Router();
  r.get(
    "/",
    route(async (_req, res) => {
      res.json(await membership.hiddenForAdmin());
    }),
  );
  return r;
}
