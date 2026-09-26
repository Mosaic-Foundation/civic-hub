// Hash routes, so the page works at console.html in development and at the
// console hostname's root in production without any server-side routing.
import { useEffect, useState } from "react";

export type Route =
  | { name: "hubs" }
  | { name: "new" }
  | { name: "hub"; id: string }
  | { name: "audit" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "hubs/new") return { name: "new" };
  if (path === "audit") return { name: "audit" };
  const m = path.match(/^hubs\/([a-z0-9-]+)$/);
  if (m) return { name: "hub", id: m[1] };
  return { name: "hubs" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "new":
      return "#/hubs/new";
    case "audit":
      return "#/audit";
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
