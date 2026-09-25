import SectionForm from "./SectionForm";
import { Link } from "react-router-dom";
import { ReadOnlyField, TextAreaField, TextField } from "./fields";

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
            hint="Printed in the footer of digests (anti-spam law asks for one). Leave it empty to leave it out."
          />
          <p className="form-hint settings-note">
            Whether this hub sends the resident and admin digests, and when,
            is under <Link to="/admin/settings/plugins">Plugins</Link>.
          </p>
        </>
      )}
    </SectionForm>
  );
}
