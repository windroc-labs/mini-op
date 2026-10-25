// chrome activate|close <url-substring>: bring Chrome to the front, or close every tab whose URL
// contains the text.

const USAGE = "usage: chrome activate|close <url-substring>";

function run(argv: string[]): string {
  const chrome = Application("Google Chrome");
  if (argv.length === 1 && argv[0] === "activate") {
    chrome.activate();
    return "activated";
  }
  const part = argv[1];
  if (argv.length !== 2 || argv[0] !== "close" || !part) throw new Error(`chrome: ${USAGE}`);
  const tabs = chrome
    .windows()
    .flatMap((window) => window.tabs())
    .filter((tab) => tab.url().includes(part));
  // Last first: a tab specifier is an index, which closing an earlier tab would shift.
  for (const tab of tabs.reverse()) tab.close();
  return `closed ${tabs.length}`;
}
