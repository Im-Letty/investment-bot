"""Explicit issuer-published RSS routes, independent of the global latest 200.

Only registered public feeds are fetchable. Discovery still requires the
current constituent identity; the existing original PR TIMES extractor owns
heading, author, publication date, body and immutable membership evidence.
"""
from urllib.parse import urlsplit, urlunsplit

from company_news_prtimes import parse_feed as parse_global_feed, _company_id
from company_news_catalogue import normalize_issuer_name

# Each ID is verified from the RSS link on an original public release. The
# registry is deliberately smaller than the candidate universe, not a claim
# that all announcements from all 225 constituents are available here.
SOURCES = {
    'PR TIMES / 東京ガス': {'company_id': '21766', 'symbol': '9531.T',
        'name': '東京瓦斯', 'issuer': '東京ガス株式会社'},
    'PR TIMES / 味の素': {'company_id': '59753', 'symbol': '2802.T',
        'name': '味の素', 'issuer': '味の素株式会社'},
    'PR TIMES / 三井住友フィナンシャルグループ': {'company_id': '74664', 'symbol': '8316.T',
        'name': '三井住友フィナンシャルグループ', 'issuer': '株式会社三井住友フィナンシャルグループ'},
    'PR TIMES / 東日本旅客鉄道': {'company_id': '17557', 'symbol': '9020.T',
        'name': '東日本旅客鉄道', 'issuer': '東日本旅客鉄道株式会社'},
    'PR TIMES / 東海旅客鉄道': {'company_id': '160429', 'symbol': '9022.T',
        'name': '東海旅客鉄道', 'issuer': '東海旅客鉄道株式会社'},
    'PR TIMES / 西日本旅客鉄道': {'company_id': '95753', 'symbol': '9021.T',
        'name': '西日本旅客鉄道', 'issuer': '西日本旅客鉄道株式会社'},
    'PR TIMES / 日本航空': {'company_id': '30684', 'symbol': '9201.T',
        'name': '日本航空', 'issuer': '日本航空株式会社'},
    'PR TIMES / 商船三井': {'company_id': '92744', 'symbol': '9104.T',
        'name': '商船三井', 'issuer': '株式会社商船三井'},
    'PR TIMES / 日清製粉グループ本社': {'company_id': '72829', 'symbol': '2002.T',
        'name': '日清製粉グループ本社', 'issuer': '株式会社日清製粉グループ本社'},
    'PR TIMES / 花王': {'company_id': '70897', 'symbol': '4452.T',
        'name': '花王', 'issuer': '花王株式会社'},
    'PR TIMES / イオン': {'company_id': '7505', 'symbol': '8267.T',
        'name': 'イオン', 'issuer': 'イオン株式会社'},
    'PR TIMES / 三菱UFJフィナンシャル・グループ': {'company_id': '79050', 'symbol': '8306.T',
        'name': '三菱ＵＦＪフィナンシャル・グループ', 'issuer': '株式会社三菱UFJフィナンシャル・グループ'},
    'PR TIMES / ソフトバンク': {'company_id': '13746', 'symbol': '9434.T',
        'name': 'ソフトバンク', 'issuer': 'ソフトバンク株式会社'},
    'PR TIMES / ENEOSホールディングス': {'company_id': '39629', 'symbol': '5020.T',
        'name': 'ＥＮＥＯＳホールディングス', 'issuer': 'ENEOSホールディングス株式会社'},
    'PR TIMES / みずほフィナンシャルグループ': {'company_id': '177612', 'symbol': '8411.T',
        'name': 'みずほフィナンシャルグループ', 'issuer': '株式会社みずほフィナンシャルグループ'},
    'PR TIMES / 富士通': {'company_id': '93942', 'symbol': '6702.T',
        'name': '富士通', 'issuer': '富士通株式会社'},
    'PR TIMES / 日立製作所': {'company_id': '141666', 'symbol': '6501.T',
        'name': '日立製作所', 'issuer': '株式会社 日立製作所'},
    'PR TIMES / 関西電力': {'company_id': '64489', 'symbol': '9503.T',
        'name': '関西電力', 'issuer': '関西電力株式会社'},
    'PR TIMES / 三井不動産': {'company_id': '51782', 'symbol': '8801.T',
        'name': '三井不動産', 'issuer': '三井不動産株式会社'},
    'PR TIMES / 大成建設': {'company_id': '179755', 'symbol': '1801.T',
        'name': '大成建設', 'issuer': '大成建設株式会社'},
}
BASE_SOURCES = tuple(SOURCES)
from company_news_expanded_routes import SOURCES as EXPANDED_SOURCES
if (set(SOURCES).intersection(EXPANDED_SOURCES)
        or {value['symbol'] for value in SOURCES.values()}.intersection(
            value['symbol'] for value in EXPANDED_SOURCES.values())
        or {value['company_id'] for value in SOURCES.values()}.intersection(
            value['company_id'] for value in EXPANDED_SOURCES.values())):
    raise ValueError('company_expanded_routes_overlap')
SOURCES.update(EXPANDED_SOURCES)
EXPANSION_CHANNELS = frozenset(EXPANDED_SOURCES)
FEEDS = {label: 'https://prtimes.jp/companyrdf.php?company_id=' + value['company_id']
         for label, value in SOURCES.items()}


def safe_feed_url(value, source=None):
    if not isinstance(value, str) or any(ord(char) < 33 or ord(char) == 127 for char in value):
        return None
    if '\\' in value:
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or parsed.hostname != 'prtimes.jp'
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.fragment):
            return None
        normalized = urlunsplit(('https', 'prtimes.jp', parsed.path, parsed.query, ''))
        labels = [source] if source in SOURCES else list(SOURCES) if source is None else []
        return normalized if any(normalized == FEEDS[label] for label in labels) else None
    except (ValueError, UnicodeError):
        return None


class _BoundCatalogue:
    """Resolve an explicitly verified spelling, never a fuzzy parent alias."""
    def __init__(self, catalogue, config):
        self._catalogue, self.config = catalogue, config
        self.members = catalogue.members
        self.provenance = catalogue.provenance
        self.facts_sha256 = catalogue.facts_sha256

    def match_issuer(self, raw):
        member = self.members.get(self.config['symbol'])
        if (not isinstance(member, dict) or member.get('name') != self.config['name']
                or normalize_issuer_name(raw) != normalize_issuer_name(self.config['issuer'])):
            return None
        # Canonical legal spellings are handled explicitly in the extractor;
        # normal registered issuers retain the original catalogue matcher.
        return member

    def verified_header_publisher(self, raw, company_id):
        return (company_id == self.config['company_id']
                and self.match_issuer(self.config['issuer']) is not None
                and isinstance(raw, str)
                and raw.strip() in self.config.get('verified_header_labels', ()))


def bound_catalogue(source, catalogue):
    return _BoundCatalogue(catalogue, SOURCES[source]) if source in SOURCES else catalogue


def bound_item_catalogue(item, catalogue):
    """A global-feed item may use only its exact individually registered issuer."""
    if not isinstance(item, dict) or catalogue is None:
        return catalogue
    matches = [config for config in SOURCES.values()
               if config['company_id'] == item.get('company_id')
               and config['symbol'] == item.get('symbol') and config['name'] == item.get('name')
               and _BoundCatalogue(catalogue, config).match_issuer(item.get('issuer')) is not None]
    return _BoundCatalogue(catalogue, matches[0]) if len(matches) == 1 else catalogue


def match_member(issuer, company_id, catalogue):
    if catalogue is None:
        return None
    matches = [bound_catalogue(label, catalogue).match_issuer(issuer)
               for label, config in SOURCES.items() if config['company_id'] == company_id]
    matches = [member for member in matches if member is not None]
    return matches[0] if len(matches) == 1 else None


def parse_feed(payload, source, now, since, catalogue):
    config = SOURCES.get(source)
    if not config or catalogue is None:
        return []
    scoped = bound_catalogue(source, catalogue)
    records = parse_global_feed(payload, now, since, scoped)
    return [dict(item, collection_channel=source) for item in records
            if item['symbol'] == config['symbol'] and item['name'] == config['name']
            and _company_id(item['url']) == config['company_id']]
