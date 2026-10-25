// The page harness: runs a mini/ts/page program's source (types stripped with their positions
// kept, so node's coverage maps to the TS lines), its committed mini/js/page program, or eval code
// as OpenCLI sends it, in a vm context whose document, window and location are fakes over a scene
// the test sets, recording every page event.
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as vm from "node:vm";
import { REPO } from "./repo.ts";

// An element matches exactly the selectors it lists.
export type Element = {
  selectors: string[];
  rect?: { left: number; top: number; width: number; height: number };
  value?: string;
  href?: string;
  id?: string;
  text?: string;
  attributes?: Record<string, string>;
};
export type Scene = {
  auth?: string;
  fetch?: { url?: string; ok?: boolean; error?: boolean };
  elements?: Element[];
  // The index in elements of the keyboard focus, and whether the page has it (default true).
  focus?: number;
  hasFocus?: boolean;
  href?: string;
  // The body's text; null: no body yet (a loading page).
  text?: string | null;
  window?: { screenX: number; screenY: number; outer: [number, number]; inner: [number, number] };
};
export type PageEvent =
  | { type: "fetch"; url: string; credentials: string; redirect: string }
  | { type: "scroll"; element: number; block: string | undefined }
  | { type: "click"; element: number }
  | { type: "navigate"; url: string }
  | { type: "alert"; text: string };

export type OpencliResult = { code: 0 | 1; stdout: string };

const WINDOW = { screenX: 0, screenY: 0, outer: [1440, 900], inner: [1440, 800] } as const;

export class Page {
  readonly events: PageEvent[] = [];
  readonly scene: Scene;
  private entry: ((...args: string[]) => unknown) | undefined;

  private constructor(scene: Scene) {
    this.scene = scene;
  }

  // mini/ts/page/<name>.ts, types stripped.
  static source(name: string, scene: Scene = {}): Page {
    const file = path.join(REPO, "mini/ts/page", `${name}.ts`);
    return new Page(scene).load(file, stripTypeScriptTypes(fs.readFileSync(file, "utf8")));
  }

  // The committed mini/js/page/<name>.js.
  static compiled(name: string, scene: Scene = {}): Page {
    const file = path.join(REPO, "mini/js/page", `${name}.js`);
    return new Page(scene).load(file, fs.readFileSync(file, "utf8"));
  }

  // Eval code as `o eval` sends it: its value.
  static run(code: string, scene: Scene = {}): { value: unknown; page: Page } {
    const page = new Page(scene);
    const value = new vm.Script(code).runInContext(vm.createContext(page.globals()));
    return { value, page };
  }

  private load(file: string, code: string): this {
    const context = vm.createContext(this.globals());
    const value: unknown = new vm.Script(code, { filename: pathToFileURL(file).href }).runInContext(
      context,
    );
    const entry = typeof value === "function" ? value : context.page;
    if (typeof entry !== "function") throw new Error(`${file} defines no page()`);
    this.entry = entry as (...args: string[]) => unknown;
    return this;
  }

  // page(...args)'s value; throws what page throws.
  call(...args: string[]): unknown {
    return this.entry?.(...args);
  }

  // As `opencli browser eval` reports it: the value as data, or exit 1 and the error.
  opencli(...args: string[]): OpencliResult {
    try {
      return {
        code: 0,
        stdout: `${JSON.stringify({ ok: true, data: this.call(...args) ?? null })}\n`,
      };
    } catch (err) {
      const message = err instanceof Object && "message" in err ? String(err.message) : String(err);
      const error = { code: "eval_error", message };
      return { code: 1, stdout: `${JSON.stringify({ ok: false, error })}\n` };
    }
  }

  private globals(): Record<string, unknown> {
    const scene = this.scene;
    const events = this.events;
    const list = scene.elements ?? [];
    const element = (i: number) => {
      const e = list[i] ?? { selectors: [] };
      return {
        value: e.value ?? "",
        href: e.href ?? "",
        id: e.id ?? "",
        innerText: e.text ?? "",
        getAttribute: (name: string) => e.attributes?.[name] ?? null,
        matches: (css: string) => e.selectors.includes(css),
        scrollIntoView: (opts?: { block?: string }) =>
          events.push({ type: "scroll", element: i, block: opts?.block }),
        getBoundingClientRect: () => e.rect ?? { left: 0, top: 0, width: 0, height: 0 },
        click: () => events.push({ type: "click", element: i }),
      };
    };
    const all = (css: string) =>
      list.flatMap((e, i) => (e.selectors.includes(css) ? [element(i)] : []));
    const w = scene.window ?? WINDOW;
    const location = {
      get origin() {
        return new URL(scene.href ?? "about:blank").origin;
      },
      get href() {
        return scene.href ?? "about:blank";
      },
      // As a browser does, an invalid URL throws.
      set href(url: string) {
        new URL(url);
        events.push({ type: "navigate", url });
      },
    };
    return {
      URL,
      get __miniAuth() {
        return scene.auth;
      },
      set __miniAuth(value: string | undefined) {
        scene.auth = value;
      },
      fetch: (url: string, options: { credentials: string; redirect: string }) => {
        events.push({ type: "fetch", url, ...options });
        if (scene.fetch?.error) return Promise.reject(new Error("secret request failed"));
        return Promise.resolve({
          ok: scene.fetch?.ok ?? true,
          url: scene.fetch?.url ?? "https://linear.app/workspace",
        });
      },
      document: {
        querySelector: (css: string) => all(css)[0] ?? null,
        querySelectorAll: (css: string) => all(css),
        hasFocus: () => scene.hasFocus ?? true,
        get activeElement() {
          return scene.focus === undefined ? null : element(scene.focus);
        },
        body: scene.text === null ? null : { innerText: scene.text ?? "" },
      },
      window: {
        screenX: w.screenX,
        screenY: w.screenY,
        outerWidth: w.outer[0],
        outerHeight: w.outer[1],
        innerWidth: w.inner[0],
        innerHeight: w.inner[1],
      },
      location,
      alert: (text: string) => events.push({ type: "alert", text: String(text) }),
    };
  }
}
