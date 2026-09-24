import SectionForm from "./SectionForm";
import { DocumentField, TextAreaField, TextField } from "./fields";

export default function CopySection() {
  return (
    <SectionForm
      section="copy"
      title="Copy & pages"
      intro={
        <p className="form-hint">
          The words residents meet on the way in, the Welcome and About pages,
          and what this hub calls its local government.
        </p>
      }
    >
      {(f) => (
        <>
          <TextAreaField
            f={f}
            k="copy.intro_body"
            label="Intro"
            rows={3}
            placeholder="This is where residents keep up with local government, raise topics that matter, help make sense of issues together, and have conversations to see where the community stands."
            hint="The paragraph in the welcome pop-up a first-time visitor sees. Plain text."
          />
          <TextAreaField
            f={f}
            k="copy.residency_intro"
            label="Residency intro"
            rows={2}
            placeholder={`To participate in ${f.data.hub.registry_name}, please confirm your residency and review the policies below.`}
            hint="The line at the top of the sign-up step where a new member confirms they live here. Plain text."
          />
          <TextField
            f={f}
            k="copy.governing_body_name"
            label="Governing body"
            placeholder="Board of Supervisors, Town Council…"
            hint="The full name of the local government residents are addressing. Briefs, announcements and the legal documents use it."
          />
          <TextField
            f={f}
            k="copy.governing_body_short"
            label="Governing body, short"
            placeholder="Board, Council…"
            width={260}
            hint={'The short form, where the full name would be long: "sent to the Board".'}
          />
          <TextField
            f={f}
            k="copy.resident_noun"
            label="What residents are called"
            placeholder="resident"
            width={260}
            hint="Saved for this hub, but not shown on any page yet: the site still says “resident” everywhere. It will be used once those words are wired to it."
          />
          <DocumentField
            f={f}
            k="copy.welcome"
            label="Welcome page"
            emptyNote="This hub has not published a Welcome page. Visitors to /welcome are told so."
            hint={
              <>
                The <a href="/welcome" target="_blank" rel="noreferrer">Welcome page</a>:
                who started this hub and why, in your own words. There is no
                shared version, because an introduction is only true of the
                person who writes it.
              </>
            }
          />
          <DocumentField
            f={f}
            k="copy.about"
            label="About page"
            hint={
              <>
                The <a href="/about" target="_blank" rel="noreferrer">About page</a>:
                what a Civic Hub is and how this one works. Every hub starts
                from the same text with its own names filled in.
              </>
            }
          />
        </>
      )}
    </SectionForm>
  );
}
