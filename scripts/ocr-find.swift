// ocr-find.swift — Vision OCR 유틸.
//  ocr-find <img> <label|label|...>   → 매칭 긍정버튼 중심 "x,y" (exact 우선). 없으면 exit 1.
//  ocr-find <img> --has "<substr>"    → 화면에 그 텍스트 있으면 exit 0, 없으면 1 (다이얼로그 감지용).
//  ocr-find <img> --dump              → 인식된 모든 텍스트+좌표 (디버그).
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
// 라벨 → 좌표 (긍정버튼)
let labels = mode.lowercased().split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
for (t, o) in items where labels.contains(t) { print(center(o)); exit(0) }      // exact 우선
for (t, o) in items where t.count <= 20 { for l in labels where t.contains(l) { print(center(o)); exit(0) } }
exit(1)
