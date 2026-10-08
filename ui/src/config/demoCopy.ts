// What a visitor is told before submitting on a demo hub (2026-10-07, review
// R25). Nobody reviews a demo hub: a submission that passed the automated
// Code of Conduct check goes live at once (submitAsCreator on the server),
// and it is cleared with the sample content when the demo ends. If the check
// could not run, it still waits for review, so the wording says "once".

export function demoSubmitNote(noun: string): string {
  return (
    `This is a demo hub: once the Code of Conduct check has passed, your ${noun} goes live right away, ` +
    "with no admin review. Anything added during the demo may be cleared when it ends."
  );
}
