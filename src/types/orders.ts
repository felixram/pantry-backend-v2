export const ORDER_STATUS = {
  draft: "DRAFT",
  pendingApproval: "PENDING_APPROVAL",
  approved: "APPROVED",
  ordered: "ORDERED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
  received: "RECEIVED",
} as const;

export type orderSatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

// Terminal states that cannot be modified
export const TERMINAL_STATES = [
  ORDER_STATUS.received,
  ORDER_STATUS.rejected,
  ORDER_STATUS.cancelled,
] as const;

// States that can transition
export const EDITABLE_STATUSES = [
  ORDER_STATUS.draft,
  ORDER_STATUS.pendingApproval,
  ORDER_STATUS.approved,
  ORDER_STATUS.ordered,
] as const;
