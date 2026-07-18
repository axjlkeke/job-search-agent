import Foundation
import ImageIO
import Vision

private func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

guard CommandLine.arguments.count == 2 else {
    fail("usage: tokensoff-vision-ocr <image-path|->", code: 64)
}

let source: CGImageSource?
if CommandLine.arguments[1] == "-" {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    source = CGImageSourceCreateWithData(data as CFData, nil)
} else {
    let imageURL = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
    source = CGImageSourceCreateWithURL(imageURL, nil)
}

guard
    let source,
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    fail("image could not be decoded", code: 65)
}

private func recognize(_ image: CGImage) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    request.minimumTextHeight = max(
        0.0002,
        min(0.002, 8.0 / Float(max(image.height, 1)))
    )
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    // Vision uses a bottom-left normalized coordinate system. Sort by row from
    // top to bottom, then from left to right within each cropped tile.
    let observations = (request.results ?? []).sorted { left, right in
        let verticalDistance = abs(left.boundingBox.midY - right.boundingBox.midY)
        if verticalDistance < 0.004 {
            return left.boundingBox.minX < right.boundingBox.minX
        }
        return left.boundingBox.midY > right.boundingBox.midY
    }
    return observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
}

// Very tall posters can exceed Vision's practical layout range and return only
// one or two labels. Process bounded, slightly overlapping vertical tiles so
// small body text remains detectable. Exact overlap duplicates are removed.
let tileHeight = 3_000
let overlap = 80
var y = 0
var recognizedLines: [String] = []
do {
    while y < image.height {
        let height = min(tileHeight, image.height - y)
        let rectangle = CGRect(x: 0, y: y, width: image.width, height: height)
        guard let tile = image.cropping(to: rectangle) else {
            fail("image tile could not be decoded", code: 65)
        }
        for line in try recognize(tile) where recognizedLines.last != line {
            recognizedLines.append(line)
        }
        if y + height >= image.height {
            break
        }
        y += height - overlap
    }
} catch {
    fail("recognition failed: \(error)", code: 70)
}

for line in recognizedLines {
    print(line)
}
