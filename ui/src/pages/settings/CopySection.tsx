import SectionForm from "./SectionForm";
import { BooleanField, DocumentField, TextAreaField, TextField } from "./fields";
import hub from "../../config/hub";
import { defaultBetaBanner } from "../../../../src/shared/hubCopy";
import { participantNoun } from "../../../../src/shared/hubKind";

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
            k="copy.welcome_strip"
            label="Welcome strip"
            rows={3}
            placeholder={hub.welcome_strip_default}
            hint={`The paragraph under "${hub.welcome_strip_title}" at the top of the home page. Left empty, it shows the text above, worded for this kind of hub. Plain text.`}
          />
          <BooleanField
            f={f}
            k="copy.welcome_strip_hidden"
            label="Hide the welcome strip"
            hint="Nobody sees the strip while this is on. Visitors can also dismiss it for themselves."
          />
          <TextAreaField
            f={f}
            k="copy.beta_banner"
            label="Beta bar"
            rows={2}
            placeholder={defaultBetaBanner({
              kind: hub.kind,
              jurisdictionType: hub.jurisdiction_type,
              hubName: hub.name,
              hasSamples: false,
            })}
            hint="The bar across every page while the hub is in beta. Left empty, it says the hub is in beta and, while sample content is left, that content marked Sample is not real. Plain text."
          />
          <TextAreaField
            f={f}
            k="copy.intro_body"
            label="Intro"
            rows={3}
            placeholder={hub.intro_body_default}
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
            placeholder="Town Council, County Commission…"
            hint="The full name of the local government residents are addressing. Briefs, announcements and the legal documents use it."
          />
          <TextField
            f={f}
            k="copy.governing_body_short"
            label="Governing body, short"
            placeholder="Council, Commission…"
            width={260}
            hint={'In pills and running text: "Council meeting summaries", "passing on to the Council". Left empty, it comes from the full name.'}
          />
          <TextField
            f={f}
            k="copy.resident_noun"
            label="What participants are called"
            placeholder={participantNoun(hub.kind, 1)}
            width={260}
            hint={`One word, singular: "neighbor", "student". Used wherever the site counts or names the people taking part ("12 ${hub.noun(2)} voted"). Left empty, it follows the kind of hub: resident, member or participant.`}
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
