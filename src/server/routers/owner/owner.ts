import { t } from "../../trpc.ts";
import { ownerLogin, usageSummary } from "../../controllers/ownerControllers/index.ts";

export const ownerRouter = t.router({
  login: ownerLogin,
  usageSummary,
});
