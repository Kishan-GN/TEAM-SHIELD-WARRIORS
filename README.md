# ARGUS-X | Local video intelligence

## Live people and objects

Open **Start-ARGUS-X.bat** → **Live detection**. The default view shows people and all built-in object categories, including books, cups, laptops, bottles, clocks and phones. **Show detections** filters the boxes. **Crowd & small-item scan** combines the full scene with four overlapping zoomed regions and uses a higher-resolution sample when the camera supplies one. Turn it off for a faster single pass. The outline follows the subject's actual dimensions and uses a medium stroke. The count distinguishes confirmed people from other objects.

**Wristwatches:** choose **Teach my watch**, drag a tight box around a visible watch face and strap on the frozen preview, and select **Use this reference**. This matches that appearance for the current source. Show the same side in similar lighting; tiny, rotated or obscured watches may be missed. Choose **All people and objects** to see other labels again. A clock is a separate built-in category.

With participant authorization, use persistent IDs for returns and cross-camera recovery. The first enrollment in an empty database is Person 1. Existing enrollments keep their actual numbers. A hidden track shows a last-seen time, and ambiguous observations remain under review. Saved test profiles from earlier versions are intentionally preserved.

## Entry photos and persistent person IDs

Open **Start-ARGUS-X.bat**, **Start-Live-Camera.bat**, or **Start-Analytics.bat**. All three open the local database workspace. Choose **Live detection**, confirm authorized capture, and enable **Participants agreed to entry photos and persistent IDs** for a session in which every participant has agreed. Start the camera. In this mode a confirmed first entry gets a database profile when there is no plausible existing match. A strong, well-separated return gets the same PERSON identifier. Uncertain cases go to review. The same option exists for an authorized upload.

The panel beside the camera shows the current entry photograph and the prior saved reference, its camera and timestamp, the appearance similarity percentage and the number of references searched. A first enrollment has no prior reference to display. Match history lets administrators reject an incorrect automatic link. Percentages are visual-similarity scores, not calibrated identification probabilities. The original Object finder is still available for session-only object tracking.

## Run the person analytics workspace on Windows

Extract the project folder, then open **Start-Analytics.bat**. The service uses Python 3.9+ on Windows and opens a private loopback address. Keep its terminal open. On first launch, choose a local administrator name and a password of at least ten characters. Use Chrome or Edge.

Open **Live detection**, enter a camera name, confirm authorized capture and select **Start camera**. Select **Save clip** before starting to preserve up to 60 seconds. Click a confirmed track to enroll a consenting participant. Optional one-to-one facial comparison requires separate consent. Use **Stop source** to finish a recording. Cross-video person search accepts authorized MP4 or WebM clips up to 32 MiB.

The **Object finder**, **Benchmark** and **Counter** remain available. The object finder and benchmark can run directly from their HTML files. Accounts, protected recordings and persistent profiles require the local analytics service.

## Configuration and data

Python creates the local SQLite tables on first run. Data is under your operating-system home directory in `.argus-x-studio`. Set `ARGUS_DATA_DIR` before starting to choose a different directory. Keep one service instance per data directory. Windows protects profile and video payloads using the current user's DPAPI. On Linux/macOS the service uses the Python cryptography package. Retention defaults to seven days. Administrators can set 1–90 days in Settings. Each person's consented profile persists until deleted.

The available project had no existing Flask, YOLO or MySQL service. This build retains COCO-SSD, the original JavaScript tracker and the local browser workflows. The new service uses standard-library Python and SQLite for a single-laptop deployment.

## Troubleshooting

- **No sign-in page.** Run the analytics launcher and use the address it opens. The presentation folder's HTML files alone cannot start the database service.
- **Camera blocked or busy.** Check browser camera permission, the Windows privacy shutter and other apps using the device. After granting permission, use List devices to select a second camera.
- **No candidate.** Confirm that a reference was enrolled, the person was visible for at least three sampled detections and the crop has enough detail. Try a short, well-lit video.
- **No face descriptor.** Use a large, front-facing, unobstructed face and explicitly confirm both consent controls. The enrollment remains body-only unless face consent and extraction succeed.
- **Missing original playback.** Enable recording before capture. Unrecorded and expired sessions have no video bytes.
- **Slow detection.** Inspect measured inference time and sample delay. Fewer cameras reduce contention on the shared worker.
- **Forgotten password.** There is no remote recovery service. Keep the local administrator credentials available to the authorized team.

## Hackathon pack

- [Technical architecture, API and five diagrams](docs/ENGINEERING.md)
- [Two-minute demo script and twenty judges’ questions](docs/DEMO-AND-JUDGES.md)
- [Acceptance tests and evidence](docs/TEST-RESULTS.md)
- [Presentation](docs/ARGUS-X-Presentation.pptx)

## Original object finder

## Start on your Windows laptop

Extract the entire ZIP. Open **Start-Live-Camera.bat** in the extracted folder. Keep the terminal open if the launcher uses Python. You can also open **index.html** directly in Chrome or Edge. The detector, its weights and the sample image are bundled. Camera frames and inference stay on your laptop.

## Use it at a workbench

1. Select **Start laptop camera** and allow camera access. The first run loads and warms the local model.
2. Point the webcam at a well-lit desk. Show a cup or bottle clearly, large enough to see. Stationary objects are eligible. A candidate gets a confirmed ID after three matched observations.
3. Choose **cup** in **Find a category** to reduce clutter. Select **Pin item** on the cup you want to follow. The card shows its ID, approximate position and detector confidence. A class score is a heuristic and is separate from identity matching.
4. Hide the cup behind a book for several seconds. Look for the card's last-seen location. Reveal the cup and check whether the history records recovery under the original ID. If its identity is ambiguous, ARGUS-X can withhold a match.
5. **Export JSON** saves the latest 350 events including timestamps, the pin and the recovery count. **Stop** releases the camera. Starting a new run resets the session.

If access is blocked, use the localhost launcher and check your browser's camera permission and Windows Settings → Privacy & security → Camera. If a label looks wrong, raise the detection threshold and try another angle. The model covers common COCO categories; unusual tools, keys and individual brands are outside its vocabulary. It can still make confident mistakes.

## How the finder addresses A05

| Requirement | Implementation in the live finder |
|---|---|
| Object detection | Bundled COCO-SSD Lite MobileNet v2 neural network estimates a class, bounding box and confidence from each sampled frame. The threshold is adjustable. |
| Motion estimation | Foreground-independent translation search over textured scene pixels plus smoothed velocity per track. This supports modest panning. |
| Data association | Hungarian assignment gates mismatched classes and compares position, size and a central-crop color histogram. |
| Identity memory | A confirmed track retains its label, velocity, size and appearance for up to 30 seconds since its last observation. |
| Re-identification | A compatible same-class observation can recover a missing track. Widely different appearance is rejected. |
| Confidence-aware tracking | Three matched observations confirm a track. Competing matches with a narrow score margin can appear as uncertain. The app logs confirmation, ambiguity and recovery. |

The frame rate depends on the laptop. Inference is serialized to avoid a backlog. Fast pans, big lighting changes, identical objects and a change in predicted class can break identity continuity. The app observes only the camera view. A last-seen position is historical evidence, not a location behind the obstruction.

## Live presentation

Open **Try cup demo** first. The model processes a real cup photograph, then the software covers the scene and reveals it again. This controlled trial is explicitly labeled a photo simulation. Next use your physical webcam, a real cup and a book. For a harder test, put a second similar cup on the desk and record wrong matches as well as successes. Benchmark scores below belong to the separate generated crate test.

**Counter** opens the original directional moving-region counter. **Benchmark** opens recorded-video analysis and the labeled crate test. The finder uses class labels; the counter and recorded-video benchmark use motion regions.

## Source and checks

The live finder uses `index.html`, `studio.css`, `studio.js` and the shared `tracker.js`. Local model files and attribution are in `assets/vision/`. Run `node tests/semantic.js` for class gating, delayed recovery, appearance rejection and memory expiry.

## Recorded video on Windows

1. Extract the entire ZIP. Open the extracted ARGUS-X folder.
2. Double-click **Start-ARGUS-X.bat** and select **Benchmark**, or open **benchmark.html** directly in Chrome or Edge. Keep the assets folder alongside the HTML.
3. Click **Run tracking**. In the 14-second generated clip, two similar crates cross behind a pillar while the camera pans. Watch their IDs before and after they disappear.
4. Click **Export session JSON** for per-frame boxes, match scores, ambiguous detections, events and demo evaluation. You can also export a paused run.
5. Use **Open video** for your own local MP4 or WebM. Codec support depends on the browser. **Load demo** restores the labeled trial.

No setup commands, accounts, model downloads, server, or API keys are required. To edit the project, open this whole folder in VS Code.

## Present it in 90 seconds

- Start the clip. Explain that the hard part is deciding whether a returning object already has an ID.
- Around 6–9 seconds, watch the pillar. Point out how a missing track stays in memory. When it reappears, compare its ID and the recovery event with its original label.
- After the run, show recall and ID switches. Recall asks how many sufficiently visible labeled object instances received a matching box. Switches count how often the assigned ID changed between matched observations of the same labeled object.
- Show your own second clip. Film two differently marked boxes crossing behind a chair, starting with a short view of the empty background. Try two identical boxes for a harder case. Vary the foreground threshold and restart to compare results.

## Benchmark implementation

| Stage | Implementation |
|---|---|
| Video input | Sequential timestamp sampling at 12 Hz. Frames preserve aspect ratio on a 320 × 180 analysis canvas. |
| Camera motion | Robust grayscale translation search against the background model. Search range is ±4 pixels horizontally and ±3 vertically per sample. |
| Detection | Adaptive RGB background subtraction, morphological opening, and connected-component filtering. |
| Motion and appearance | Smoothed center velocity, reference dimensions, and a 64-bin color histogram per identity. |
| Association | Hungarian minimum-cost assignment across all retained tracks and current detections, combining predicted displacement, size and appearance. |
| Recovery | Three matches confirm a track. Confirmed IDs stay available for 8 seconds after the last match. Reassociation after a gap over 0.4 s records a recovery. |
| Uncertainty | The association cost and margin between competing matches determine whether an observation receives an ID. Amber boxes flag ambiguous assignments. Match scores are heuristic, not calibrated probabilities. |

The tracker reads only pixels and timestamps. The benchmark labels are used separately after prediction. A recovery event describes the tracker's decision; on unlabeled uploads you must inspect it for correctness.

## Verify

With Node.js installed, run `node tests/association.js` in this folder. It checks ambiguous reappearances, distinct recoveries, expired memory and global assignment. With FFmpeg available on PATH, also run `node tests/benchmark.js` to decode the bundled MP4 through the tracking pipeline.

The reference MP4 test matched **256 of 260** sufficiently visible crate observations (**98.5% recall**), with **2 recoveries and 0 ID switches**. The evaluator requires at least 75% annotated visibility and box IoU of at least 0.35. These are results on one generated clip. Browser scaling and decoding can affect scores. The packaged browser demo uses a WebM edition of the same sequence for local compatibility.

Uploads have no ground truth. The dashboard leaves recall and ID switches blank for them. Increasing the threshold suppresses small background changes; decreasing it helps low-contrast objects.

## Scope and limitations

The benchmark and crossing counter use classical computer vision. It tracks moving regions without object-class labels or a trained re-identification model. Gradual panning and modest appearance changes are supported. Stationary objects, large camera jumps, rotation, scene cuts, extended merged silhouettes and indistinguishable objects can cause misses or wrong associations. The camera model handles translation only. The clip should be short enough for the browser to hold the session history. Match traces are exported in analysis-canvas coordinates.

## Source map

- `tracker.js` — detector, motion model, assignment, track memory and evaluator
- `app.js` — media input, controls, overlay, session export
- `index.html`, `style.css` — interface
- `assets/` — self-contained browser demo, MP4 test clip and ground truth
- `tools/make_demo.py` — reproduce the generated footage and labels with Python, Pillow and FFmpeg
- `tests/` — repeatable association checks and decoded-video benchmark
