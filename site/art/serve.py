#!/usr/bin/env python3
"""Serves the repository for render.html and saves what it draws.

    python3 site/art/serve.py [out-dir]      # then open localhost:8767/site/art/render.html

GET serves files from the repository root, so the page can load the shared
fonts and glyphs. POST /save?path=og/parquet.png writes the body under
out-dir (site/public by default). Only og/*.png and icons/*.png are accepted.
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'site', 'public')
SAFE = re.compile(r'^(og|icons)/[a-z0-9-]+\.png$')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        url = urlparse(self.path)
        path = (parse_qs(url.query).get('path') or [''])[0]
        if url.path != '/save' or not SAFE.match(path):
            self.send_error(400, 'expected /save?path=og/<name>.png or icons/<name>.png')
            return
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        dest = os.path.join(OUT, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(body)
        print('saved', dest, len(body), 'bytes')
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    print('serving', ROOT, '-> saving to', OUT)
    ThreadingHTTPServer(('127.0.0.1', 8767), Handler).serve_forever()
