"""Serve unchanged startup assets together, without caching public data.

The checked-in HTML and individual files stay authoritative. Only ordinary
head styles before its first inline style, and ordinary deferred head scripts,
are eligible. A missing or unsafe input leaves the original HTML untouched.
"""
from collections import OrderedDict
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
from threading import RLock

from flask import Response, abort, request


_LOCAL = re.compile(r"/static/([a-zA-Z0-9][a-zA-Z0-9_.-]*\.(css|js))(?:\?v=[a-zA-Z0-9_.-]+)?\Z")
_DIGEST = re.compile(r"[a-f0-9]{64}\Z")
_JS_UNSAFE = re.compile(r"\bdocument\s*\.\s*(?:currentScript|scripts|write|writeln)\b|\bimport\s*\.\s*meta\b")
_CSS_UNSAFE = re.compile(r"@(?:import|charset|namespace)\b", re.IGNORECASE)
_WORD = re.compile(r"[a-zA-Z_$][a-zA-Z0-9_$]*")
MAX_SOURCE_BYTES = 2_000_000
MAX_BUNDLE_BYTES = 4_000_000
MAX_HISTORY_BYTES = 8_000_000
MAX_GENERATIONS = 4


class _Tags(HTMLParser):
    """Record exact source spans; never serialize or rearrange other markup."""

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.lines = [0]
        self.html = html
        for match in re.finditer("\n", html):
            self.lines.append(match.end())
        self.head = False
        self.inline_style = False
        self.css, self.js = [], []
        self.pending_script = None
        self.blocked_defer = []
        self.blocked_css = []
        self.feed(html)
        self.close()

    def _position(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.head = True
            return
        if not self.head:
            return
        pairs = list(attrs)
        values = dict(pairs)
        # Duplicate attributes have browser-specific interpretations.
        unique = len(values) == len(pairs)
        if tag == "style":
            self.inline_style = True
        if tag == "link" and not self.inline_style and values.get("rel") == "stylesheet":
            match = _LOCAL.fullmatch(values.get("href", ""))
            if unique and set(values) == {"rel", "href"} and match and match[2] == "css":
                start = self._position()
                self.css.append((start, start + len(self.get_starttag_text()), match[1]))
            else:
                self.blocked_css.append(self._position())
        elif tag == "script" and "defer" in values and values.get("src"):
            match = _LOCAL.fullmatch(values["src"])
            start = self._position()
            if unique and set(values) == {"src", "defer"} and match and match[2] == "js":
                self.pending_script = (start, match[1])
            else:
                self.blocked_defer.append(start)

    def handle_endtag(self, tag):
        if tag == "head":
            self.head = False
        elif tag == "script" and self.pending_script is not None:
            start, filename = self.pending_script
            # Script end tags in the selected HTML are ordinary </script>.
            end = self._position()
            close = re.match(r"</script\s*>", self.html[end:], re.IGNORECASE)
            if close is None:
                raise ValueError("invalid_script_end")
            self.js.append((start, end + len(close[0]), filename))
            self.pending_script = None


def _safe_script(source):
    """Accept the site's expression/IIFE files, excluding shared global bindings.

    A lightweight lexer skips comments, strings, templates and regex literals
    while tracking expression depth. It is a conservative eligibility check,
    not a JavaScript parser or minifier. Original bytes are never rewritten.
    """
    if _JS_UNSAFE.search(source):
        return False
    index, depth, top, previous = 0, [], [], None
    length = len(source)
    regex_after = {None, "(", "[", "{", "=", ":", ",", ";", "?", "!", "&", "|",
                   "return", "throw", "case", "=>"}
    while index < length:
        char = source[index]
        if char.isspace():
            index += 1
            continue
        if source.startswith("//", index):
            end = source.find("\n", index + 2)
            index = length if end < 0 else end + 1
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            if end < 0:
                return False
            index = end + 2
            continue
        if char in "'\"`":
            quote = char
            if not depth:
                top.append("string")
            index += 1
            while index < length:
                if source[index] == "\\":
                    index += 2
                elif source[index] == quote:
                    index += 1
                    break
                else:
                    index += 1
            else:
                return False
            previous = "value"
            continue
        if char == "/" and previous in regex_after:
            index += 1
            bracket = False
            while index < length:
                current = source[index]
                if current == "\\":
                    index += 2
                    continue
                if current == "[":
                    bracket = True
                elif current == "]":
                    bracket = False
                elif current == "/" and not bracket:
                    index += 1
                    while index < length and source[index].isalpha():
                        index += 1
                    break
                elif current in "\r\n":
                    return False
                index += 1
            else:
                return False
            previous = "value"
            continue
        word = _WORD.match(source, index)
        token = word[0] if word else char
        if not depth:
            top.append(token)
            if token in {"let", "const", "class", "function", "var"}:
                return False
        if char in "([{":
            depth.append(char)
        elif char in ")]}":
            if not depth or depth.pop() != {")": "(", "]": "[", "}": "{"}[char]:
                return False
        index += len(token)
        previous = token
    meaningful = [token for token in top if token != ";"]
    return bool(not depth and meaningful and meaningful[0] in {"(", "window"})


def _safe_stylesheet(source):
    # Separate stylesheets tolerate a broken final comment/block independently;
    # concatenating one would consume or invalidate its successors. Keep the
    # original tags whenever delimiters do not balance outside strings/comments.
    if _CSS_UNSAFE.search(source):
        return False
    index, depth, length = 0, [], len(source)
    while index < length:
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            if end < 0:
                return False
            index = end + 2
            continue
        char = source[index]
        if char in "'\"":
            quote = char
            index += 1
            while index < length:
                if source[index] == "\\":
                    index += 2
                elif source[index] == quote:
                    index += 1
                    break
                else:
                    index += 1
            else:
                return False
            continue
        if char == "\\":
            index += 2
            continue
        if char in "([{":
            depth.append(char)
        elif char in ")]}":
            if not depth or depth.pop() != {")": "(", "]": "[", "}": "{"}[char]:
                return False
        index += 1
    return not depth


class StartupAssets:
    def __init__(self, rootpath):
        self.static = (Path(rootpath) / "static").resolve()
        self.index = Path(rootpath) / "index.html"
        self._lock = RLock()
        self._key = None
        self._html = None
        self._plan_digest = None
        self._plan = None
        self._history = OrderedDict()
        self._history_bytes = 0

    def _inputs(self, tags):
        inputs = []
        for _, _, filename in tags.css + tags.js:
            path = self.static / filename
            if path.resolve().parent != self.static:
                raise ValueError("unsafe_asset_path")
            stamp = path.stat()
            if not path.is_file() or not 0 < stamp.st_size <= MAX_SOURCE_BYTES:
                raise ValueError("invalid_asset_size")
            inputs.append((filename, stamp.st_mtime_ns, stamp.st_size))
        return tuple(inputs)

    def _remember(self, css, js):
        generation = tuple((kind, sha256(body).hexdigest(), body) for kind, body in (("css", css), ("js", js)) if body)
        key = tuple((kind, digest) for kind, digest, _ in generation)
        if key not in self._history:
            self._history[key] = generation
            self._history_bytes += sum(len(body) for _, _, body in generation)
        self._history.move_to_end(key)
        while len(self._history) > MAX_GENERATIONS or self._history_bytes > MAX_HISTORY_BYTES:
            _, oldest = self._history.popitem(last=False)
            self._history_bytes -= sum(len(body) for _, _, body in oldest)
        return {kind: f"/static/startup-{kind}-{digest}.{kind}" for kind, digest, _ in generation}

    def transform(self, html):
        if not isinstance(html, str):
            return html
        try:
            with self._lock:
                html_digest = sha256(html.encode("utf-8")).hexdigest()
                if html_digest != self._plan_digest:
                    self._plan = _Tags(html)
                    self._plan_digest = html_digest
                tags = self._plan
                if not tags.css and not tags.js:
                    return html
                # An unbundled deferred script between selected scripts would
                # run in a different order after consolidation. Keep originals.
                if tags.js and any(tags.js[0][0] < offset < tags.js[-1][0] for offset in tags.blocked_defer):
                    return html
                if tags.css and any(tags.css[0][0] < offset < tags.css[-1][0] for offset in tags.blocked_css):
                    return html
                inputs = self._inputs(tags)
                key = (html_digest, inputs)
                if key == self._key:
                    return self._html
                bodies = {}
                for filename, _, _ in inputs:
                    raw = (self.static / filename).read_bytes()
                    source = raw.decode("utf-8")
                    if filename.endswith(".css") and not _safe_stylesheet(source):
                        return html
                    if filename.endswith(".js") and not _safe_script(source):
                        return html
                    bodies[filename] = raw
                # A concurrent rewrite cannot publish an HTML/body mismatch.
                if inputs != self._inputs(tags):
                    return html
                css = b"\n".join(bodies[name] for _, _, name in tags.css)
                js = b"\n;\n".join(b"/* " + name.encode("ascii") + b" */\ntry {\n" + bodies[name] + b"\n} catch (error) { setTimeout(function () { throw error; }, 0); }\n" for _, _, name in tags.js)
                if len(css) + len(js) > MAX_BUNDLE_BYTES:
                    return html
                urls = self._remember(css, js)
                replacements = []
                for kind, spans in (("css", tags.css), ("js", tags.js)):
                    for number, (start, end, _) in enumerate(spans):
                        replacement = ""
                        if number == 0:
                            replacement = (f'<link rel="stylesheet" href="{urls[kind]}">' if kind == "css" else
                                           f'<script defer src="{urls[kind]}"></script>')
                        replacements.append((start, end, replacement))
                transformed = html
                for start, end, replacement in sorted(replacements, reverse=True):
                    transformed = transformed[:start] + replacement + transformed[end:]
                self._key, self._html = key, transformed
                return transformed
        except (OSError, UnicodeError, ValueError):
            # Do not turn unavailable optimization inputs into an empty page.
            return html

    def register(self, app):
        def serve(kind, digest, extension):
            if kind not in {"css", "js"} or kind != extension or not _DIGEST.fullmatch(digest):
                abort(404)
            with self._lock:
                body = next((body for generation in reversed(self._history.values())
                             for current, checksum, body in generation if current == kind and checksum == digest), None)
            if body is None:
                # Another serving worker may receive the asset after a peer
                # rendered the HTML. Build from the same local committed inputs.
                try:
                    self.transform(self.index.read_text(encoding="utf-8"))
                except (OSError, UnicodeError):
                    pass
                with self._lock:
                    body = next((body for generation in reversed(self._history.values())
                                 for current, checksum, body in generation if current == kind and checksum == digest), None)
            if body is None:
                abort(404)
            response = Response(body, mimetype="text/css" if kind == "css" else "application/javascript")
            response.cache_control.public = True
            response.cache_control.max_age = 31536000
            response.cache_control.immutable = True
            response.set_etag(digest)
            response.make_conditional(request)
            return response

        app.add_url_rule("/static/startup-<kind>-<digest>.<extension>", "startup_assets", serve, methods=["GET"])
