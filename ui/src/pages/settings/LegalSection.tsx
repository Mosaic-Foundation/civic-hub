import SectionForm from "./SectionForm";
import { BooleanField, DocumentField, EmailField, ReadOnlyField, TextField } from "./fields";
import type { FormApi } from "./SectionForm";

/**
 * Whose law the Terms use. A place hub's is its own state, shown and not asked.
 * Any other hub may choose; left empty it uses what's shown in grey, marked as
 * its location's state or the platform's default.
 */
function GoverningLaw({ f }: { f: FormApi }) {
  const law = f.data.governing_law;
  if (law?.source === "place") {
    return (
      <ReadOnlyField
        k="legal.governing_state"
        label="Governing law (state)"
        value={law.state}
        hint="From this hub's jurisdiction: its Terms use this state's law, so there's nothing to set here."
      />
    );
  }
  const shown = law ? `${law.fallback} (${law.fallback_source === "location" ? "this hub's location" : "the platform's default"})` : undefined;
  return (
    <TextField
      f={{ ...f, fallback: () => undefined }}
      k="legal.governing_state"
      label="Governing law (state)"
      placeholder={shown}
      hint="The state whose law governs this hub's Terms. Leave it empty to use the one shown in grey."
    />
  );
}

export default function LegalSection() {
  return (
    <SectionForm
      section="legal"
      title="Legal"
      intro={
        <p className="form-hint">
          The documents people agree to. Every hub starts from the same shared
          text with its own names filled in, including the operator and contact
          address below. Read them here, and change any wording you need to.
        </p>
      }
    >
      {(f) => (
        <>
          <TextField
            f={f}
            k="legal.operator_name"
            label="Operated by"
            placeholder="Its administrators"
            hint='The entity responsible for governing this hub: an organization, a group or a person. Printed as written in the legal documents. Left empty, they read "operated by its administrators".'
          />
          <EmailField
            f={f}
            k="legal.contact_email"
            label="Contact address"
            placeholder="contact@example.com"
            hint="Where the documents tell people to write with a question, an appeal, or a data request. A shared inbox is fine."
          />
          <GoverningLaw f={f} />
          <DocumentField
            f={f}
            k="legal.who_runs_this"
            label='"Who runs this site"'
            hint={
              <>
                The paragraph that opens the Privacy Policy and the Terms. It
                says the hub is <em>not</em> run by local government, which is
                wrong for a hub a council runs itself — write your own if the
                shared default is not true of you.
              </>
            }
          />
          <DocumentField
            f={f}
            k="legal.terms"
            label="Terms of Service"
            hint={
              <>
                The <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> people agree to by using this hub.
              </>
            }
          />
          <DocumentField
            f={f}
            k="legal.privacy"
            label="Privacy Policy"
            hint={
              <>
                The <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>: what this hub collects and what it does with it.
              </>
            }
          />
          <DocumentField
            f={f}
            k="legal.code_of_conduct"
            label="Code of Conduct"
            hint={
              <>
                The <a href="/code-of-conduct" target="_blank" rel="noreferrer">Code of Conduct</a>. The drafting assistant checks new
                submissions against it.
              </>
            }
          />
          <DocumentField
            f={f}
            k="legal.proposal_best_practices"
            label="Proposal guide"
            hint="What makes a proposal worth submitting. There is no page of its own yet — the drafting assistant reads this text to check new submissions against it."
          />
          <BooleanField
            f={f}
            k="legal.reviewed"
            label="Our Terms and Privacy Policy have been reviewed"
            hint="Tick this once someone qualified has reviewed both. Until then admins see a draft note on them, and Hub settings → Mode asks for it before the hub leaves demo or goes live. Who ticked it, and when, is in the admin log."
          />
          {f.data.hub.hostname && (
            <p className="form-hint">
              The documents also name this hub's address,{" "}
              <strong>{f.data.hub.hostname}</strong>, which comes from the hub
              record and is not editable here.
            </p>
          )}
        </>
      )}
    </SectionForm>
  );
}
