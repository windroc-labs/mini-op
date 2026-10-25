// outlook rows <text>|open <id>|link <email>|code, for maillink: the ids of the listed messages
// whose label holds <text> (data-convid, else the row id), newest first ("-" until the list or its
// empty state has rendered, or while such a row has no id: its label changes once read);
// open the message with that id ("ok", "" with none); the first Linear login link for <email> in
// the open message; or the one login code in the open message ("" with none).
function page(op: string, arg: string): string {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[role=option]"));
  const text = document.body?.innerText ?? "";
  const label = (row: HTMLElement) => row.getAttribute("aria-label") || row.innerText;
  const id = (row: HTMLElement) => (row.getAttribute("data-convid") || row.id).trim();
  if (op === "rows") {
    const empty = /Nothing in folder|Looks empty over here|All done for the day/.test(text);
    if (rows.length === 0) return empty ? "" : "-";
    const ids = rows.filter((r) => label(r).includes(arg)).map(id);
    return ids.includes("") ? "-" : ids.join("\n");
  }
  if (op === "open") {
    const row = rows.find((r) => id(r) === arg);
    if (!row) return "";
    row.click();
    return "ok";
  }
  if (op === "link") {
    const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="linear.app/auth/email/"]');
    const mine = Array.from(links, (a) => a.href).filter((href) =>
      decodeURIComponent(href).includes(`/${arg}/`),
    );
    return mine[0] ?? "";
  }
  if (op !== "code") throw new Error(`outlook: unknown op ${op}`);
  const count = (s: string) => {
    const seen = new Map<string, number>();
    for (const m of s.matchAll(/login code directly:\s*([A-Za-z0-9-]{10})(?![A-Za-z0-9-])/g)) {
      seen.set(m[1] ?? "", (seen.get(m[1] ?? "") ?? 0) + 1);
    }
    return seen;
  };
  // Row previews can quote older codes: the open message's code shows more often than in the rows.
  const listed = count(rows.map((r) => r.innerText).join("\n"));
  const shown = [...count(text)].filter(([code, n]) => n > (listed.get(code) ?? 0));
  return shown.length === 1 ? (shown[0]?.[0] ?? "") : "";
}
