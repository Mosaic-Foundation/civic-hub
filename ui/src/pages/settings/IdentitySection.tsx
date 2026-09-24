import SectionForm from "./SectionForm";
import { ColorField, ImageField, TextAreaField, TextField } from "./fields";

export default function IdentitySection() {
  return (
    <SectionForm
      section="identity"
      title="Identity"
      intro={
        <p className="form-hint">
          What this hub is called and how it looks: the header on every page,
          the browser tab, and the card a link shows when it is shared.
        </p>
      }
    >
      {(f) => (
        <>
          <TextField
            f={f}
            k="identity.name"
            label="Hub name"
            placeholder={f.data.hub.registry_name}
            hint={
              <>
                What this hub calls itself everywhere its name appears: the top
                of every page, the legal documents, the emails it sends. Leave
                it empty to use <strong>{f.data.hub.registry_name}</strong>, the
                name in the hub registry. Changing it here does not change the
                registry name or the hub's address.
              </>
            }
          />
          <TextField
            f={f}
            k="identity.label"
            label="Label"
            placeholder="Civic Hub"
            width={260}
            hint={'The small line above the tagline. "Civic Hub" by default.'}
          />
          <TextAreaField
            f={f}
            k="identity.tagline"
            label="Tagline"
            rows={2}
            placeholder="Stay informed on local government, raise the issues that matter, work on projects together, and see where our community stands."
            hint="The sentence under the hub's name on every page with a header. Say what this hub is for, in your own words."
          />
          <TextField
            f={f}
            k="identity.page_title"
            label="Page title"
            placeholder={f.data.hub.registry_name}
            hint="What the browser tab and a shared link's card say. Leave it empty to use the hub's name."
          />
          <TextAreaField
            f={f}
            k="identity.description"
            label="Description"
            rows={2}
            hint="One or two sentences search engines and link cards show under the title. Leave it empty to use the tagline."
          />
          <ImageField
            f={f}
            k="identity.banner_url"
            altKey="identity.banner_alt"
            kind="banner"
            label="Banner"
            addLabel="Upload a banner"
            hint="The photograph across the top of the home page, and the image on a shared link's card. A wide image, at least 600 × 100 pixels. The alt text describes it for people who cannot see it. With no banner, the strip is left out."
          />
          <ImageField
            f={f}
            k="identity.logo_url"
            kind="logo"
            label="Logo"
            addLabel="Upload a logo"
            hint="The icon in the browser tab and on a phone's home screen, and a mark beside the place name on the home page. Leave it empty for none."
            formatHint="A square PNG, at least 256 × 256 pixels. A transparent background works best."
          />
          <ColorField
            f={f}
            k="identity.theme"
            label="Theme colour"
            hint="The accent colour for buttons, links and the active tab. Pick something dark enough for white text to read on it."
          />
        </>
      )}
    </SectionForm>
  );
}
