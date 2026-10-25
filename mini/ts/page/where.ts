// where: "<url> | <the page text's first 60 characters on one line>", for login checks.
function page(): string {
  return `${location.href} | ${document.body.innerText.slice(0, 60).replace(/\n/g, " ")}`;
}
