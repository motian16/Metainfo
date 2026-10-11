Release assets for the MetaAudio subscription source.

**MetaAudio-Subscription.zip** — the single archive the app downloads when you tap
"Update subscription". It contains everything in one request:

- Meta (metadata) sources, taken from the upstream Lyrico-Plugins release:
  QQ Music 0.4.2 / NetEase Cloud Music 0.4.1 / Apple Music 0.4.1 / Kugou 0.4.1 / MusicBrainz 1.2.1
- Artist image sources (from this repo, `artistimage-src/`):
  com.metaaudio.artistimage.qq / netease / apple / kugou
- Tag recognition rules, merged into one file (rulesVersion {rulesVersion})

Layout inside the archive: `plugins/<plugin>.zip` + `rules/tag_rules.json`.
The subscription's `index.json` publishes the sha256 of the whole archive and of the
rules file inside it, and the app verifies both before installing anything.

The other four zip files are the individual artist image plugins. If the subscription
bundle cannot be downloaded (or fails its checksum), the app falls back to downloading
them one by one.

Subscription URL: `https://raw.githubusercontent.com/motian16/Metainfo/main/index.json`
