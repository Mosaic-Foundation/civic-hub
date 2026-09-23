import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function Privacy() {
  const doc = useHubDocument("legal.privacy");
  return <LegalPage document={doc} title="Privacy Policy" />;
}
