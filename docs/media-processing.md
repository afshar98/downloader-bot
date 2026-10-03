# Media processing

The bot preserves audio-bearing MP4 representations and converts to GIF only when the provider
reports confirmed silence. Missing or conflicting audio evidence stays on the video path.
Conversion uses a fixed FFmpeg profile, writes only inside the request workspace, enforces output
and runtime caps, and decodes the finished GIF before Telegram delivery.

## FFmpeg installation and pinning

Install an approved FFmpeg build through the deployment's normal package or artifact process.
Record its provenance, integrity information where available, and applicable notices. Configure
`FFMPEG_PATH` to that executable and `FFMPEG_EXPECTED_VERSION` to the approved first version token
shown by `ffmpeg -version`. Startup checks this token before polling. The bot does not download,
self-update, or select a binary from user input.

FFmpeg's per-allocation guard is not a total resident-memory limit. Provision enough memory for
decoded frames and filter buffers in addition to bounded media files and process output.

## Controlled conversion lane

The regular `npm test` suite does not require FFmpeg. Exercise conversion and delivery with the
checked-in synthetic silent MP4 fixture by running the explicit lane with the approved local binary
and its version token:

```bash
FFMPEG_PATH=/trusted/bin/ffmpeg FFMPEG_EXPECTED_VERSION=approved-token npm run test:ffmpeg
```

The lane fails if configuration is missing or the version differs; it does not silently skip. It
converts and decodes the fixture, then checks that Telegram receives the generated GIF rather than
the source MP4. It uses no X, Telegram service, or network access.
