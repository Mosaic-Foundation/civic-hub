import SectionForm from "./SectionForm";
import { DocumentField, EmailField, TextField } from "./fields";

export default function LegalSection() {
  return (
    <SectionForm
      section="legal"
      title="Legal"
      intro={
        <p className="form-hint">
          The documents residents agree to. Every hub starts from the same
          shared text with its own names filled in — the operator and contact
          address below are substituted into all of them.
        </p>
      }
      savedMessage="Saved. The legal pages show the change on their next load."
    >
      {(f) => (
        <>
          <TextField
            f={f}
            k="legal.operator_name"
            label="Operated by"
            placeholder="Who runs this hub"
            hint={`A person or a group — whoever is answerable for this hub. Printed verbatim, e.g. "the Moderators' Group", a town office, or a named individual.`}
          />
          <EmailField
            f={f}
            k="legal.contact_email"
            label="Contact address"
            placeholder="contact@example.com"
            hint="Where the documents tell residents to write with a question, an appeal, or a data request. A shared inbox is fine."
          />
          <DocumentField
            f={f}
            k="legal.who_runs_this"
            label='"Who runs this site"'
            rows={6}
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
                The <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> residents agree to by using this hub.
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
