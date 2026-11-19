// A receipt code that wraps at its hyphens, never one character per line
// (Vote pages fixes, 2026-10-13: the vote log on a phone broke each code
// into a column of single characters). Line breaking gives no break after a
// hyphen that is followed by a digit, so each hyphen carries a <wbr>.

import { Fragment } from "react";

export default function ReceiptCode({ code, className }: { code: string; className?: string }) {
  const parts = code.split("-");
  return (
    <code className={`receipt-code${className ? ` ${className}` : ""}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              -<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </code>
  );
}
