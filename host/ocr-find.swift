// ocr-find.swift — Vision OCR utility.
//  ocr-find <img> <label|label|...>   → "x,y" center of the matched affirmative button (exact match preferred). Exit 1 if none found.
//  ocr-find <img> --has "<substr>"    → Exit 0 if that text is on screen, 1 otherwise (for dialog detection).
//  ocr-find <img> --dump              → All recognized text + coordinates (debug).
import Foundation
import Vision
import AppKit

let A = CommandLine.arguments
guard A.count >= 3 else {
    FileHandle.standardError.write("usage: ocr-find <image> <labels|--has TEXT|--dump>\n".data(using: .utf8)!)
    exit(2)
}
let imgPath = A[1]
guard let img = NSImage(contentsOfFile: imgPath),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image\n".data(using: .utf8)!); exit(3)
}
let W = CGFloat(cg.width), H = CGFloat(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["en-US", "ko-KR"]
req.usesLanguageCorrection = false
do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch {
    FileHandle.standardError.write("ocr failed\n".data(using: .utf8)!); exit(4)
}
let results = req.results ?? []
let items: [(String, VNRecognizedTextObservation)] = results.compactMap { o in
    guard let c = o.topCandidates(1).first else { return nil }
    return (c.string.lowercased().trimmingCharacters(in: .whitespaces), o)
}
func center(_ o: VNRecognizedTextObservation) -> String {
    let b = o.boundingBox
    return "\(Int((b.midX * W).rounded())),\(Int(((1.0 - b.midY) * H).rounded()))"
}

let mode = A[2]
if mode == "--dump" {
    for (t, o) in items { print("\(center(o))\t\(t)") }
    exit(0)
}
if mode == "--has" {
    guard A.count >= 4 else { exit(2) }
    let needle = A[3].lowercased().trimmingCharacters(in: .whitespaces)
    for (t, _) in items where t.contains(needle) { exit(0) }
    exit(1)
}
// label → coordinates (affirmative button)
let labels = mode.lowercased().split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
for (t, o) in items where labels.contains(t) { print(center(o)); exit(0) }      // exact match preferred
for (t, o) in items where t.count <= 20 { for l in labels where t.contains(l) { print(center(o)); exit(0) } }
exit(1)
