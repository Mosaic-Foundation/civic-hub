/**
 * The one line that replaced the terms checkbox (sign-in slice, Adam
 * 2026-10-13): "By joining you agree to the Code of Conduct, Privacy Notice
 * and Terms", beside the button that does it. Each link opens the document,
 * which starts with a short plain-language summary ("In short"). New tabs, so
 * a half-finished sign-up is still there when the person comes back.
 */
export default function TermsNotice({ verb }: { verb: string }) {
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
  return (
    <p className="auth-terms-notice">
      By {verb} you agree to the {link("/code-of-conduct", "Code of Conduct")},{" "}
      {link("/privacy", "Privacy Notice")} and {link("/terms", "Terms")}.
    </p>
  );
}
