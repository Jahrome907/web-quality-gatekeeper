# Pages preview baseline

This image covers the repository documentation page served at `http://127.0.0.1:4173/`
with `configs/docs-preview.ci.json`: 1280 x 720 viewport, light theme, full-page capture.
It is separate from baselines used for other audit targets.

Captured on the Ubuntu GitHub Actions runner with its system Chrome from source
`eb49089afcf44cff62d87cdb5b18226ac53a7c4a` in
[run 34732884325](https://github.com/Jahrome907/web-quality-gatekeeper/actions/runs/34732884325).
The current-source wording adds one line of expected text reflow. The current and
diff images were reviewed for complete content, layout, and image loading before
adoption. The checksum manifest identifies the unmodified CI capture.

For intentional page changes, inspect the CI current and diff images before updating
this baseline. Keep the Linux capture environment consistent; a Windows screenshot
can differ because the page uses platform fonts. Never refresh it solely to clear a
failing comparison.
