// dialogs [click <button>]: list every on-screen window with buttons as
// "<process> | <window> | <buttons>"; with click, press that button in the first window having it.

function fail(message: string): never {
  throw new Error(`dialogs: ${message}`);
}

// A process's windows with their button names; none for a process System Events cannot read.
function windowsOf(process: JxaProcess): { window: JxaWindow; buttons: string[] }[] {
  try {
    return process
      .windows()
      .map((window) => ({ window, buttons: window.buttons().map((b) => b.name() ?? "") }))
      .filter((w) => w.buttons.length > 0);
  } catch {
    return [];
  }
}

function run(argv: string[]): string {
  const target = argv.length === 2 && argv[0] === "click" ? argv[1] : undefined;
  if (argv.length > 0 && target === undefined) fail("usage: dialogs [click <button>]");
  const se = Application("System Events");
  const shown = se.processes.whose({ _or: [{ backgroundOnly: true }, { visible: true }] });
  const lines: string[] = [];
  for (const process of shown()) {
    for (const { window, buttons } of windowsOf(process)) {
      if (target !== undefined && buttons.includes(target)) {
        window.buttons.byName(target).click();
        return `clicked ${target} in ${process.name()}`;
      }
      lines.push(`${process.name()} | ${window.name() ?? ""} | ${buttons.join(", ")}`);
    }
  }
  if (target !== undefined) fail(`no window has a button ${target}`);
  return lines.join("\n");
}
