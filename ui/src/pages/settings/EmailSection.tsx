import SectionForm from "./SectionForm";
import { BooleanField, HourField, ReadOnlyField, TextAreaField, TextField } from "./fields";

export default function EmailSection() {
  return (
    <SectionForm
      section="email"
      title="Email"
      intro={
        <p className="form-hint">
          The name and postal address on every email this hub sends, and
          whether it sends digests.
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
          <BooleanField
            f={f}
            k="plugin.digest.enabled"
            label="Send the resident digest"
            hint="A summary email of new activity to each resident who has not unsubscribed."
          />
          <HourField
            f={f}
            k="plugin.digest.send_hour"
            label="Digest send time"
            hint="In the hub's time zone, set under Identity."
          />
          <BooleanField
            f={f}
            k="plugin.admin_digest.enabled"
            label="Send the admin digest"
            hint="A daily summary for admins of what is waiting for review."
          />
        </>
      )}
    </SectionForm>
  );
}
