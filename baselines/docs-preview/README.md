# Pages preview baseline

This image covers the repository documentation page served at `http://127.0.0.1:4173/`
with `configs/docs-preview.ci.json`: 1280 x 720 viewport, light theme, full-page capture.
It is separate from baselines used for other audit targets.

Captured on the Ubuntu GitHub Actions runner with its system Chrome from source
`ecf127aecedbf2138fb3b85fc4d1c83288b7f2a3` in
[run 34073173557](https://github.com/Jahrome907/web-quality-gatekeeper/actions/runs/34073173557).
The initial run intentionally failed because no baseline existed. Its PNG was reviewed
for complete page content, layout, and image loading before adoption. The checksum
manifest identifies that original, unmodified capture.

For intentional page changes, inspect the CI current and diff images before updating
this baseline. Keep the Linux capture environment consistent; a Windows screenshot
can differ because the page uses platform fonts. Never refresh it solely to clear a
failing comparison.
