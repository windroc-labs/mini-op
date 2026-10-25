// terminal activate|front|history [--all]|contents|bottom: the mini's Terminal. activate hides
// Chrome and brings Terminal to the front, failing unless it got there; history and contents read
// the front window's selected tab (--all: every tab); bottom scrolls to the end (Cmd+End).

const USAGE = "usage: terminal activate|front|history [--all]|contents|bottom";

function fail(message: string): never {
  throw new Error(`terminal: ${message}`);
}

function frontmost(se: JxaSystemEvents): string {
  return se.processes.whose({ frontmost: true })[0].name();
}

function activate(se: JxaSystemEvents): string {
  const chrome = se.processes.byName("Google Chrome");
  if (chrome.exists()) chrome.visible = false;
  Application("Terminal").activate();
  delay(0.5);
  const front = frontmost(se);
  if (front !== "Terminal") fail(`Terminal not frontmost (${front})`);
  return front;
}

function allHistory(): string {
  const histories: string[] = [];
  for (const window of Application("Terminal").windows()) {
    for (const tab of window.tabs()) histories.push(tab.history());
  }
  return histories.join("\n");
}

function run(argv: string[]): string {
  const se = Application("System Events");
  const [command, ...rest] = argv;
  const front = () => Application("Terminal").windows[0].selectedTab;
  if (command === "history" && rest.length === 1 && rest[0] === "--all") return allHistory();
  if (rest.length > 0) fail(USAGE);
  switch (command) {
    case "activate":
      return activate(se);
    case "front":
      return frontmost(se);
    case "history":
      return front().history();
    case "contents":
      return front().contents();
    case "bottom":
      se.keyCode(119, { using: "command down" });
      return "bottom";
    default:
      return fail(USAGE);
  }
}
