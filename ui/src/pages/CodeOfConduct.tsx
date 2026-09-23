import codeOfConductMd from "../content/legal/code-of-conduct.md?raw";
import LegalPage from "../components/LegalPage";
import { useHubDocument } from "../hooks/useHubDocument";

export default function CodeOfConduct() {
  // The bundled copy is the fallback, not a placeholder: it is the right text
  // for any hub that has not authored its own, which is most of them. A hub
  // that has serves its own and this swaps.
  const markdown = useHubDocument("legal.code_of_conduct", codeOfConductMd);
  return <LegalPage markdown={markdown} title="Code of Conduct" />;
}
