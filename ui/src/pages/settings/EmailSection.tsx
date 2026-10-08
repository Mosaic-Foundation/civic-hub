import SectionForm from "./SectionForm";
import { Link } from "react-router-dom";
import { ReadOnlyField, TextAreaField, TextField } from "./fields";

/** Where the footer's address comes from, as the page says it. Reflects the last save. */
function postalSourceHint(source: "hub" | "environment" | "platform" | null): string {
  switch (source) {
    case "hub":
      return "This hub's own address, above.";
    case "environment":
      return "The deployment's HUB_POSTAL_ADDRESS, used until this hub sets its own. It is being retired: set the address above to keep it.";
    case "platform":
      return "The platform's address, because this hub has not set its own. Set one above to use yours instead.";
    default:
      return "Neither this hub nor the platform has an address, so digests go out without one.";
  }
}

export default function EmailSection() {
  return (
    <SectionForm
      section="email"
      title="Email"
      intro={
        <p className="form-hint">
          The name and postal address on every email this hub sends.
        </p>
      }
    >
      {(f) => (
        <>
          <ReadOnlyField
            label="From address"
            value={f.data.platform.from_address}
            hint="Set by the platform. Every hub sends from an address on a domain the platform has verified; your hub's name goes beside it."
          />
          <TextField
            f={f}
            k="email.from_name"
            label="From name"
            placeholder={f.data.hub.registry_name}
            hint="What recipients see as the sender, e.g. the hub's name."
          />
          <TextAreaField
            f={f}
            k="email.postal_address"
            label="Postal address"
            rows={2}
            hint="Printed in the footer of digests (anti-spam law asks for one). Leave it empty to use the platform's address."
          />
          <ReadOnlyField
            label="Address in use"
            value={f.data.platform.postal_address.value || "None"}
            hint={postalSourceHint(f.data.platform.postal_address.source)}
          />
          <p className="form-hint settings-note">
            Whether this hub sends the participant and admin digests, and when,
            is under <Link to="/admin/settings/plugins">Plugins</Link>.
          </p>
        </>
      )}
    </SectionForm>
  );
}
