// keys: type stdin, less one trailing newline, as keystrokes. --front first makes sure that app
// takes them (Chrome: Google Chrome frontmost; SettingsSheet: System Settings frontmost with a
// focused secure field, as on its macOS 26+ password sheets); --verify-field checks that secure
// field got every character, then clicks Allow (SecurityAgent) or OK (SettingsSheet); SecurityAgent
// then answers one repeat dialog the same way; --secret keeps the text out of every message; --wake
// presses Shift first (lock screen).
ObjC.import("Foundation");

const USAGE =
  "usage: keys [--front Terminal|Chrome|SecurityAgent|SettingsSheet] [--secret] [--verify-field] [--enter] [--wake]";

type Front = "Terminal" | "Chrome" | "SecurityAgent" | "SettingsSheet";

type KeysOptions = {
  front?: Front;
  secret: boolean;
  verify: boolean;
  enter: boolean;
  wake: boolean;
};

// A secure field to type into, and the dialog button that confirms it.
type Secure = { field: JxaUIElement; dialog: JxaWindow; button: string };

function fail(message: string): never {
  throw new Error(`keys: ${message}`);
}

function parse(argv: string[]): KeysOptions {
  const options: KeysOptions = { secret: false, verify: false, enter: false, wake: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--front") {
      const app = argv[++i];
      if (
        app !== "Terminal" &&
        app !== "Chrome" &&
        app !== "SecurityAgent" &&
        app !== "SettingsSheet"
      ) {
        fail(USAGE);
      }
      options.front = app;
    } else if (arg === "--secret") options.secret = true;
    else if (arg === "--verify-field") options.verify = true;
    else if (arg === "--enter") options.enter = true;
    else if (arg === "--wake") options.wake = true;
    else fail(USAGE);
  }
  const field = options.front === "SecurityAgent" || options.front === "SettingsSheet";
  if (options.verify && !field) fail(USAGE);
  return options;
}

// All of stdin, less one trailing \r\n or \n: the one place typed text loses its newline.
function readText(): string {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  return String(text ?? "").replace(/\r?\n$/, "");
}

function frontmost(se: JxaSystemEvents): string {
  return se.processes.whose({ frontmost: true })[0].name();
}

function terminalInFront(se: JxaSystemEvents): void {
  Application("Terminal").activate();
  delay(0.6);
  const front = frontmost(se);
  if (front !== "Terminal") fail(`Terminal not frontmost (${front}); typed nothing`);
}

function chromeInFront(se: JxaSystemEvents): void {
  const front = frontmost(se);
  if (front !== "Google Chrome") fail(`Google Chrome not frontmost (${front}); typed nothing`);
}

// After Allow, the answered dialog must close within CLOSE s; a new one with a focused secure field
// within REPEAT s gets the same answer, once (the same item can ask twice in a row).
const CLOSE = 5;
const REPEAT = 5;

// SecurityAgent's one secure field, while SecurityAgent is frontmost with that field focused, or
// why there is none.
function agentField(se: JxaSystemEvents): Secure | string {
  const agent = se.processes.byName("SecurityAgent");
  if (!agent.exists()) return "no SecurityAgent";
  if (agent.windows.length === 0) return "SecurityAgent has no window";
  const window = agent.windows[0];
  const fields = window.textFields.whose({ subrole: "AXSecureTextField" });
  if (fields.length !== 1) return `SecurityAgent has ${fields.length} secure fields`;
  const field = fields[0];
  if (!(agent.attributes.byName("AXFrontmost").value() && field.focused())) {
    return "SecurityAgent field not focused";
  }
  return { field, dialog: window, button: "Allow" };
}

function secureField(se: JxaSystemEvents): Secure {
  const found = agentField(se);
  if (typeof found === "string") fail(`${found}; typed nothing`);
  return found;
}

function agentClosed(se: JxaSystemEvents): boolean {
  const agent = se.processes.byName("SecurityAgent");
  return !agent.exists() || agent.windows.length === 0;
}

// Polls ready() every 0.5 s for up to secs; true as soon as it holds.
function within(secs: number, ready: () => boolean): boolean {
  for (let waited = 0; waited < secs; waited += 0.5) {
    if (ready()) return true;
    delay(0.5);
  }
  return ready();
}

function closeAfterAllow(se: JxaSystemEvents, answered: number): void {
  if (!within(CLOSE, () => agentClosed(se))) {
    fail(
      `SecurityAgent dialog still up ${CLOSE} s after Allow (answered ${answered}); typed no more`,
    );
  }
}

// System Settings' focused secure field and the sheet holding it, while System Settings is
// frontmost.
function settingsField(se: JxaSystemEvents): Secure {
  const front = frontmost(se);
  if (front !== "System Settings") fail(`System Settings not frontmost (${front}); typed nothing`);
  let field: JxaUIElement | undefined;
  try {
    const settings = se.processes.byName("System Settings");
    field = settings.attributes.byName("AXFocusedUIElement").value() as JxaUIElement;
    if (field.subrole() !== "AXSecureTextField") field = undefined;
  } catch {
    field = undefined;
  }
  if (!field) fail("System Settings has no focused secure field; typed nothing");
  const dialog = field.attributes.byName("AXTopLevelUIElement").value() as JxaWindow;
  return { field, dialog, button: "OK" };
}

// A System Events error can quote what it was typing: with --secret, drop its message.
function type(se: JxaSystemEvents, text: string, secret: boolean): void {
  try {
    se.keystroke(text);
  } catch (err) {
    if (secret) fail("typing failed; the secret may be partly typed");
    throw err;
  }
}

// Types text into the secure field, checking the first character and then the whole length
// arrived, then clicks the dialog's button.
function fill(se: JxaSystemEvents, secure: Secure, text: string, secret: boolean): void {
  const before = secure.field.value().length;
  type(se, text.slice(0, 1), secret);
  delay(0.3);
  if (secure.field.value().length !== before + 1) {
    fail("first character did not reach the field; stopped");
  }
  type(se, text.slice(1), secret);
  delay(0.3);
  const now = secure.field.value().length;
  if (now !== before + text.length) {
    fail(
      `field has ${now} characters, expected ${before + text.length}; did not click ${secure.button}`,
    );
  }
  secure.dialog.buttons.byName(secure.button).click();
}

// After the first Allow: its dialog closes, then a repeat, if one comes, gets the same answer.
// Returns how many dialogs were answered.
function answerRepeat(se: JxaSystemEvents, text: string, secret: boolean): 1 | 2 {
  closeAfterAllow(se, 1);
  let repeat: Secure | undefined;
  within(REPEAT, () => {
    const found = agentField(se);
    repeat = typeof found === "string" ? undefined : found;
    return repeat !== undefined;
  });
  if (!repeat) return 1;
  try {
    fill(se, repeat, text, secret);
  } catch (err) {
    const why = (err as Error).message.replace(/^keys: /, "");
    fail(`answered 1 SecurityAgent dialog; the repeat: ${why}`);
  }
  closeAfterAllow(se, 2);
  return 2;
}

function run(argv: string[]): string {
  const options = parse(argv);
  let text = readText();
  const count = text.length;
  if (options.secret && count === 0) fail("empty secret; typed nothing");
  if (options.verify && count === 0) fail("empty text; typed nothing");
  const se = Application("System Events");
  if (options.front === "Terminal") terminalInFront(se);
  if (options.front === "Chrome") chromeInFront(se);
  const secure =
    options.front === "SecurityAgent"
      ? secureField(se)
      : options.front === "SettingsSheet"
        ? settingsField(se)
        : undefined;
  if (options.wake) {
    se.keyCode(56);
    delay(1.5);
  }
  let clicked = "";
  let answered = "";
  if (options.verify && secure) {
    fill(se, secure, text, options.secret);
    clicked = secure.button;
    if (options.front === "SecurityAgent") {
      const n = answerRepeat(se, text, options.secret);
      answered = `; answered ${n} SecurityAgent dialog${n === 2 ? "s" : ""}`;
    }
  } else if (count > 0) {
    type(se, text, options.secret);
    delay(0.3);
  }
  text = "";
  if (options.enter) se.keyCode(36);
  const what = !options.secret
    ? `${count} characters`
    : options.verify
      ? `the secret (${count} characters)`
      : "the secret";
  return `keys: typed ${what}${options.enter ? ", Enter" : ""}${clicked ? `; clicked ${clicked}` : ""}${answered}`;
}
