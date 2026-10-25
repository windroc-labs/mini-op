// field point|focused|length <css>: secfield's reads of the field <css> matches: its screen point
// "x y" once scrolled into view ("" when none matches), whether the keyboard focus is on it, or
// its value's length (-1 when none matches).
function page(op: string, css: string): string | number | boolean {
  const field = document.querySelector<HTMLInputElement>(css);
  if (op === "focused") {
    const active = document.activeElement;
    return document.hasFocus() && active !== null && active.matches(css);
  }
  if (op === "length") return field ? field.value.length : -1;
  if (op !== "point") throw new Error(`field: unknown op ${op}`);
  if (!field) return "";
  field.scrollIntoView({ block: "center" });
  const r = field.getBoundingClientRect();
  const x = window.screenX + (window.outerWidth - window.innerWidth) / 2 + r.left + r.width / 2;
  const y = window.screenY + window.outerHeight - window.innerHeight + r.top + r.height / 2;
  return `${Math.round(x)} ${Math.round(y)}`;
}
