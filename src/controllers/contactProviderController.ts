// POST /admin/contact-civic-social: a hub admin writes to Civic.Social
// directly (the provider's inbox, src/services/providerInbox.ts). Not behind
// any plugin: an admin can always reach the people who maintain the software.
// Residents' feedback is the Feedback plugin's (features/feedback).

import { UnauthorizedError } from "../errors/index.js";
import { route } from "../http/route.js";
import { contactProvider } from "../services/providerInbox.js";
import { caller } from "./adminStepUp.js";

export const handleContactCivicSocial = route(async (req, res) => {
  const user = caller(res);
  if (!user) throw new UnauthorizedError("Sign in as an admin.");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ua = req.headers["user-agent"];
  const { id } = await contactProvider({
    message: body.message,
    adminEmail: user.email,
    pagePath: body.page_path,
    userAgent: typeof ua === "string" ? ua : null,
  });
  res.json({ id, message: "Sent to Civic.Social." });
});
