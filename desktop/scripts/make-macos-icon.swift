import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 3,
      let source = NSImage(contentsOfFile: arguments[1]) else {
  fputs("usage: make-macos-icon.swift input.png output.png\n", stderr)
  exit(2)
}

let size = NSSize(width: 1024, height: 1024)
let output = NSImage(size: size)
output.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
// macOS icons need a visual safe area. Without this inset the dark brand mark
// touches the Dock cell and looks noticeably larger than neighboring apps.
let frame = NSRect(x: 76, y: 76, width: 872, height: 872)
let path = NSBezierPath(roundedRect: frame, xRadius: 192, yRadius: 192)
path.addClip()
source.draw(in: frame)
output.unlockFocus()

guard let tiff = output.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("failed to render icon\n", stderr)
  exit(1)
}
try png.write(to: URL(fileURLWithPath: arguments[2]))
