import termsMd from "../content/legal/terms.md?raw";
import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function Terms() {
  const markdown = useHubDocument("legal.terms", termsMd);
  return <LegalPage markdown={markdown} title="Terms of Service" />;
}
