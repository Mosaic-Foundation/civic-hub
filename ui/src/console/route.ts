// Hash routes, so the page works at console.html in development and at the
// console hostname's root in production without any server-side routing.
import { useEffect, useState } from "react";

export type Route =
  | { name: "hubs" }
  | { name: "dashboard" }
  | { name: "new" }
  | { name: "hub"; id: string }
  | { name: "audit" }
  | { name: "invites" }
  | { name: "feedback" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "hubs/new") return { name: "new" };
  if (path === "dashboard") return { name: "dashboard" };
  if (path === "audit") return { name: "audit" };
  if (path === "invites") return { name: "invites" };
  if (path === "feedback") return { name: "feedback" };
  const m = path.match(/^hubs\/([a-z0-9-]+)$/);
  if (m) return { name: "hub", id: m[1] };
  return { name: "hubs" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "new":
      return "#/hubs/new";
    case "dashboard":
      return "#/dashboard";
    case "audit":
      return "#/audit";
    case "invites":
      return "#/invites";
    case "feedback":
      return "#/feedback";
    case "hub":
      return `#/hubs/${route.id}`;
    default:
      return "#/hubs";
  }
}

export function go(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
