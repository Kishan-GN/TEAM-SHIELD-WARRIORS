# Two-minute demonstration

Use consenting teammates and a short pre-authorized clip of one teammate. Before the pitch, create the local account, test the actual camera, and stage an enrolled reference recording. To stage it, enable clip saving, have the participant stand in view, select the confirmed track, record consent and enroll, then stop the camera so the clip is finalized. Avoid face enrollment unless the teammate separately agrees.

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Overview and live detection | “Our task is to keep track of a person across interruptions. The preview plays continuously. Each box has a temporary track number, a detector score and a clothing estimate.” |
| 0:20–0:40 | Have a teammate step behind an obstacle and return | “Watch the original track and the uncertain state when two observations compete. A short gap is handled in session memory.” If it fails, explain what changed in the frame. |
| 0:40–1:05 | Open the enrolled profile and its reference clip | “This durable ID exists because the participant enrolled. Their camera history points back to the footage.” |
| 1:05–1:35 | Index the second short clip or open its indexed result | “A body descriptor and clothing evidence propose a candidate. I can jump to the appearance and its reference before verifying or rejecting it.” |
| 1:35–1:50 | Verify after checking both clips; open the timeline | “The review links this appearance across sessions. The score is a similarity measure.” |
| 1:50–2:00 | Open health or reports | “These are measured timings and observed events. Each clip has a retention period and can be deleted.” |

If the camera is unavailable, use an authorized local clip in Cross-video person search. Label this as recorded footage. The original Object finder also retains its generated occlusion exercise and crate benchmark.

# Twenty judges’ questions

1. **Which problem are you solving?** A human reviewer needs to locate the same consenting participant in fragmented footage without treating every lookalike as a confirmed identity.
2. **What distinguishes the two IDs?** A track number belongs to one source session. An enrolled person ID is a durable database row.
3. **Where do the models run?** In the browser on the host laptop. The Python service stores records and evaluates candidate descriptors locally.
4. **Which model detects people?** The existing COCO-SSD Lite MobileNet v2 detector. We retained the bundled weights and reused an intermediate activation for appearance search.
5. **What happens during occlusion?** Motion prediction, size and appearance guide reassociation with retained tracks. Close alternatives can leave identity unresolved.
6. **What happens after half an hour?** Temporary track memory has expired. An authorized observation can be compared against a persistent profile and presented for review.
7. **What if two people wear the same shirt?** Color is only one feature. The learned representation contributes most of the score; a reviewer still decides. Similar clothing can still produce wrong candidates.
8. **Does the score mean probability?** No. It is an uncalibrated similarity index. Detector confidence and face distance are separate measures.
9. **Can clothing changes be handled?** An enrolled face comparison may provide extra evidence with consent. Large appearance changes can also yield no body candidate.
10. **How is facial consent handled?** The operator records explicit enrollment consent and separate face consent. Later facial comparison is limited to one selected enrollment and requires confirmation again.
11. **Does it recognize an unknown face across all recordings?** Face processing is restricted to a selected participant and a single enrolled reference. Body search uses enrolled profiles and produces review candidates.
12. **How do I inspect the evidence?** Open candidate and original recording segments at their saved offsets. Unrecorded reference sessions have no replay link.
13. **How is the live preview kept responsive?** Browser video playback is separate from the worker. Each source has at most one pending inference request.
14. **How many cameras can it handle?** The interface permits up to three concurrent sources. Two virtual streams were exercised together. Physical camera throughput depends on drivers and hardware.
15. **How is a recording protected?** The service encrypts its media files outside the web root and checks a local session before playback.
16. **What do the heatmap and alerts measure?** The heatmap counts sampled person centers. Zone entry, occupancy, verified participant presence and camera faults have explicit rules.
17. **How do you measure performance?** Capture FPS, inference elapsed time and sample-to-result delay are separate. System health also shows disk capacity and CPU/RAM where measured.
18. **Who would use this?** A controlled training lab or filmed experiment with consenting participants, short retention and a reviewer who needs a searchable timeline.
19. **What evidence supports the demo?** The tests cover storage, restart, authorization, ambiguity, video indexing, playback and virtual cameras. The shipped test report separates fixture results from unmeasured field accuracy.
20. **What would you validate before a larger rollout?** Measure false matches and missed candidates on representative, consented data; test wardrobe and lighting changes, actual camera latency, retention and production access controls.
