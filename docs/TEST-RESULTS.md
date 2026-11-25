# Verification record

Tests used a temporary Linux workspace, a Chromium-based Qt WebEngine browser, local inference on a CPU, a generated webcam signal and a portrait fixture. The project archive contains no participant records, passwords or test enrollment database.

| Acceptance case | Actual check and result |
|---|---|
| 1. A first participant receives an ID | Browser upload produced a confirmed person track. Enrollment created the first persistent person row. |
| 2. Return after 30 minutes | An integration test injected a second timestamp 30 minutes later after restarting the service. It produced a pending candidate, and verification linked it to the original row. No physical 30-minute trial was performed. |
| 3. Similar clothing, different person | Two synthetic embeddings orthogonal to the saved reference and identical clothing vectors produced no candidates. This tests the gate and does not measure population accuracy. |
| 4. Multiple people | Two copies of a portrait at distinct positions yielded two simultaneously confirmed boxes on each of two concurrent virtual streams. |
| 5. Occlusion | The association test retained two tracks, withheld a midpoint candidate, recovered the original IDs on disambiguation and expired stale memory. The generated crate benchmark yielded 256/260 visible matches, two recoveries and zero switches. |
| 6. Cross-video search | Indexed the same labeled test clip in two separate sessions; the second produced a pending candidate. The test then verified the link and opened the original recording. |
| 7. Unknown fallback | The synthetic appearance test produced no match for unrelated features. Zero results are permitted. |
| 8. Restart | Closed the service and reopened it against the same temporary directory. The profile persisted; a new login was required. |
| 9. Recording and seek | A virtual webcam session created a nonempty video. Indexed footage was served through the authenticated endpoint and the browser sought to 0.4 s. |
| 10. Multiple camera streams | Two independent virtual streams each processed at least four samples, both showing two boxes. Actual laptop-camera performance remains to be measured on the presenting laptop. |
| 11. Navigation and controls | Opened all twelve views in the browser. Exercised capture, recording, stop, upload, directory data, review, playback and enrollment. Full device-specific UI and print-dialog coverage remains open. |
| 12. Consent, access and deletion | API tests rejected missing enrollment consent, denied viewer deletion, allowed admin deletion and checked that the encrypted profile payload did not contain descriptor text. Browser face-model smoke check extracted a 128-value reference from one portrait. |

Other tested behavior includes idempotent appearance insertion, retention expiry, audit alerts, aggregate occupancy storage, class gating and shape/color disambiguation. Repeatable tests are in tests/platform_test.py, tests/semantic.js, tests/association.js and tests/benchmark.js. The node benchmark uses FFmpeg.

Limits of verification include native Windows DPAPI, physical Windows devices, performance on the team's laptop, long real-world field sequences and security review for deployment outside one trusted local account. The implementation is a working local prototype.

## Entry-photo regression
A browser test supplied a portrait through a virtual camera, removed it from the stream, then restored it. It repeated the appearance in a second virtual camera session. The persistent-ID workflow stored three entries with one person ID, and both photos in the return panel decoded successfully. These repeated images exercise identity plumbing. They do not measure recognition accuracy under a change in lighting or pose.
The new tests in tests/gallery_test.py cover restart, request retries, consent, concurrent occupancy conflicts, competing candidates, a distinct new vector, and a full search across 3,000 synthetic stored references. The scale fixture measures retrieval work, not demographic or identification accuracy.

## Crowd and object regression

A browser test sent a controlled two-row, four-column montage of portrait instances into the live camera pipeline. The detector and tracker confirmed eight boxes numbered 1 through 8. A separate clip sequence switched to a cup photograph and a labeled close-up of a book; both requested object classes appeared alongside other predictions. Some unzoomed scenes containing small books were missed. In the return test, a portrait disappeared completely and reappeared at a shifted position. The backend recovered PERSON-001. Crowded natural scenes with tiny or partially visible people still produced missed detections.

Run tests/crowd_objects.js for eight moving tracks, occlusion recovery, a taught reference-pattern match and blank-frame rejection. Similarity scores describe appearance. They do not establish identity or detector accuracy across all 80 object categories.
