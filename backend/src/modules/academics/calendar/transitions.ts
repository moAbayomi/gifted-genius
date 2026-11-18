// modules/academics/calendar/transitions.ts
//
// The term state machine. Data, not code — adding a state or transition is
// a one-line edit here, not a hunt through if/else branches.
//
// planned → active: activating a term. Only when no other term is active
//                   in the school, and (for N > 1) term N-1 is closed.
// active → closed:  closing a term. Requires explicit `confirm: true`.
//
// planned → closed is NOT allowed — a term must be taught before it can be
// closed. This forces the operational reality (activate, then close).
//
// closed → active is NOT allowed — "reopening a closed term" is not a
// status transition. Late score corrections go through result versions
// (Phase 4); the calendar row stays closed.
export type TermStatus = "planned" | "active" | "closed";

export const TERM_TRANSITIONS: ReadonlyArray<{
  from: TermStatus;
  to: TermStatus;
}> = [
  { from: "planned", to: "active" },
  { from: "active",  to: "closed" },
];

export function canTransitionTerm(from: TermStatus, to: TermStatus): boolean {
  return TERM_TRANSITIONS.some((t) => t.from === from && t.to === to);
}