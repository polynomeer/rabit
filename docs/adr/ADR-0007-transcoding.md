# ADR-0007: ffmpeg/ffprobe transcoding in an isolated worker

- Status: Accepted (tooling; production isolation on AWS Fargate since 2026-10-05, ADR-0012)
- Date: 2026-10-04
- Source topic: AP ADR-04 (part)
- Related: AUD-008, AUD-011..014, NFR-SEC-003, PB Phase 9

## Context
Uploaded media is untrusted. Decoders are a classic exploit surface (AP-08: decoder 취약점, zip bomb).

## Options
1. **ffmpeg/ffprobe CLI invoked by the worker** with strict arguments and resource limits
2. Managed transcoding service (cloud media converter)
3. Pure JS/WASM decoders

## Decision
- Use ffprobe for container/codec/duration inspection and ffmpeg for HLS packaging, loudness measurement (EBU R128 / `ebur128`) and waveform peak extraction.
- Process hardening (implemented): input from local temp file only, `-protocol_whitelist file,pipe`, `-nostdin`, no network inputs, fixed allow-list of input formats/codecs, wall-clock timeout, max output size, `-threads` cap, kill process group on timeout, temp dir wiped after each job.
- Magic-byte sniffing before ffprobe; declared MIME is never trusted.
- **Production isolation is Proposed**: run the worker in a separate container with no network egress except object storage, read-only root FS, seccomp/gVisor, cgroup CPU/memory limits. This depends on the hosting decision (ADR-0012).

## Production isolation (2026-10-05, follows ADR-0012)
- The worker is its own ECS service on Fargate; each task runs in its own micro-VM, which is the isolation boundary (gVisor/seccomp profiles are not configurable on Fargate).
- Isolated subnets with no internet route: S3 through a gateway endpoint, ECR, CloudWatch Logs, Secrets Manager and KMS through interface endpoints; its security group allows egress only to those endpoints and the database.
- Read-only root file system with a size-limited scratch volume for `/tmp`; non-root user; no privileged mode or added Linux capabilities; CPU and memory limits per task.
- Its IAM role can read quarantine and originals, write originals and media, and use the KMS key; nothing else.

## Consequences
ffmpeg version is recorded per derivative (`tool_version`) for reproducibility (AUD-012).

## Revisit trigger
CVE in the ffmpeg build in use; managed service becomes cheaper at measured volume.
