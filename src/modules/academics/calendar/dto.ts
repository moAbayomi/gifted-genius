import type { Term } from "../../../db/schema/index.js";

export function toTermDto(term: Term) {
  return {
    id: term.id,
    sessionId: term.sessionId,
    number: term.number,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    status: term.status,
    dataEntryState: term.dataEntryState,
  };
}
