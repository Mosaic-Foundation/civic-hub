// FIXTURE DATA — a Wix blog RSS feed, shaped like Floyd County's
// /blog-feed.xml (titles and slugs as that site writes them). The origin is a
// parameter so the same feed can be served as any hub's.

export function wixBlogFeed(origin: string, extraItems = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>News</title>
  <item>
    <title>Lawn Care Bid</title>
    <link>${origin}/post/lawn-care-bid</link>
    <pubDate>Sat, 25 Apr 2026 01:41:59 GMT</pubDate>
  </item>
  <item>
    <title>Board of Supervisors Meeting 04/28/2099</title>
    <link>${origin}/post/board-of-supervisors-meeting-04-28-2099</link>
    <description><![CDATA[<p>Regular meeting.</p>]]></description>
    <pubDate>Sun, 26 Apr 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Budget Workshop 01/02/2020</title>
    <link>${origin}/post/budget-workshop-01-02-2020</link>
    <pubDate>Mon, 01 Jan 2020 12:00:00 GMT</pubDate>
  </item>
  ${extraItems}
</channel></rss>`;
}
