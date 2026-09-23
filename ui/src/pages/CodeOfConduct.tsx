import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function CodeOfConduct() {
  // Every hub gets the shared template with its own names substituted unless
  // it has authored its own row, so "missing" here means a hub with no
  // template on disk — a deployment problem, not a normal state.
  const doc = useHubDocument("legal.code_of_conduct");
  return <LegalPage document={doc} title="Code of Conduct" />;
}
