import { t } from "../../trpc.ts";
import {
  startSession,
  getActiveSession,
  bulkUpdateEntries,
  completeSession,
  generateMagicLink,
  getCountSortOrder,
  saveCountSortOrder,
  getCountItems,
  getSuggestedPOs,
  createSuggestedPOs,
  getCountsForReview,
  getCountReviewDetail,
  adjustCountEntry,
  approveCount,
} from "../../controllers/inventoryCountControllers/index.ts";

export const inventoryCountRouter = t.router({
  startSession,
  getActiveSession,
  bulkUpdateEntries,
  completeSession,
  generateMagicLink,
  getCountSortOrder,
  saveCountSortOrder,
  getCountItems,
  getSuggestedPOs,
  createSuggestedPOs,
  getCountsForReview,
  getCountReviewDetail,
  adjustCountEntry,
  approveCount,
});
