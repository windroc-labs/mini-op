// go <url>: open <url> in this tab; the reply is "ok", never the URL (maillink's is a token).
function page(url: string): string {
  location.href = url;
  return "ok";
}
