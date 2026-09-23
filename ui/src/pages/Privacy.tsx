import privacyMd from "../content/legal/privacy.md?raw";
import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function Privacy() {
  const markdown = useHubDocument("legal.privacy", privacyMd);
  return <LegalPage markdown={markdown} title="Privacy Policy" />;
}
