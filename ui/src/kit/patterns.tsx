// The kit's page patterns (Events 3, 2026-11-08; ADR-018 amendment): the
// pieces a section page is made of, taken from the hub's own pages so the hub
// and a plugin draw the same thing. Votes, Proposals, Projects, Conversations,
// Outcomes and the feed render these; so does a package's page, from
// `@civic-social/plugin-sdk/ui`. Their rules are kit/patterns.css (tokens
// only, in the hub's historical class names).
//
// They know nothing of the hub: a card takes its kind's colour key, its
// labels and its status tone as props. Looking those up (a process type's
// label and colour, a status's wording) is the caller's business, which is
// how the kit stands alone (scripts/check-kit-portable.ts).

import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { dayHeading } from "./dates";

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

// --- The page -------------------------------------------------------------------

/** A section page: the layout gives it the centre column's width. */
export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("page page-home", className)} {...rest} />;
}

/**
 * A page's head: its title (the page's h1), the line under it, and the page's
 * one main action on the right (a `PageAction`). On a phone the action drops
 * under the title.
 */
export function PageHead({
  title,
  lede,
  action,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  /** The page's main action, usually a `PageAction`. */
  action?: ReactNode;
  /** Anything else that belongs in the head: a quiet link, a note. */
  children?: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-header-row">
        <div>
          <h1 className="section-title">{title}</h1>
          {lede && <p className="section-description">{lede}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const Plus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The page's main action, in the accent with a plus: "Suggest a vote", "Add an
 * event". A button, or a link when `href` is given (pass the router's Link as
 * `as` for an in-app route, with `href` as its target).
 */
export function PageAction({
  children,
  onClick,
  href,
  as,
  icon = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  /** The link component for `href` (react-router's Link); a plain `<a>` when absent. */
  as?: ElementType;
  /** The plus. */
  icon?: boolean;
}) {
  if (href) {
    const L = as ?? "a";
    const target = as ? { to: href } : { href };
    return (
      <L className="home-start-btn" {...target} onClick={onClick}>
        {icon && <Plus />}
        {children}
      </L>
    );
  }
  return (
    <button type="button" className="home-start-btn" onClick={onClick}>
      {icon && <Plus />}
      {children}
    </button>
  );
}

// --- Groups ---------------------------------------------------------------------

/** A group's heading: the section title of a list ("Active Votes", a day). */
export function GroupHeading({
  children,
  level = 2,
  id,
}: {
  children: ReactNode;
  level?: 2 | 3;
  id?: string;
}) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <H className="section-title" id={id}>
      {children}
    </H>
  );
}

/**
 * A group of a page: its heading, a line under it, and its list. With
 * `collapsible` the heading folds the group away (past events), open or
 * closed to begin with by `defaultOpen`.
 */
export function Group({
  heading,
  description,
  children,
  collapsible,
  defaultOpen = false,
  className,
  label,
}: {
  heading: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  /** The group's name for a screen reader, when the heading is not plain words. */
  label?: string;
}) {
  if (collapsible) {
    return (
      <section className={cx("section", className)} aria-label={label}>
        <details className="kit-group-fold" open={defaultOpen || undefined}>
          <summary className="section-title kit-group-summary">{heading}</summary>
          {description && <p className="section-description">{description}</p>}
          {children}
        </details>
      </section>
    );
  }
  return (
    <section className={cx("section", className)} aria-label={label}>
      <GroupHeading>{heading}</GroupHeading>
      {description && <p className="section-description">{description}</p>}
      {children}
    </section>
  );
}

/** A day's group: the day as its heading (in the zone given), then its list. */
export function DayGroup({
  date,
  timeZone,
  children,
}: {
  /** Any instant on the day (ISO). */
  date: string;
  timeZone?: string;
  children?: ReactNode;
}) {
  const heading = dayHeading(date, timeZone);
  return (
    <Group heading={heading} label={heading}>
      {children}
    </Group>
  );
}

// --- Cards ----------------------------------------------------------------------

/** A list of cards, one under another at the list's gap. Each child an `<li>`. */
export function CardList({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cx("process-list", className)} {...rest} />;
}

/**
 * A kind's chip: its name on its own colour (`--type-<kind>-bg`, words in
 * `--type-<kind>-fg`). `kind` is the colour key a manifest declares.
 */
export function Chip({
  kind = "generic",
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { kind?: string }) {
  return (
    <span className={cx("feed-pill", `feed-pill--type-${kind}`, className)} style={kindChipStyle(kind)} {...rest}>
      {children}
    </span>
  );
}

const kindChipStyle = (kind: string): CSSProperties => ({
  background: `var(--type-${kind}-bg)`,
  color: `var(--type-${kind}-fg)`,
});

/** Where a thing is in its life, as a dot and a word. */
export type StatusTone = "live" | "phase" | "done" | "alert";

/**
 * A status: a neutral chip with a dot. `live` (green: open, active), `phase`
 * (amber: gathering support), `done` (grey: finished; never red), `alert`
 * (red: called off, as a cancelled event).
 */
export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

/** A quiet line of facts: a time, a place, a count. Empty entries are dropped. */
export function InlineMeta({ items, className }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  if (shown.length === 0) return null;
  return (
    <div className={cx("process-card-meta", className)}>
      {shown.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </div>
  );
}

export interface ListCardProps {
  /** The kind's colour key (`--type-<kind>-fg` is the bar, `-bg` the chip). */
  kind: string;
  /** The kind's name on its chip ("Vote", "Event"). */
  kindLabel: ReactNode;
  title: ReactNode;
  /** A `StatusChip`, at the right of the chip row. */
  status?: ReactNode;
  /** Small marks after the kind's chip (the Sample badge). */
  badges?: ReactNode;
  /** The meta line, left to right; empty entries are dropped. */
  meta?: ReactNode[];
  /** A line or two under the title (the feed's summary). */
  summary?: ReactNode;
  /** A picture: on the right on a wide screen, above on a phone (the feed's form). */
  image?: { src: string; alt: string } | null;
  /** Where the card goes. */
  href?: string;
  /** The link component for `href` (react-router's Link); a plain `<a>` when absent. */
  linkAs?: ElementType;
  /** More for the link: `target`, `rel`. */
  linkProps?: Record<string, unknown>;
  /**
   * Where the kind's chip sits: `top` (a section page's card: the chip row
   * above the title; the default) or `meta` (the feed's: the title first, the
   * chip leading the meta line, a picture at the side).
   */
  pill?: "top" | "meta";
  /** Anything else in the card, after the summary. */
  children?: ReactNode;
  className?: string;
}

/**
 * THE card of a list: a bar in its kind's colour, the kind's chip, a title, a
 * meta line, a status, optionally a summary and a picture. A section page's
 * lists put the chip on top (`pill="top"`); the feed, in the meta line (`pill="meta"`).
 */
export function ListCard(props: ListCardProps) {
  const { kind, href, linkAs, linkProps } = props;
  const L: ElementType = href ? (linkAs ?? "a") : "div";
  const target = href ? (linkAs ? { to: href } : { href }) : {};

  if (props.pill === "meta") {
    const hasImage = Boolean(props.image?.src);
    return (
      <article
        className={cx("feed-post", `feed-post--type-${kind}`, hasImage && "has-image", props.className)}
        style={{ "--feed-kind": `var(--type-${kind}-fg)` } as CSSProperties}
      >
        <L className="feed-post-link" {...target} {...linkProps}>
          <div className="feed-post-body">
            <h2 className="feed-post-title">{props.title}</h2>
            <p className="feed-post-meta">
              <Chip kind={kind} data-testid="feed-type-pill">
                {props.kindLabel}
              </Chip>
              {props.badges}
              {props.meta}
            </p>
            {props.summary && <p className="feed-post-summary">{props.summary}</p>}
            {props.children}
          </div>
          {hasImage && (
            <span className="feed-post-image">
              <img src={props.image!.src} alt={props.image!.alt} loading="lazy" decoding="async" />
            </span>
          )}
        </L>
      </article>
    );
  }

  const card = (
    <div
      className={cx("process-card", props.className)}
      style={{ "--card-accent": `var(--type-${kind}-fg)` } as CSSProperties}
    >
      {props.status !== undefined ? (
        <>
          <div className="process-card-chips">
            <Chip kind={kind}>{props.kindLabel}</Chip>
            {props.badges}
            {props.status}
          </div>
          <h3 className="process-card-title">{props.title}</h3>
        </>
      ) : (
        <div className="process-card-header">
          <Chip kind={kind}>{props.kindLabel}</Chip>
          {props.badges}
          <h3>{props.title}</h3>
        </div>
      )}
      {props.summary && <p className="kit-card-summary">{props.summary}</p>}
      {props.children}
      {props.meta && <InlineMeta items={props.meta} />}
    </div>
  );
  if (!href) return card;
  return (
    <L className="process-link" {...target} {...linkProps}>
      {card}
    </L>
  );
}

// --- Empty, filters, views ------------------------------------------------------

/** What a list says when there is nothing in it, and what to do about it. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  if (!action) return <p className="empty-state-inline">{children}</p>;
  return (
    <div className="kit-empty">
      <p className="empty-state-inline">{children}</p>
      {action}
    </div>
  );
}

/**
 * The page's filter bar: one pill per choice, one on, sticky under the
 * header as the page scrolls. The page keeps the choice (in the URL, say).
 */
export function FilterBar<K extends string>({
  choices,
  active,
  onChange,
  label,
}: {
  choices: ReadonlyArray<{ key: K; label: ReactNode }>;
  active: K;
  onChange: (next: K) => void;
  /** The bar's name for a screen reader: "Filter votes by status". */
  label: string;
}) {
  return (
    <nav className="votes-filter" aria-label={label}>
      <ul className="votes-filter-list">
        {choices.map((c) => {
          const on = c.key === active;
          return (
            <li key={c.key}>
              <button
                type="button"
                className={`votes-filter-pill${on ? " is-active" : ""}`}
                onClick={() => onChange(c.key)}
                aria-pressed={on}
              >
                {c.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Two or three ways to see the same things (List, Calendar): the filter bar's
 * pills, in a row of their own where the page puts it.
 */
export function ViewToggle<K extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: K;
  onChange: (next: K) => void;
  options: ReadonlyArray<{ value: K; label: ReactNode }>;
  label: string;
}) {
  return (
    <div className="votes-filter-list kit-view-toggle" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`votes-filter-pill${on ? " is-active" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
