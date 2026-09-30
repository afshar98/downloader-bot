# yt-dlp operations

The bot uses yt-dlp only to read metadata for a validated public X/Twitter status. It never asks
yt-dlp to download media; media bytes go through the application’s bounded safe HTTP downloader.

## Deployment pinning

- Install a reviewed yt-dlp release or a controlled build in the deployment image.
- Set `YT_DLP_PATH` to the trusted executable and record its version, source, and checksum or
  signature in deployment records when the release channel provides one.
- Set `YT_DLP_EXPECTED_VERSION` to the exact output from the approved executable's `--version`
  command. Startup fails before polling if the installed executable reports a different value.
- Review security releases and X extractor changes before upgrading. Update the recorded artifact
  deliberately and rerun the deterministic provider/process fixtures.
- Startup runs `yt-dlp --version` and fails closed when the executable cannot run or its version
  differs from the approved setting. Runtime
  self-updates, plugins, remote components, caller-selected extractors, and caller-supplied options
  are disabled.
- Review yt-dlp’s license and notices for the exact artifact and distribution model you deploy.
  Include required notices in the deployment image or distribution package.

## Optional live-provider smoke test

Normal tests are deterministic and make no live X or Telegram requests. After the normal gates pass,
an operator may run the bot with a test token and manually check a public, authorized post. Keep live
post identifiers out of mandatory test fixtures and logs. Confirm shutdown removes temporary files.
