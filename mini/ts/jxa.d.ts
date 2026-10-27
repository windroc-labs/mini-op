// The JXA globals (osascript -l JavaScript) the programs in mini/ts use, and no more. An element
// collection is callable for its items, indexable and filterable; a property is a getter call; a
// settable property is a setter.

type JxaFilter = Record<string, unknown>;

interface JxaElements<T> {
  (): T[];
  readonly [index: number]: T;
  readonly length: number;
  byName(name: string): T;
  whose(filter: JxaFilter): JxaElements<T>;
}

interface JxaUIElement {
  name(): string | null;
  value(): string;
  subrole(): string;
  focused(): boolean;
  click(): void;
  readonly attributes: JxaElements<JxaAttribute>;
}

interface JxaAttribute {
  value(): unknown;
}

interface JxaWindow {
  name(): string | null;
  readonly buttons: JxaElements<JxaUIElement>;
  readonly textFields: JxaElements<JxaUIElement>;
}

interface JxaProcess {
  name(): string;
  exists(): boolean;
  set visible(value: boolean);
  get visible(): () => boolean;
  readonly windows: JxaElements<JxaWindow>;
  readonly attributes: JxaElements<JxaAttribute>;
}

interface JxaSystemEvents {
  readonly processes: JxaElements<JxaProcess>;
  keystroke(text: string): void;
  keyCode(code: number, options?: { using: string | string[] }): void;
}

interface JxaTerminalTab {
  history(): string;
  contents(): string;
  tty(): string;
}

interface JxaTerminalWindow {
  readonly selectedTab: JxaTerminalTab;
  readonly tabs: JxaElements<JxaTerminalTab>;
}

interface JxaTerminal {
  activate(): void;
  readonly windows: JxaElements<JxaTerminalWindow>;
}

interface JxaChromeTab {
  get url(): () => string;
  set url(value: string);
  execute(options: { javascript: string }): string;
  close(): void;
}

interface JxaChromeWindow {
  readonly tabs: JxaElements<JxaChromeTab>;
  set activeTabIndex(index: number);
  set index(index: number);
}

interface JxaChrome {
  activate(): void;
  readonly windows: JxaElements<JxaChromeWindow>;
}

declare function Application(name: "System Events"): JxaSystemEvents;
declare function Application(name: "Terminal"): JxaTerminal;
declare function Application(name: "Google Chrome"): JxaChrome;

declare function delay(seconds: number): void;

// An Objective-C object handed out by the bridge.
interface ObjCObject {
  readonly __objc?: never;
}

declare const ObjC: {
  import(framework: string): void;
  unwrap(value: ObjCObject): unknown;
};

declare const $: {
  NSFileHandle: { fileHandleWithStandardInput: { readonly readDataToEndOfFile: ObjCObject } };
  NSString: { alloc: { initWithDataEncoding(data: ObjCObject, encoding: number): ObjCObject } };
  NSUTF8StringEncoding: number;
  CGPointMake(x: number, y: number): ObjCObject;
  CGEventCreateMouseEvent(
    source: null,
    type: number,
    point: ObjCObject,
    button: number,
  ): ObjCObject;
  CGEventPost(tap: number, event: ObjCObject): void;
  kCGEventMouseMoved: number;
  kCGEventLeftMouseDown: number;
  kCGEventLeftMouseUp: number;
  kCGHIDEventTap: number;
};
