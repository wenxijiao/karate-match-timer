import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for (label, size) in [("16x16",16),("16x16@2x",32),("32x32",32),("32x32@2x",64),("128x128",128),("128x128@2x",256),("256x256",256),("256x256@2x",512),("512x512",512),("512x512@2x",1024)] {
    let representation = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: representation)
    let s = CGFloat(size)
    let box = NSRect(x: s * 0.055, y: s * 0.055, width: s * 0.89, height: s * 0.89)
    let background = NSBezierPath(roundedRect: box, xRadius: s * 0.21, yRadius: s * 0.21)
    NSColor(calibratedRed: 0.085, green: 0.12, blue: 0.055, alpha: 1).setFill(); background.fill()
    let accent = NSColor(calibratedRed: 0.86, green: 0.96, blue: 0.55, alpha: 1)
    let ring = NSBezierPath(ovalIn: NSRect(x: s * 0.225, y: s * 0.245, width: s * 0.55, height: s * 0.55))
    ring.lineWidth = s * 0.035; accent.setStroke(); ring.stroke()
    let hands = NSBezierPath()
    hands.move(to: NSPoint(x: s * 0.5, y: s * 0.52)); hands.line(to: NSPoint(x: s * 0.5, y: s * 0.695))
    hands.move(to: NSPoint(x: s * 0.5, y: s * 0.52)); hands.line(to: NSPoint(x: s * 0.64, y: s * 0.45))
    hands.lineWidth = s * 0.035; hands.lineCapStyle = .round; hands.stroke()
    let cap = NSBezierPath(roundedRect: NSRect(x: s * 0.425, y: s * 0.825, width: s * 0.15, height: s * 0.04), xRadius: s * 0.012, yRadius: s * 0.012)
    accent.setFill(); cap.fill()
    if size >= 64 {
        let text: NSString = "02:00"
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: s * 0.105, weight: .semibold), .foregroundColor: accent]
        let measure = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (s - measure.width) / 2, y: s * 0.135), withAttributes: attributes)
    }
    NSGraphicsContext.restoreGraphicsState()
    let data = representation.representation(using: .png, properties: [:])!
    try data.write(to: directory.appendingPathComponent("icon_\(label).png"))
}
