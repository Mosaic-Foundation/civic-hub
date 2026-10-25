// What the navigation shows, and the hook that reads it (split from
// NavDataContext.tsx so that file holds only the provider).
import { createContext, useContext } from "react";
import type { EditNotification } from "../services/api";

export interface NavData {
  memberCount: number | null;
  /** New in the review queues; 0 for anyone not an admin. */
  reviews: number;
  /** The first queue with something new, so opening it clears what was counted. */
  reviewsTo: string;
  mySubmissions: number;
  editNotifs: EditNotification[];
  /** Clear the edited-projects badge, then open one of them. */
  openEdited: (href: string, navigate: (to: string) => void) => void;
}

const EMPTY: NavData = {
  memberCount: null,
  reviews: 0,
  reviewsTo: "/admin/reviews",
  mySubmissions: 0,
  editNotifs: [],
  openEdited: (href, navigate) => navigate(href),
};

export const NavDataContext = createContext<NavData>(EMPTY);

export function useNavData(): NavData {
  return useContext(NavDataContext);
}
