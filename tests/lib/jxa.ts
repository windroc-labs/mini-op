// The JXA harness: runs a mini/ts entry's source (types stripped with their positions kept, so
// node's coverage maps to the TS lines) or its committed mini/js program in a vm context whose
// ObjC, Application, $ and delay are fakes over a scene the test sets, recording every UI event.
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as vm from "node:vm";
import { REPO } from "./repo.ts";

// A secure field gets typed characters while its window's process is frontmost and it is focused;
// `accepts` caps how many more reach it.
export type Field = { subrole?: string; value?: string; focused?: boolean; accepts?: number };
export type Window = { name?: string | null; buttons?: string[]; fields?: Field[] };
export type Process = {
  name: string;
  visible?: boolean;
  backgroundOnly?: boolean;
  windows?: Window[];
  // Reading its windows throws, as for a process System Events cannot inspect.
  unreadable?: boolean;
};
export type Tab = {
  url?: string;
  history?: string;
  contents?: string;
  javascript?: string[];
  javascriptError?: string;
};
export type Scene = {
  // The frontmost process (default Finder); activate() makes the app frontmost unless activates
  // is false.
  front?: string;
  activates?: boolean;
  processes?: Process[];
  terminal?: { tabs: Tab[]; selected?: number }[];
  chrome?: { tabs: Tab[] }[];
  stdin?: string;
  // keystroke() throws an Error with this message.
  keystrokeError?: string;
};

export type JxaEvent =
  | { type: "keystroke"; text: string }
  | { type: "keyCode"; code: number; using?: string | string[] }
  | { type: "activate"; app: string }
  | { type: "hide"; process: string }
  | { type: "click"; process: string; button: string }
  | { type: "mouse"; event: number; x: number; y: number }
  | { type: "tab"; window: number; index: number }
  | { type: "raise"; window: number }
  | { type: "close"; url: string };

export type OsascriptResult = { code: 0 | 1; stdout: string; stderr: string };

// The CoreGraphics constants the fake $ hands out, as macOS defines them.
export const CG = { mouseMoved: 5, leftMouseDown: 1, leftMouseUp: 2, hidEventTap: 0 };

type Filter = Record<string, unknown>;

function property(item: object, key: string): unknown {
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "function" ? value() : value;
}

function matches(item: object, filter: Filter): boolean {
  const any = filter._or as Filter[] | undefined;
  if (any) return any.some((f) => matches(item, f));
  return Object.entries(filter).every(([key, value]) => property(item, key) === value);
}

const absent = (name: string) => ({
  name: () => name,
  exists: () => false,
  get windows(): never {
    throw new Error(`Can't get ${name}.`);
  },
});

// A JXA element collection: callable for its items, indexable, with length, byName and whose.
function elements(list: () => object[], missing: (name: string) => object = absent): unknown {
  const named = (name: string) =>
    list().find((item) => property(item, "name") === name) ?? missing(name);
  return new Proxy(() => list(), {
    get(target, key) {
      if (key === "length") return list().length;
      if (key === "byName") return named;
      if (key === "whose")
        return (filter: Filter) =>
          elements(() => list().filter((i) => matches(i, filter)), missing);
      if (typeof key === "string" && /^\d+$/.test(key)) {
        const item = list()[Number(key)];
        if (item === undefined) throw new Error("Invalid index.");
        return item;
      }
      return Reflect.get(target, key);
    },
  });
}

export class Jxa {
  readonly events: JxaEvent[] = [];
  readonly delays: number[] = [];
  readonly imports: string[] = [];
  readonly scene: Scene;
  readonly name: string;
  private entry: ((argv: string[]) => unknown) | undefined;

  private constructor(name: string, scene: Scene) {
    this.name = name;
    this.scene = scene;
  }

  // mini/ts/<name>.ts, types stripped.
  static source(name: string, scene: Scene = {}): Jxa {
    const file = path.join(REPO, "mini/ts", `${name}.ts`);
    return new Jxa(name, scene).load(file, stripTypeScriptTypes(fs.readFileSync(file, "utf8")));
  }

  // The committed mini/js/<name>.js.
  static compiled(name: string, scene: Scene = {}): Jxa {
    const file = path.join(REPO, "mini/js", `${name}.js`);
    return new Jxa(name, scene).load(file, fs.readFileSync(file, "utf8"));
  }

  private load(file: string, code: string): this {
    const context = vm.createContext(this.globals());
    new vm.Script(code, { filename: pathToFileURL(file).href }).runInContext(context);
    if (typeof context.run !== "function") throw new Error(`${file} defines no run()`);
    this.entry = context.run;
    return this;
  }

  // run(argv)'s value; throws what run throws.
  call(argv: string[] = []): unknown {
    return this.entry?.([...argv]);
  }

  // As osascript reports it: the value on stdout, or exit 1 and the error on stderr.
  osascript(argv: string[] = []): OsascriptResult {
    try {
      const value = this.call(argv);
      return { code: 0, stdout: value === undefined ? "" : `${String(value)}\n`, stderr: "" };
    } catch (err) {
      const message = err instanceof Object && "message" in err ? String(err.message) : String(err);
      const stderr = `${this.name}.js: execution error: Error: ${message} (-2700)\n`;
      return { code: 1, stdout: "", stderr };
    }
  }

  // Every keystroke's text, joined.
  typed(): string {
    return this.events.map((e) => (e.type === "keystroke" ? e.text : "")).join("");
  }

  private front(): string {
    return this.scene.front ?? "Finder";
  }

  private activate(app: string): void {
    this.events.push({ type: "activate", app });
    if (this.scene.activates !== false) this.scene.front = app;
  }

  private processes(): object[] {
    const listed = this.scene.processes ?? [];
    const all = listed.some((p) => p.name === this.front())
      ? listed
      : [...listed, { name: this.front() }];
    return all.map((p) => this.process(p));
  }

  private process(p: Process): object {
    const harness = this;
    const window = (w: Window) => ({
      name: () => w.name ?? null,
      buttons: elements(
        () =>
          (w.buttons ?? []).map((button) => ({
            name: () => button,
            click: () => harness.events.push({ type: "click", process: p.name, button }),
          })),
        (name) => {
          throw new Error(`Can't get button "${name}".`);
        },
      ),
      textFields: elements(
        () => (w.fields ?? []).map((f) => harness.field(f)),
        () => {
          throw new Error("Can't get text field.");
        },
      ),
    });
    const process = {
      name: () => p.name,
      exists: () => true,
      frontmost: () => harness.front() === p.name,
      backgroundOnly: () => p.backgroundOnly ?? false,
      get windows() {
        if (p.unreadable) throw new Error(`Can't get windows of ${p.name}.`);
        return elements(() => (p.windows ?? []).map(window));
      },
      attributes: elements(() => [
        { name: () => "AXFrontmost", value: () => harness.front() === p.name },
      ]),
    };
    // Read as a getter call (whose filters), set as a property (hiding the process).
    Object.defineProperty(process, "visible", {
      get: () => () => p.visible ?? true,
      set: (value: boolean) => {
        if (!value) harness.events.push({ type: "hide", process: p.name });
        p.visible = value;
      },
    });
    return process;
  }

  private field(f: Field): object {
    return {
      subrole: () => f.subrole ?? "",
      value: () => f.value ?? "",
      focused: () => f.focused ?? false,
    };
  }

  private keystroke(text: string): void {
    if (this.scene.keystrokeError !== undefined) throw new Error(this.scene.keystrokeError);
    this.events.push({ type: "keystroke", text });
    const proc = (this.scene.processes ?? []).find((p) => p.name === this.front());
    const field = proc?.windows?.[0]?.fields?.find((f) => f.focused);
    if (!field) return;
    const reach = field.accepts === undefined ? text : text.slice(0, field.accepts);
    if (field.accepts !== undefined) field.accepts -= reach.length;
    field.value = (field.value ?? "") + reach;
  }

  private terminal(): object {
    const tab = (t: Tab) => ({ history: () => t.history ?? "", contents: () => t.contents ?? "" });
    return {
      activate: () => this.activate("Terminal"),
      windows: elements(() =>
        (this.scene.terminal ?? []).map((w) => ({
          get selectedTab() {
            const selected = w.tabs[w.selected ?? 0];
            if (!selected) throw new Error("Can't get selected tab.");
            return tab(selected);
          },
          tabs: elements(() => w.tabs.map(tab)),
        })),
      ),
    };
  }

  private chrome(): object {
    const harness = this;
    return {
      activate: () => this.activate("Google Chrome"),
      windows: elements(() =>
        (this.scene.chrome ?? []).map((w, window) => ({
          tabs: elements(() =>
            w.tabs.map((t) => ({
              get url(): () => string {
                return () => t.url ?? "";
              },
              set url(url: string) {
                t.url = url;
              },
              execute: () => {
                if (t.javascriptError) throw new Error(t.javascriptError);
                const result = t.javascript?.[0] ?? "pending";
                if ((t.javascript?.length ?? 0) > 1) t.javascript?.shift();
                return result;
              },
              close: () => {
                harness.events.push({ type: "close", url: t.url ?? "" });
                w.tabs.splice(w.tabs.indexOf(t), 1);
              },
            })),
          ),
          set activeTabIndex(index: number) {
            harness.events.push({ type: "tab", window, index });
          },
          set index(_: number) {
            harness.events.push({ type: "raise", window });
          },
        })),
      ),
    };
  }

  private globals(): Record<string, unknown> {
    const scene = this.scene;
    const systemEvents = {
      processes: elements(() => this.processes()),
      keystroke: (text: string) => this.keystroke(text),
      keyCode: (code: number, options?: { using: string | string[] }) =>
        this.events.push(
          options === undefined ? { type: "keyCode", code } : { type: "keyCode", code, ...options },
        ),
    };
    const apps: Record<string, () => object> = {
      "System Events": () => systemEvents,
      Terminal: () => this.terminal(),
      "Google Chrome": () => this.chrome(),
    };
    return {
      Application: (name: string) => {
        const app = apps[name];
        if (!app) throw new Error(`the harness has no application ${name}`);
        return app();
      },
      delay: (seconds: number) => this.delays.push(seconds),
      ObjC: {
        import: (framework: string) => this.imports.push(framework),
        unwrap: (value: { string?: string }) => value.string,
      },
      $: {
        NSFileHandle: {
          fileHandleWithStandardInput: {
            get readDataToEndOfFile() {
              return { data: scene.stdin ?? "" };
            },
          },
        },
        NSString: {
          alloc: {
            initWithDataEncoding: (data: { data: string }, encoding: number) => {
              if (encoding !== 4) throw new Error(`unexpected encoding ${encoding}`);
              return { string: data.data };
            },
          },
        },
        NSUTF8StringEncoding: 4,
        CGPointMake: (x: number, y: number) => ({ x, y }),
        CGEventCreateMouseEvent: (_: null, event: number, point: { x: number; y: number }) => ({
          event,
          ...point,
        }),
        CGEventPost: (tap: number, e: { event: number; x: number; y: number }) => {
          if (tap !== CG.hidEventTap) throw new Error(`unexpected event tap ${tap}`);
          this.events.push({ type: "mouse", ...e });
        },
        kCGEventMouseMoved: CG.mouseMoved,
        kCGEventLeftMouseDown: CG.leftMouseDown,
        kCGEventLeftMouseUp: CG.leftMouseUp,
        kCGHIDEventTap: CG.hidEventTap,
      },
    };
  }
}
