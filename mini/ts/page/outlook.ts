// outlook open|link <email>: open the newest message ("ok", "" with none); or the first Linear
// login link for <email> in the open message ("" with none), for maillink.
function page(op: string, email: string): string {
  if (op === "open") {
    const newest = document.querySelector<HTMLElement>("[role=option]");
    if (!newest) return "";
    newest.click();
    return "ok";
  }
  if (op !== "link") throw new Error(`outlook: unknown op ${op}`);
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="linear.app/auth/email/"]');
  const mine = Array.from(links, (a) => a.href).filter((href) =>
    decodeURIComponent(href).includes(`/${email}/`),
  );
  return mine[0] ?? "";
}
