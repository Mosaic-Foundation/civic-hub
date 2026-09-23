import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function Terms() {
  const doc = useHubDocument("legal.terms");
  return <LegalPage document={doc} title="Terms of Service" />;
}
