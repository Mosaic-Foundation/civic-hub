import { useState } from "react";
import HubInfo from "../components/HubInfo";
import WelcomeBanner from "../components/WelcomeBanner";
import ProcessPicker from "../components/ProcessPicker";
import Feed from "../components/Feed";
import FeedFilter, {
  useFeedFilter,
  useFilterPredicate,
} from "../components/FeedFilter";

export default function Home() {
  const { active, setActive } = useFeedFilter();
  const filter = useFilterPredicate(active);
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="page page-home">
      <div className="home-hero-row">
        <HubInfo />
        <button
            type="button"
            className="home-start-btn"
            onClick={() => setShowPicker(true)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Raise something
          </button>
      </div>
      <WelcomeBanner />

      {showPicker && (
        <ProcessPicker onDismiss={() => setShowPicker(false)} />
      )}

      <FeedFilter active={active} onChange={setActive} />
      <Feed
        filter={filter}
        emptyFilteredAction={
          active === "all"
            ? null
            : { label: "Show all activity", onClick: () => setActive("all") }
        }
      />
    </div>
  );
}
