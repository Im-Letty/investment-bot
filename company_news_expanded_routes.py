"""Curated issuer RSS additions; importing grants no unregistered URL access."""
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

PATH = Path(__file__).resolve().parent / 'static/company-news-expanded-routes.json'
MAX_ROUTES = 194


def registered_routes(document):
    if (not isinstance(document, dict) or type(document.get('schema_version')) is not int
            or document.get('schema_version') != 1
            or not isinstance(document.get('items'), list)
            or len(document['items']) > MAX_ROUTES):
        raise ValueError('company_expanded_routes_invalid')
    result, symbols, ids = {}, set(), set()
    for row in document['items']:
        if not isinstance(row, dict):
            raise ValueError('company_expanded_routes_invalid')
        symbol, name, issuer, cid = (row.get(k) for k in ('symbol', 'name', 'issuer', 'company_id'))
        if (not isinstance(symbol, str) or not re.fullmatch(r'[1-9][0-9A-Z]{3}\.T', symbol)
                or any(not isinstance(v, str) or not 1 <= len(v) <= 100
                       or v != v.strip() or any(ord(c) < 32 or ord(c) == 127 for c in v)
                       for v in (name, issuer))
                or not isinstance(cid, str) or not re.fullmatch(r'[1-9][0-9]{0,8}', cid)
                or symbol in symbols or cid in ids
                or row.get('status') != 'verified_issuer_rss_route'
                or row.get('parent_issuer_identity_verified') is not True
                or row.get('explicit_rss_link_verified') is not True
                or not isinstance(row.get('evidence_sha256'), str)
                or not re.fullmatch(r'[0-9a-f]{64}', row.get('evidence_sha256', ''))):
            raise ValueError('company_expanded_routes_invalid')
        release, feed = row.get('release_url'), row.get('feed_url')
        expected_feed = 'https://prtimes.jp/companyrdf.php?company_id=' + cid
        try:
            parsed = urlsplit(release)
            match = re.fullmatch(r'/main/html/rd/p/[0-9]{9}\.([0-9]{9})\.html', parsed.path)
            if (parsed.scheme != 'https' or parsed.netloc != 'prtimes.jp'
                    or parsed.query or parsed.fragment or not match
                    or str(int(match[1])) != cid or feed != expected_feed):
                raise ValueError('company_expanded_routes_invalid')
        except (ValueError, TypeError, AttributeError):
            raise ValueError('company_expanded_routes_invalid') from None
        label = 'PR TIMES / ' + name
        if label in result:
            raise ValueError('company_expanded_routes_invalid')
        header_labels = row.get('verified_header_labels', [])
        header_evidence = row.get('verified_header_labels_evidence_sha256')
        if (not isinstance(header_labels, list) or len(header_labels) > 3
                or any(not isinstance(v, str) or not 1 <= len(v) <= 100
                       or v != v.strip() or any(ord(c)<32 or ord(c)==127 for c in v)
                       or '<' in v or '>' in v for v in header_labels)
                or len(set(header_labels)) != len(header_labels)
                or (header_labels and (not isinstance(header_evidence, str)
                    or not re.fullmatch(r'[0-9a-f]{64}', header_evidence)))):
            raise ValueError('company_expanded_routes_invalid')
        result[label] = dict(company_id=cid, symbol=symbol, name=name, issuer=issuer,
                             expansion_route=True, verified_header_labels=tuple(header_labels))
        symbols.add(symbol); ids.add(cid)
    return result


def _read_routes():
    try:
        if PATH.stat().st_size > 300_000:
            raise ValueError('company_expanded_routes_invalid')
        return registered_routes(json.loads(PATH.read_text(encoding='utf-8')))
    except (OSError, ValueError, UnicodeError):
        # A corrupted new registry does not erase the existing original routes.
        return {}


SOURCES = _read_routes()
