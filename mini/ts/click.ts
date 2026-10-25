// click <x> <y>: a real mouse click (move, press, release) at that screen point.
ObjC.import("CoreGraphics");

const NUMBER = /^-?\d+(\.\d+)?$/;

function run(argv: string[]): string {
  if (argv.length !== 2 || !argv.every((arg) => NUMBER.test(arg))) {
    throw new Error("click: usage: click <x> <y>");
  }
  const point = $.CGPointMake(Number(argv[0]), Number(argv[1]));
  for (const type of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, point, 0));
    delay(0.08);
  }
  return "clicked";
}
