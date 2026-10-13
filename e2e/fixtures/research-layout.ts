import { officeHistories } from "../../src/frontend/office-projection.js";

// Browser-layout input only. Never imported by the application or runtime.
let findingIndex = 0;
export const researchLayoutHistory = officeHistories.COMPLETED.map((event) => {
  if (event.type !== "FindingSubmitted") return event;
  const index = findingIndex++;
  const text = index === 0
    ? "Layout-only sample: this deliberately long finding checks whether a reader can follow a complete research statement across a wide desktop document without losing their place. It includes enough ordinary prose to exercise wrapping, text weight, disclosure alignment, and the transition into supporting provenance. No market conclusion is being asserted by this test input."
    : index === 1
      ? "Layout-only sample: a multi-paragraph finding should preserve its structure instead of becoming a dense block of text. This paragraph exercises the first part of a recorded response and has no evidentiary meaning.\n\nThe second paragraph checks reading rhythm and line length. It deliberately includes a long identifier layout-check-abcdefghijklmnopqrstuvwxyz-0123456789-abcdefghijklmnopqrstuvwxyz to test safe wrapping at narrow widths.\n\nThe final paragraph checks the spacing before researcher attribution and the source label. These paragraphs exist only in the isolated browser test."
      : event.payload.finding;
  return { ...event, payload: { ...event.payload, finding: text } };
});
