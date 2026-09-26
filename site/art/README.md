# site/art

What draws the images in `site/public/og/` (link-preview cards) and
`site/public/icons/file-*.png` (the icon a file wears once lint.one opens
it). Nothing here is deployed.

```sh
python3 site/art/serve.py            # serves the repo on localhost:8767
# then, in a browser:
http://localhost:8767/site/art/render.html?jobs=og:parquet,icon:parquet,home
```

`render.html` draws each job on a canvas with the site's own font and
glyphs and posts it to `serve.py`, which writes it into `site/public`. Give
`serve.py` another directory to write somewhere else first and compare.

A new tool is one entry in `TOOLS` (its hue, and the two lines of its card)
and, for the home card, one in `SUITE`. The layout was measured from the
earlier cards: redrawn, they match them to within a pixel.
